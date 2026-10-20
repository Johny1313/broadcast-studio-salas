/* Broadcast Studio Dual Canvas v1.7 — cameras, rooms, ICE diagnostics and split layout */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const bridge = window.broadcastBridge || null;
  const sizes = {h:{w:1280,h:720},v:{w:720,h:1280}};
  const clone = o => JSON.parse(JSON.stringify(o));
  const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
  const makeId = (p='id') => p+'_'+Date.now().toString(36)+'_'+Math.floor(Math.random()*1e6).toString(36);
  const esc = s => String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Exactly four composition channels per canvas: 3 live cameras + 1 playlist.
  // Sources are captured once and shared across independent horizontal and vertical layouts.
  const channelNames=['Câmera 1','Câmera 2','Câmera 3','Playlist 4'];
  const slotId=(f,i)=>`${f}_${i===3?'playlist':'cam'+(i+1)}`;
  const brandDefaults = {
    h:{bgColor:'#0e2138',frameOn:false,frameColor:'#ffffff',frameWidth:14,frameOpacity:1,logoOn:false,logoX:.79,logoY:.045,logoW:.16,logoH:.11,logoOpacity:1},
    v:{bgColor:'#111b30',frameOn:false,frameColor:'#ffffff',frameWidth:18,frameOpacity:1,logoOn:false,logoX:.68,logoY:.03,logoW:.23,logoH:.085,logoOpacity:1}
  };
  const defaults = {
    h:{slots:[
      {id:'h_cam1',name:'Câmera 1',sourceId:'camera1',x:.04,y:.105,w:.45,h:.347,fit:'cover',border:2,color:'#479cff',enabled:true},
      {id:'h_cam2',name:'Câmera 2',sourceId:'camera2',x:.51,y:.105,w:.45,h:.347,fit:'cover',border:2,color:'#479cff',enabled:true},
      {id:'h_cam3',name:'Câmera 3',sourceId:'camera3',x:.04,y:.473,w:.45,h:.347,fit:'cover',border:2,color:'#479cff',enabled:true},
      {id:'h_playlist',name:'Playlist 4',sourceId:null,x:.51,y:.473,w:.45,h:.347,fit:'contain',border:2,color:'#64c3bd',enabled:true}
    ],gc:{on:true,title:'BROADCAST STUDIO',sub:'PRODUÇÃO AO VIVO'},brand:clone(brandDefaults.h)},
    v:{slots:[
      {id:'v_cam1',name:'Câmera 1',sourceId:'camera1',x:.075,y:.06,w:.85,h:.183,fit:'cover',border:3,color:'#9c75ff',enabled:true},
      {id:'v_cam2',name:'Câmera 2',sourceId:'camera2',x:.075,y:.264,w:.85,h:.183,fit:'cover',border:3,color:'#9c75ff',enabled:true},
      {id:'v_cam3',name:'Câmera 3',sourceId:'camera3',x:.075,y:.468,w:.85,h:.183,fit:'cover',border:3,color:'#9c75ff',enabled:true},
      {id:'v_playlist',name:'Playlist 4',sourceId:null,x:.075,y:.672,w:.85,h:.183,fit:'contain',border:3,color:'#64c3bd',enabled:true}
    ],gc:{on:true,title:'BROADCAST STUDIO',sub:'AO VIVO EM VERTICAL'},brand:clone(brandDefaults.v)}
  };
  const state = {
    preview:clone(defaults),program:clone(defaults),
    brandAssets:{preview:{h:{bg:null,frame:null,logo:null},v:{bg:null,frame:null,logo:null}},program:{h:{bg:null,frame:null,logo:null},v:{bg:null,frame:null,logo:null}}},
    selected:{format:'h',id:'h_playlist'},
    sources:new Map(),playlist:[],playIndex:-1,isPlaying:false,
    streams:{camera1:null,camera2:null,camera3:null,screen:null,mic:null},
    audio:null,selectedSource:null,recordings:{h:null,v:null},
    destinations:[],outputAvailable:false,drag:null,webPreviewPaused:false,
    lastLog:0,recordFolder:null,authoredLayout:{h:[],v:[]},guests:{room:null,hostToken:null,guestToken:null,localGuestBase:null,entries:new Map(),cursor:0,watch:null,connections:new Map(),pendingIce:new Map()} 
  };
  let toastTimer,saveTimer;
  function log(msg,type='normal') {
    const line=document.createElement('div');line.className='logline '+type;
    const time=new Date().toLocaleTimeString('pt-BR',{hour12:false});
    line.textContent=`${time}  ${msg}`;
    $('logs').prepend(line);
    while($('logs').children.length>75) $('logs').lastChild.remove();
  }
  function toast(msg) {
    $('toast').textContent=msg;$('toast').classList.add('show');
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4000);
  }
  function normalizeBrand(brand,format){
    const base=brandDefaults[format],given=brand||{};
    return {
      bgColor:/^#[\da-fA-F]{6}$/.test(given.bgColor)?given.bgColor:base.bgColor,
      frameOn:given.frameOn!==undefined?!!given.frameOn:base.frameOn,
      frameColor:/^#[\da-fA-F]{6}$/.test(given.frameColor)?given.frameColor:base.frameColor,
      frameWidth:clamp(Number(given.frameWidth)||0,0,80),
      frameOpacity:clamp(Number(given.frameOpacity ?? base.frameOpacity),0,1),
      logoOn:given.logoOn!==undefined?!!given.logoOn:base.logoOn,
      logoX:clamp(Number(given.logoX ?? base.logoX),0,.95),
      logoY:clamp(Number(given.logoY ?? base.logoY),0,.95),
      logoW:clamp(Number(given.logoW ?? base.logoW),.04,.9),
      logoH:clamp(Number(given.logoH ?? base.logoH),.03,.6),
      logoOpacity:clamp(Number(given.logoOpacity ?? base.logoOpacity),0,1)
    };
  }
  function normalizeScene(scene,format) {
    if(!scene||!Array.isArray(scene.slots))return clone(defaults[format]);
    const slots=defaults[format].slots.map((base,i)=>{
      // Import V1.0 presets without losing the main camera/media positions.
      const legacy=i===0?format+'_cam':i===3?format+'_media':null;
      const given=scene.slots.find(s=>s.id===base.id)||
        (legacy?scene.slots.find(s=>s.id===legacy):null);
      if(!given)return {...base};
      const w=clamp(Number.isFinite(Number(given.w))?Number(given.w):base.w,.05,1);
      const h=clamp(Number.isFinite(Number(given.h))?Number(given.h):base.h,.05,1);
      const sourceId=(typeof given.sourceId==='string' && (i===3||/^camera[123]$/.test(given.sourceId)))?given.sourceId:(i===3?null:'camera'+(i+1));
      return {...base,
        name:String(given.name||base.name).slice(0,80),sourceId,
        x:clamp(Number(given.x)||0,0,1-w),y:clamp(Number(given.y)||0,0,1-h),w,h,
        enabled:given.enabled!==false,
        fit:['contain','cover','stretch'].includes(given.fit)?given.fit:base.fit,
        border:clamp(Number(given.border)||0,0,20),
        color:/^#[\da-fA-F]{6}$/.test(given.color)?given.color:base.color
      };
    });
    const gc=scene.gc||{};
    return {slots,gc:{on:!!gc.on,title:String(gc.title||'').slice(0,120),sub:String(gc.sub||'').slice(0,140)},brand:normalizeBrand(scene.brand,format)};
  }
  try {
    // V1.1 uses a new key; the previous layout is migrated on first run.
    const stored=JSON.parse(localStorage.getItem('broadcast_v1_1_layout')||localStorage.getItem('broadcast_v1_layout')||'null');
    if (stored?.h && stored?.v) {
      state.preview.h=normalizeScene(stored.h,'h');state.preview.v=normalizeScene(stored.v,'v');
      // Object URLs are not valid after a restart. Preserve device source assignments only.
      for(const f of ['h','v'])for(const slot of state.preview[f].slots)
        if(slot.id.endsWith('_playlist'))slot.sourceId=null;
      state.program=clone(state.preview);
    }
  } catch(_) { /* first run or storage unavailable */ }
  const geometryKeys=['x','y','w','h','fit'];
  function rememberAuthoredLayout(format){
    // A user's hand-made canvas geometry survives all quick presets (fullscreen, PiP, grid).
    state.authoredLayout[format]=state.preview[format].slots.map(s=>Object.fromEntries(geometryKeys.map(k=>[k,s[k]])));
  }
  for(const f of ['h','v'])rememberAuthoredLayout(f);
  try{
    const authored=JSON.parse(localStorage.getItem('broadcast_v1_6_authored')||'null');
    if(authored?.h?.length===4 && authored?.v?.length===4){
      for(const f of ['h','v']) state.authoredLayout[f]=authored[f].map((geom,i)=>{
        const s=state.preview[f].slots[i];
        const w=clamp(Number(geom.w)||s.w,.05,1),h=clamp(Number(geom.h)||s.h,.05,1);
        return {x:clamp(Number(geom.x)||0,0,1-w),y:clamp(Number(geom.y)||0,0,1-h),w,h,fit:['cover','contain','stretch'].includes(geom.fit)?geom.fit:s.fit};
      });
    }
  }catch(_){}
  function saveLocal() {clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{
    localStorage.setItem('broadcast_v1_1_layout',JSON.stringify(state.preview));
    localStorage.setItem('broadcast_v1_6_authored',JSON.stringify(state.authoredLayout));
  }catch(_){}},350);}

  function emptySource(id, name,kind) {return {id,name,kind,element:null,objectUrl:null,volume:1,ready:false};}
  for(let i=1;i<=3;i++)state.sources.set('camera'+i,emptySource('camera'+i,'Câmera '+i,'camera'));
  state.sources.set('screen',emptySource('screen','Captura de tela','screen'));

  let analyserData=null;
  function ensureAudio() {
    if(state.audio) {if(state.audio.ctx.state==='suspended') state.audio.ctx.resume().catch(()=>{});return state.audio;}
    const AudioContext=window.AudioContext||window.webkitAudioContext;
    if(!AudioContext) throw new Error('Web Audio não disponível neste navegador');
    const ctx=new AudioContext({sampleRate:48000});
    const destination=ctx.createMediaStreamDestination();
    const micGain=ctx.createGain();micGain.gain.value=Number($('micVolume').value);
    micGain.connect(destination);
    const analyser=ctx.createAnalyser();analyser.fftSize=512;
    micGain.connect(analyser);analyserData=new Uint8Array(analyser.frequencyBinCount);
    state.audio={ctx,destination,micGain,analyser,micNode:null,screenNode:null,returnBuses:new Map()};
    for(const src of state.sources.values()) if(src.kind==='video'&&src.element) connectVideoAudio(src);
    ctx.resume().catch(()=>{});
    return state.audio;
  }
  function connectVideoAudio(src) {
    if(src.audioNode||src.kind!=='video'||!src.element||!state.audio) return;
    try {
      src.audioNode=state.audio.ctx.createMediaElementSource(src.element);
      src.gainNode=state.audio.ctx.createGain();src.gainNode.gain.value=src.volume;
      src.audioNode.connect(src.gainNode);src.gainNode.connect(state.audio.destination);
      for(const bus of state.audio.returnBuses.values())src.gainNode.connect(bus);
    } catch(err) {log('Áudio indisponível para '+src.name,'warn');}
  }
  function connectMicStream(stream) {
    const a=ensureAudio();
    if(a.micNode) {try{a.micNode.disconnect()}catch(_){}}
    a.micNode=a.ctx.createMediaStreamSource(stream);
    a.micNode.connect(a.micGain);
  }
  function connectScreenSound(stream) {
    if(!stream.getAudioTracks().length) return;
    const a=ensureAudio();
    if(a.screenNode) a.screenNode.disconnect();
    a.screenNode=a.ctx.createMediaStreamSource(stream);
    a.screenNode.connect(a.destination);
  }
  function addSource(src) {state.sources.set(src.id,src);renderMedia();refreshSlotSource();}
  function createVideo(srcUrl, isRemote) {
    const el=document.createElement('video');
    el.playsInline=true;el.preload='auto';el.autoplay=false;el.loop=false;
    if(isRemote) el.crossOrigin='anonymous';
    el.src=srcUrl;
    return el;
  }
  function addFiles(files) {
    if(!files?.length) return;
    let added=0;
    for(const file of Array.from(files)) {
      const video=/\.(mp4|mov|mkv|webm|m4v)$/i.test(file.name)||file.type.startsWith('video/');
      const image=/\.(png|jpeg|jpg|webp|gif)$/i.test(file.name)||file.type.startsWith('image/');
      if(!video&&!image){log('Formato não reconhecido: '+file.name,'warn');continue;}
      const url=URL.createObjectURL(file),id=makeId('media');
      const src=emptySource(id,file.name,video?'video':'image');src.objectUrl=url;
      if(video){
        src.element=createVideo(url,false);
        src.element.onloadeddata=()=>{src.ready=true;log(`Vídeo carregado: ${src.name}`,'good')};
        src.element.onerror=()=>{src.ready=false;log(`Não foi possível decodificar ${src.name}. Codec pode não ser suportado.`,'err')};
        src.element.onended=()=>mediaEnded(id);
        connectVideoAudio(src);
      } else {
        const img=new Image();img.onload=()=>{src.ready=true};img.onerror=()=>log(`Imagem inválida: ${src.name}`,'err');img.src=url;src.element=img;
      }
      addSource(src);added++;
    }
    if(added){log(`${added} arquivo(s) adicionados à biblioteca.`,'good');toast(`${added} arquivo(s) importados.`);}
    $('mediaFiles').value='';
  }
  function classifyMediaUrl(url) {
    const host=url.hostname.toLowerCase().replace(/^www\./,'');
    const path=url.pathname;
    const ytId=host==='youtu.be'?path.split('/').filter(Boolean)[0]:
      ['youtube.com','m.youtube.com','music.youtube.com','youtube-nocookie.com'].includes(host) ?
      (url.searchParams.get('v')||path.match(/^\/(?:live|shorts|embed)\/([A-Za-z0-9_-]{6,})/)?.[1]) : null;
    if(ytId&&/^[A-Za-z0-9_-]{6,20}$/.test(ytId))return {
      kind:'external',provider:'YouTube',name:'YouTube · '+ytId,
      embedUrl:'https://www.youtube-nocookie.com/embed/'+encodeURIComponent(ytId)+'?autoplay=1&mute=1&playsinline=1&controls=1&rel=0'
    };
    const ytList=['youtube.com','m.youtube.com','music.youtube.com'].includes(host)?url.searchParams.get('list'):null;
    if(ytList&&/^[A-Za-z0-9_-]{5,100}$/.test(ytList))return{
      kind:'external',provider:'YouTube',name:'YouTube · playlist',
      embedUrl:'https://www.youtube-nocookie.com/embed/videoseries?list='+encodeURIComponent(ytList)+'&autoplay=1&mute=1'
    };
    const vimeoId=['vimeo.com','player.vimeo.com'].includes(host)?path.match(/\/(?:video\/)?(\d{6,12})(?:\/|$)/)?.[1]:null;
    if(vimeoId)return{
      kind:'external',provider:'Vimeo',name:'Vimeo · '+vimeoId,
      embedUrl:'https://player.vimeo.com/video/'+vimeoId+'?autoplay=1&muted=1&title=0&byline=0'
    };
    const direct=/\.(mp4|webm|mov|m4v|ogv|m3u8)$/i.test(path);
    if(direct)return{kind:'video',provider:/\.m3u8$/i.test(path)?'HLS (depende de suporte do navegador)':'Vídeo direto',name:decodeURIComponent(path.split('/').pop()||url.hostname).slice(0,95)};
    return{kind:'external',provider:'Site externo',name:host+' · página',embedUrl:url.href};
  }
  function addUrl() {
    const input=$('mediaUrl').value.trim();if(!input)return;
    let url;
    try{url=new URL(input);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||input.length>2048)throw Error('bad protocol');}
    catch(_){toast('Utilize um link HTTP/HTTPS válido, sem usuário ou senha.');return;}
    let details;
    try{details=classifyMediaUrl(url);}catch(_){toast('URL não reconhecida.');return;}
    const id=makeId('url');
    const src=emptySource(id,details.name,details.kind);
    src.link=url.href;src.provider=details.provider;src.embedUrl=details.embedUrl||null;
    if(src.kind==='video'){
      src.element=createVideo(url.href,true);
      src.element.onloadeddata=()=>{src.ready=true;log('Mídia remota carregada: '+src.name,'good')};
      src.element.onerror=()=>{src.ready=false;log('Link direto não reproduzível (codec, CORS, HLS ou rede): '+src.name,'warn');toast('Vídeo remoto não reproduzível; confira rede, codec, CORS ou HLS.');};
      src.element.onended=()=>mediaEnded(id);connectVideoAudio(src);
    }
    addSource(src);addToPlaylist(id);$('mediaUrl').value='';
    log('Link adicionado à biblioteca e playlist: '+details.provider+'.','good');
    if(src.kind==='external')toast(details.provider+' adicionado. Clique em Testar item na janela 4 para visualizar OFF-AIR.');
    else toast('Vídeo direto adicionado à playlist. Teste sem iniciar transmissão.');
  }
  function openExternal(src) {
    if(!src?.link) return;
    if(bridge?.openExternal) bridge.openExternal(src.link).catch(()=>toast('Não foi possível abrir o link.'));
    else window.open(src.link,'_blank','noopener,noreferrer');
  }
  function renderMedia() {
    const box=$('mediaList');box.replaceChildren();$('mediaCount').textContent=state.sources.size;
    for(const src of state.sources.values()) {
      const item=document.createElement('div');item.className='library-item'+(src.id===state.selectedSource?' selected':'');
      const ico=document.createElement('span');ico.className='item-ico';ico.textContent=({camera:'▣',screen:'▤',video:'▶',image:'▧',external:'▤'})[src.kind]||'□';
      const detail=document.createElement('div');detail.className='item-content';
      const name=document.createElement('strong');name.textContent=src.name;name.title=src.name;
      const hint=document.createElement('small');hint.textContent=({camera:'Dispositivo',screen:'Captura',video:'Vídeo',image:'Imagem',external:'Ensaio na janela 4'})[src.kind];
      detail.append(name,hint);
      const use=document.createElement('button');use.className='icon-btn';use.title='Aplicar na janela selecionada';use.textContent='↘';
      use.onclick=()=>assignToSelected(src.id);
      const add=document.createElement('button');add.className='icon-btn';add.title='Adicionar à playlist';add.textContent='+';
      add.onclick=()=>addToPlaylist(src.id);
      item.append(ico,detail,use,add);
      item.onclick=e=>{if(e.target===use||e.target===add)return;state.selectedSource=src.id;renderMedia()};
      box.append(item);
    }
  }
  function addToPlaylist(id){
    const src=state.sources.get(id);if(!src||['camera','screen'].includes(src.kind)){toast('A playlist aceita vídeos, imagens e links.');return;}
    state.playlist.push(id);renderPlaylist();log('Adicionado à playlist: '+src.name);
  }
  function renderPlaylist() {
    const box=$('playlistList');box.replaceChildren();$('playlistCount').textContent=state.playlist.length;
    state.playlist.forEach((id,index)=>{
      const src=state.sources.get(id);if(!src)return;
      const item=document.createElement('div');item.className='playlist-item'+(index===state.playIndex?' active':'');
      const num=document.createElement('span');num.className='item-ico';num.textContent=index+1;
      const detail=document.createElement('div');detail.className='item-content';
      const title=document.createElement('strong');title.textContent=src.name;title.title=src.name;
      const hint=document.createElement('small');hint.textContent=src.kind==='external'?src.provider+' · ensaio':'Fonte da playlist';detail.append(title,hint);
      const mk=(title,symbol,fn)=>{const btn=document.createElement('button');btn.className='icon-btn';btn.title=title;btn.textContent=symbol;btn.onclick=fn;return btn;};
      item.append(num,detail,mk('Executar','▶',()=>loadPlaylistIndex(index)),
        mk('Subir','↑',()=>movePlaylist(index,-1)),mk('Descer','↓',()=>movePlaylist(index,1)),
        mk('Remover','×',()=>{state.playlist.splice(index,1);if(state.playIndex===index){state.playIndex=-1;state.isPlaying=false}else if(state.playIndex>index)state.playIndex--;renderPlaylist()}));
      box.append(item);
    });
  }
  function movePlaylist(index,delta) {
    const next=index+delta;if(next<0||next>=state.playlist.length)return;
    [state.playlist[index],state.playlist[next]]=[state.playlist[next],state.playlist[index]];
    if(state.playIndex===index)state.playIndex=next;else if(state.playIndex===next)state.playIndex=index;
    renderPlaylist();
  }
  async function playMedia(src) {
    if(src.kind==='external')return true;
    if(src.kind!=='video')return true;
    try {
      ensureAudio();connectVideoAudio(src);
      await src.element.play();return true;
    } catch(err){toast('Player não iniciou: confirme que o arquivo/URL é reproduzível.');log('Falha de reprodução: '+src.name,'err');return false;}
  }
  function assignToSelected(id) {
    const src=state.sources.get(id);if(!src)return;
    const format=state.selected.format;
    const index=src.kind==='camera'?Number(src.id.replace('camera',''))-1:3;
    const slot=state.preview[format].slots[index];
    if(!slot)return;
    if(src.kind==='camera'){
      // Dedicated camera channels always retain their hardware input route.
      setSelected(format,slot.id);
      toast('Câmera '+(index+1)+' selecionada no '+(format==='h'?'horizontal':'vertical')+'.');
    } else {
      slot.sourceId=id;
      setSelected(format,slot.id);
      state.webPreviewPaused=false;
      if(src.kind==='video')playMedia(src);
      log('Mídia aplicada na composição 4 da prévia '+format.toUpperCase()+(src.kind==='external'?' (somente ensaio web).':'.'),'good');
      updateWebStatus(src);
    }
    saveLocal();renderMedia();
  }
  function routePlaylistSource(id) {
    const target=$('playlistTarget').value;
    const formats=target==='h-media'?['h']:target==='v-media'?['v']:
      target==='selected'?[state.selected.format]:['h','v'];
    for(const format of formats){
      state.preview[format].slots[3].sourceId=id;
    }
    if(formats.length===1)setSelected(formats[0],slotId(formats[0],3));
    else refreshInspector();
    saveLocal();renderChannels();syncWebOverlays();
    const src=state.sources.get(id);updateWebStatus(src);
    if($('playlistAutoTake').checked){
      if(src?.kind==='external')log('Página externa mantida no ENSAIO; não pode ser enviada ao programa como vídeo.','warn');
      else for(const format of formats)take(format);
    }
  }
  async function loadPlaylistIndex(index) {
    if(index<0||index>=state.playlist.length)return;
    const id=state.playlist[index],src=state.sources.get(id);if(!src)return;
    if(state.playIndex>=0){const old=state.sources.get(state.playlist[state.playIndex]);if(old?.kind==='video'&&old!==src)old.element.pause();}
    state.playIndex=index;state.isPlaying=false;
    state.webPreviewPaused=false;
    if(src.kind==='video'){
      src.element.currentTime=0;
      const ok=await playMedia(src);state.isPlaying=ok;
    } else state.isPlaying=true;
    routePlaylistSource(id);renderPlaylist();updatePlayButton();
    log('Playlist: '+src.name);
  }
  function mediaEnded(id) {
    if(state.playIndex<0||state.playlist[state.playIndex]!==id)return;
    state.isPlaying=false;updatePlayButton();
    if($('autoNext').checked)nextPlaylist(1);
  }
  function nextPlaylist(delta) {
    if(!state.playlist.length)return;
    let next=state.playIndex+delta;
    if(state.playIndex<0)next=0;
    if(next>=state.playlist.length) {if($('loopPlaylist').checked)next=0;else {state.isPlaying=false;updatePlayButton();return;}}
    if(next<0)next=$('loopPlaylist').checked?state.playlist.length-1:0;
    loadPlaylistIndex(next);
  }
  function updatePlayButton(){ $('btnPlay').textContent=state.isPlaying?'Ⅱ Pausar':'▶ Reproduzir'; }
  function togglePlaylist() {
    if(!state.playlist.length){toast('Adicione vídeos à playlist.');return;}
    if(state.playIndex<0){loadPlaylistIndex(0);return;}
    const src=state.sources.get(state.playlist[state.playIndex]);
    if(src?.kind==='video'){
      if(state.isPlaying){src.element.pause();state.isPlaying=false;}
      else playMedia(src).then(ok=>{state.isPlaying=ok;updatePlayButton()});
    } else if(src?.kind==='external'){
      state.webPreviewPaused=state.isPlaying;state.isPlaying=!state.isPlaying;syncWebOverlays();
      updateWebStatus(src);
    } else state.isPlaying=!state.isPlaying;
    updatePlayButton();
  }
  function getSlot() {
    const {format,id}=state.selected;
    return state.preview[format].slots.find(x=>x.id===id)||null;
  }
  function refreshSlotSource() {
    const select=$('slotSource'),slot=getSlot();select.replaceChildren();
    if(!slot)return;
    const playlist=slot.id.endsWith('_playlist');
    if(playlist){
      select.add(new Option('Playlist • nenhum item',''));
      for(const src of state.sources.values())if(['video','image','external'].includes(src.kind))select.add(new Option(src.name,src.id));
    } else {
      const channel=slot.id.match(/cam([123])$/)?.[1]||'1';
      for(let i=1;i<=3;i++)select.add(new Option('Câmera local '+i,'camera'+i));
      for(const guest of state.guests.entries.values())if(guest.approved)select.add(new Option('Convidado · '+guest.name,'guest_'+guest.id));
    }
    if(playlist && slot.sourceId && !state.sources.has(slot.sourceId))slot.sourceId=null;
    select.value=slot.sourceId||'';
  }
  function updateWebStatus(src) {
    const el=$('linkPreviewStatus');if(!el)return;
    if(!src){el.textContent='Selecione um item da playlist para testar nas composições 4.';return;}
    if(src.kind==='external')el.textContent=`${src.provider}: ${state.webPreviewPaused?'prévia pausada':'prévia incorporada quando o site permite'}. Fora do ar; não é gravável nem enviado por RTMP. Se o site bloquear, use “Abrir site”.`;
    else el.textContent=`${src.name}: ${src.kind==='video'?'reprodução local/remota no canvas (se suportada)':'imagem na janela 4'}. Teste disponível sem iniciar live ou gravação.`;
  }
  function syncWebOverlays() {
    for(const format of ['h','v']){
      const slot=state.preview[format].slots[3],src=state.sources.get(slot.sourceId);
      const overlay=$('webOverlay'+format.toUpperCase());if(!overlay)continue;
      if(slot.enabled===false||src?.kind!=='external'||state.webPreviewPaused){
        if(!overlay.hidden){overlay.hidden=true;overlay.replaceChildren();overlay.dataset.sourceId='';}
        continue;
      }
      const canvas=$('preview'+format.toUpperCase());const wrap=$('previewWrap'+format.toUpperCase());
      const cr=canvas.getBoundingClientRect(),wr=wrap.getBoundingClientRect();
      overlay.style.left=(cr.left-wr.left+slot.x*cr.width)+'px';
      overlay.style.top=(cr.top-wr.top+slot.y*cr.height)+'px';
      overlay.style.width=(slot.w*cr.width)+'px';
      overlay.style.height=(slot.h*cr.height)+'px';
      overlay.hidden=false;
      if(overlay.dataset.sourceId===src.id)continue;
      overlay.replaceChildren();overlay.dataset.sourceId=src.id;
      const toolbar=document.createElement('div');toolbar.className='web-slot-top';
      const title=document.createElement('strong');title.textContent=src.provider+' · OFF';title.title=src.name;
      const interact=document.createElement('button');interact.textContent='Editar';
      interact.title='Alternar entre interagir com o site e arrastar/redimensionar a composição';
      const open=document.createElement('button');open.textContent='↗';open.title='Abrir site original em navegador';open.onclick=()=>openExternal(src);
      toolbar.append(title,interact,open);
      const iframe=document.createElement('iframe');iframe.title='Ensaio de '+src.name;
      iframe.allow='autoplay; fullscreen; picture-in-picture; encrypted-media';iframe.allowFullscreen=true;
      iframe.referrerPolicy='strict-origin-when-cross-origin';
      iframe.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-popups allow-presentation');
      iframe.src=src.embedUrl||src.link;
      // Allow pointer interaction with the iframe by default, while toolbar can switch to editing.
      interact.onclick=()=>{const locked=iframe.classList.toggle('web-locked');interact.textContent=locked?'Interagir':'Editar';overlay.classList.toggle('web-editing',locked);};
      const notice=document.createElement('div');notice.className='web-slot-warning';notice.textContent='ENSAIO: iframe não entra na gravação/live';
      overlay.append(toolbar,iframe,notice);
    }
  }
  function reloadSitesInPreview(){
    let n=0;
    for(const f of ['h','v']){
      const overlay=$('webOverlay'+f.toUpperCase());
      const iframe=overlay?.querySelector('iframe');
      if(iframe && !overlay.hidden){try{iframe.src=iframe.src;n++;}catch(_){}}
    }
    if(n)log('Sites da composição 4 recarregados com as regras atuais.','good');
    else toast('Nenhum site ativo nas janelas 4.');
  }
  async function initAdFilter(){
    const select=$('adFilterMode'),status=$('adFilterStatus'),badge=$('adFilterBadge');
    $('btnReloadSites').onclick=reloadSitesInPreview;
    const diagnosis=$('adFilterDiagnosis'),testButton=$('btnTestAdFilter');
    if(!bridge?.adFilterStatus || !bridge?.setAdFilterMode){
      select.value='off';select.disabled=true;badge.textContent='SEM BLOQUEIO';
      badge.classList.add('status-warning');
      status.textContent='Modo navegador comum: o aplicativo NÃO bloqueia anúncios. Use o modo desktop Electron para navegar com filtro.';
      diagnosis.textContent='O Chrome/Edge não concede controle sobre os anúncios dentro de iframes de sites externos. Para testar o bloqueio nativo, execute npm start após instalar as dependências.';
      testButton.disabled=true;
      return;
    }
    try{
      const initial=await bridge.adFilterStatus();
      if(!initial?.available)throw Error('indisponível');
      select.value=initial.mode;badge.textContent='DESKTOP • REDE';
      const update=async()=>{const st=await bridge.adFilterStatus();status.textContent=`${st.blocked} requisições publicitárias bloqueadas nesta sessão · ${st.mode==='off'?'Proteção desligada':st.mode==='enhanced'?'Proteção reforçada':'Proteção padrão'}`;};
      testButton.onclick=async()=>{
        const current=await bridge.adFilterStatus();
        if(current.mode==='off'){diagnosis.textContent='Ative o modo Padrão ou Reforçado antes de testar.';return;}
        testButton.disabled=true;
        diagnosis.textContent='Testando bloqueio de requisição conhecida no motor Electron...';
        try{
          const result=await bridge.testAdFilter();
          diagnosis.textContent=result.ok ? 'CONFIRMADO: interceptação real bloqueou a requisição de teste (sem baixar anúncio).' : 'FALHA NO TESTE: '+(result.error||'Nenhuma requisição foi interceptada.');
          diagnosis.classList.toggle('test-failed',!result.ok);
          await update();
        }catch(err){diagnosis.textContent='Não foi possível diagnosticar o filtro: '+err.message;diagnosis.classList.add('test-failed');}
        finally{testButton.disabled=false;}
      };
      await update();
      diagnosis.textContent='Filtro de rede Electron ligado: teste acima para confirmar. Conteúdo publicitário incorporado ao próprio vídeo pode permanecer.';
      select.onchange=async()=>{
        try{
          const newState=await bridge.setAdFilterMode(select.value);
          if(!newState?.available||newState.error)throw Error('Filtro indisponível');
          await update();reloadSitesInPreview();
          log('Navegação limpa: '+select.options[select.selectedIndex].text+'.','good');
        }catch(_){toast('Não foi possível alterar o bloqueador.');}
      };
      // Update only on demand and when media changes, avoiding background polls.
      $('btnRehearse')?.addEventListener('click',()=>{setTimeout(()=>update().catch(()=>{}),1000);});
    }catch(_){select.disabled=true;testButton.disabled=true;badge.textContent='Indisponível';status.textContent='Filtro não disponível nesta execução.';}
  }
  function renderChannels() {
    for(const format of ['h','v']){
      const box=$('channels'+format.toUpperCase());if(!box)continue;
      box.replaceChildren();
      for(const [i,slot] of state.preview[format].slots.entries()){
        const row=document.createElement('div');row.className='channel-row';
        const label=document.createElement('button');label.className='channel-select';
        label.textContent=(i+1).toString().padStart(2,'0')+'  '+slot.name;
        label.title='Selecionar e editar este canal no canvas '+format.toUpperCase();
        if(state.selected.format===format && state.selected.id===slot.id)label.classList.add('current');
        label.onclick=()=>setSelected(format,slot.id);
        const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=slot.enabled!==false;
        enabled.setAttribute('aria-label','Exibir '+slot.name+' no '+(format==='h'?'horizontal':'vertical'));
        enabled.onchange=()=>{slot.enabled=enabled.checked;saveLocal();renderChannels();log(`${slot.name} ${enabled.checked?'visível':'oculto'} no canvas ${format.toUpperCase()}.`)};
        row.append(label,enabled);box.append(row);
      }
    }
  }
  function refreshInspector() {
    const slot=getSlot();$('inspector').hidden=!slot;$('noSelection').hidden=!!slot;
    $('selectedLabel').textContent=slot?`${state.selected.format.toUpperCase()} • ${slot.name}`:'Nenhuma';
    if(!slot)return;
    $('slotName').value=slot.name;refreshSlotSource();
    for(const [input,key] of [['slotX','x'],['slotY','y'],['slotW','w'],['slotH','h']]) $(input).value=Math.round(slot[key]*100);
    $('slotFit').value=slot.fit;$('slotBorder').value=slot.border;$('slotColor').value=slot.color;
    $('slotDelete').textContent=slot.enabled===false?'Mostrar janela':'Ocultar janela';
    $('slotSource').disabled=false;
  }

  function syncBrandingInputs(){
    for(const format of ['h','v']){
      const brand=state.preview[format].brand||normalizeBrand(null,format);
      const up=format.toUpperCase();
      if($("bgColor"+up)) $('bgColor'+up).value=brand.bgColor;
      if($('frameOn'+up)) $('frameOn'+up).checked=!!brand.frameOn;
      if($('frameColor'+up)) $('frameColor'+up).value=brand.frameColor;
      if($('frameWidth'+up)) $('frameWidth'+up).value=Math.round(brand.frameWidth);
      if($('frameOpacity'+up)) $('frameOpacity'+up).value=Math.round(brand.frameOpacity*100);
      if($('logoOn'+up)) $('logoOn'+up).checked=!!brand.logoOn;
      if($('logoX'+up)) $('logoX'+up).value=Math.round(brand.logoX*100);
      if($('logoY'+up)) $('logoY'+up).value=Math.round(brand.logoY*100);
      if($('logoW'+up)) $('logoW'+up).value=Math.round(brand.logoW*100);
      if($('logoH'+up)) $('logoH'+up).value=Math.round(brand.logoH*100);
      if($('logoOpacity'+up)) $('logoOpacity'+up).value=Math.round(brand.logoOpacity*100);
      if($('bgInfo'+up)) $('bgInfo'+up).textContent=state.brandAssets.preview[format].bg?'Imagem carregada':'Sem imagem';
      if($('frameInfo'+up)) $('frameInfo'+up).textContent=state.brandAssets.preview[format].frame?'Imagem carregada':'Sem imagem';
      if($('logoInfo'+up)) $('logoInfo'+up).textContent=state.brandAssets.preview[format].logo?'Logo carregado':'Sem logo';
    }
  }
  function setBrandAsset(layer,format,key,asset){ state.brandAssets[layer][format][key]=asset; syncBrandingInputs(); }
  function imageAssetFromFile(file,done){
    if(!file){done(null);return;}
    const url=URL.createObjectURL(file);
    const img=new Image();
    img.onload=()=>done({element:img,objectUrl:url,name:file.name});
    img.onerror=()=>{URL.revokeObjectURL(url);done(null);};
    img.src=url;
  }
  function clearBrandAsset(format,key){ setBrandAsset('preview',format,key,null); saveLocal(); renderChannels(); }
  function wireBranding(){
    for(const format of ['h','v']){
      const up=format.toUpperCase();
      const brand=()=>state.preview[format].brand;
      $('bgColor'+up).oninput=e=>{brand().bgColor=e.target.value; saveLocal();};
      $('frameOn'+up).onchange=e=>{brand().frameOn=e.target.checked; saveLocal();};
      $('frameColor'+up).oninput=e=>{brand().frameColor=e.target.value; saveLocal();};
      $('frameWidth'+up).oninput=e=>{brand().frameWidth=clamp(Number(e.target.value)||0,0,80); saveLocal();};
      $('frameOpacity'+up).oninput=e=>{brand().frameOpacity=clamp((Number(e.target.value)||0)/100,0,1); saveLocal();};
      $('logoOn'+up).onchange=e=>{brand().logoOn=e.target.checked; saveLocal();};
      $('logoX'+up).oninput=e=>{brand().logoX=clamp((Number(e.target.value)||0)/100,0,.95); saveLocal();};
      $('logoY'+up).oninput=e=>{brand().logoY=clamp((Number(e.target.value)||0)/100,0,.95); saveLocal();};
      $('logoW'+up).oninput=e=>{brand().logoW=clamp((Number(e.target.value)||0)/100,.04,.9); saveLocal();};
      $('logoH'+up).oninput=e=>{brand().logoH=clamp((Number(e.target.value)||0)/100,.03,.6); saveLocal();};
      $('logoOpacity'+up).oninput=e=>{brand().logoOpacity=clamp((Number(e.target.value)||0)/100,0,1); saveLocal();};
      $('bgImage'+up).onchange=e=>imageAssetFromFile(e.target.files?.[0],asset=>{if(asset){setBrandAsset('preview',format,'bg',asset);log('Fundo carregado em '+format.toUpperCase()+': '+asset.name,'good');}else toast('Não foi possível carregar a imagem de fundo.'); e.target.value='';});
      $('frameImage'+up).onchange=e=>imageAssetFromFile(e.target.files?.[0],asset=>{if(asset){setBrandAsset('preview',format,'frame',asset);brand().frameOn=true;log('Moldura carregada em '+format.toUpperCase()+': '+asset.name,'good');}else toast('Não foi possível carregar a moldura.'); e.target.value='';});
      $('logoImage'+up).onchange=e=>imageAssetFromFile(e.target.files?.[0],asset=>{if(asset){setBrandAsset('preview',format,'logo',asset);brand().logoOn=true;log('Logo carregado em '+format.toUpperCase()+': '+asset.name,'good');}else toast('Não foi possível carregar o logo.'); e.target.value='';});
      $('btnClearBg'+up).onclick=()=>clearBrandAsset(format,'bg');
      $('btnClearFrame'+up).onclick=()=>clearBrandAsset(format,'frame');
      $('btnClearLogo'+up).onclick=()=>clearBrandAsset(format,'logo');
    }
    syncBrandingInputs();
  }
  function setSelected(format,id) {state.selected={format,id};refreshInspector();renderChannels();}
  function newSlot(format) {
    // All four channels are permanent. Restore visibility instead of creating a fifth.
    state.preview[format].slots.forEach(s=>s.enabled=true);
    setSelected(format,state.preview[format].slots[3].id);
    saveLocal();renderChannels();syncBrandingInputs();log('Quatro composições visíveis na prévia '+format.toUpperCase()+'.');
  }
  function take(format) {
    const next=clone(state.preview[format]);
    const slot=next.slots[3];const src=state.sources.get(slot.sourceId);
    if(src?.kind==='external'){
      const previous=state.program[format].slots[3].sourceId;
      slot.sourceId=state.sources.get(previous)?.kind==='external'?null:previous;
      log('Site de '+src.provider+' permanece apenas na PRÉVIA '+format.toUpperCase()+'; iframe não pode ser capturado para a live/gravação.','warn');
      toast('Site na prévia OFF-AIR. Para levar ao ar, utilize uma fonte de vídeo capturável ou captura de tela autorizada.');
    }
    state.program[format]=next;
    state.brandAssets.program[format]={...state.brandAssets.preview[format]};
    $(''+format+'ProgInfo').textContent='PROGRAMA • Atualizado '+new Date().toLocaleTimeString('pt-BR',{hour12:false});
    log(`Corte no ar: composição ${format==='h'?'horizontal':'vertical'} atualizada.`,'good');
  }
  function drawBackground(ctx,w,h,format,scene,layer) {
    const brand=scene.brand||brandDefaults[format];
    ctx.fillStyle=brand.bgColor||brandDefaults[format].bgColor;ctx.fillRect(0,0,w,h);
    const bgAsset=state.brandAssets[layer][format].bg;
    if(bgAsset?.element){
      try{fitMedia(ctx,bgAsset.element,bgAsset.element.naturalWidth||w,bgAsset.element.naturalHeight||h,0,0,w,h,'cover');}catch(_){}
      ctx.fillStyle='rgba(4,10,18,.24)';ctx.fillRect(0,0,w,h);
    } else {
      const gradient=ctx.createLinearGradient(0,0,w,h);
      gradient.addColorStop(0,brand.bgColor||'#0e2138');gradient.addColorStop(.55,'#102236');gradient.addColorStop(1,'#16283d');
      ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
    }
    ctx.strokeStyle='#ffffff0d';ctx.lineWidth=1;
    for(let i=1;i<8;i++){
      ctx.beginPath();ctx.moveTo(w*i/8,0);ctx.lineTo(w*i/8,h);ctx.stroke();
      ctx.beginPath();ctx.moveTo(0,h*i/8);ctx.lineTo(w,h*i/8);ctx.stroke();
    }
    ctx.fillStyle='#7e9bb733';ctx.font=`${Math.round(w*.022)}px system-ui`;
    ctx.fillText(format==='h'?'BROADCAST  /  16:9':'BROADCAST  /  9:16',w*.05,h*.055);
  }
  function rectPath(ctx,x,y,w,h,r) {
    const radius=Math.min(r,w/2,h/2);
    ctx.beginPath();ctx.roundRect(x,y,w,h,radius);
  }
  function fitMedia(ctx,el,sourceW,sourceH,x,y,w,h,fit) {
    if(fit==='stretch'){ctx.drawImage(el,x,y,w,h);return;}
    const ir=sourceW/sourceH,ar=w/h;
    if(fit==='contain'){
      const drawW=ir>ar?w:h*ir,drawH=ir>ar?w/ir:h;
      ctx.drawImage(el,x+(w-drawW)/2,y+(h-drawH)/2,drawW,drawH);
    } else {
      const cropW=ir>ar?sourceH*ar:sourceW,cropH=ir>ar?sourceH:sourceW/ar;
      const cx=(sourceW-cropW)/2,cy=(sourceH-cropH)/2;
      ctx.drawImage(el,cx,cy,cropW,cropH,x,y,w,h);
    }
  }
  function drawSlot(ctx,format,slot,w,h,preview) {
    const x=slot.x*w,y=slot.y*h,rw=slot.w*w,rh=slot.h*h;
    ctx.save();rectPath(ctx,x,y,rw,rh,Math.min(w,h)*.007);ctx.clip();
    ctx.fillStyle='#23374e';ctx.fillRect(x,y,rw,rh);
    const source=state.sources.get(slot.sourceId);
    let drawn=false;
    if(source?.element && source.kind!=='external') {
      const el=source.element;
      const sourceW=el.videoWidth||el.naturalWidth||0, sourceH=el.videoHeight||el.naturalHeight||0;
      if(sourceW>0&&sourceH>0) {
        try{fitMedia(ctx,el,sourceW,sourceH,x,y,rw,rh,slot.fit);drawn=true;}
        catch(_) {drawn=false;}
      }
    }
    if(!drawn){
      const grd=ctx.createLinearGradient(x,y,x+rw,y+rh);
      grd.addColorStop(0,'#253c55');grd.addColorStop(1,'#344e69');ctx.fillStyle=grd;ctx.fillRect(x,y,rw,rh);
      const fs=Math.max(12,Math.min(w*.022,rw*.08));
      ctx.fillStyle='#b6c9de';ctx.font=`bold ${fs*1.8}px system-ui`;ctx.textAlign='center';
      ctx.fillText(source?.kind==='camera'?'◉':source?.kind==='screen'?'▣':'▶',x+rw/2,y+rh/2,Math.max(rw*.6,20));
      ctx.font=`${fs}px system-ui`;
      ctx.fillText((source?.name||'FONTE VAZIA').slice(0,35),x+rw/2,y+rh/2+fs*2,Math.max(rw-15,10));
      if(source?.kind==='external'){ctx.fillStyle='#f3d59b';ctx.font=`${Math.max(10,fs*.75)}px system-ui`;ctx.fillText(preview?'WEB · TESTE OFF-AIR':'WEB · NÃO CAPTURÁVEL',x+rw/2,y+rh/2+fs*3.5,Math.max(rw-14,10));}ctx.textAlign='left';
    }
    ctx.restore();
    if(slot.border){ctx.save();ctx.strokeStyle=slot.color;ctx.lineWidth=Math.max(1,slot.border*w/1280);rectPath(ctx,x,y,rw,rh,Math.min(w,h)*.007);ctx.stroke();ctx.restore();}
    if(preview && state.selected.format===format && state.selected.id===slot.id) {
      ctx.save();ctx.strokeStyle='#f8fafe';ctx.lineWidth=Math.max(2,w*.002);ctx.setLineDash([w*.009,w*.006]);ctx.strokeRect(x-2,y-2,rw+4,rh+4);ctx.setLineDash([]);
      const handleSize=Math.max(w*.012,13);
      ctx.fillStyle='#fff';ctx.fillRect(x+rw-handleSize/2,y+rh-handleSize/2,handleSize,handleSize);ctx.restore();
    }
  }
  function drawGC(ctx,scene,format,w,h) {
    if(!scene.gc?.on)return;
    const gc=scene.gc,v=format==='v';
    const y=h*(v?.878:.854),gh=h*(v?.093:.115),x=w*.035,gw=w*.93;
    ctx.save();
    ctx.fillStyle='#071a30ee';rectPath(ctx,x,y,gw,gh,Math.round(w*.006));ctx.fill();
    ctx.fillStyle='#1675d8';ctx.fillRect(x,y,w*.012,gh);
    const f1=Math.round(w*(v?.042:.028)),f2=Math.round(w*(v?.027:.017));
    ctx.textBaseline='middle';ctx.fillStyle='#fff';ctx.font=`800 ${f1}px system-ui`;
    ctx.fillText(gc.title||'',x+w*.031,y+gh*.36,gw-w*.05);
    ctx.fillStyle='#acc8e8';ctx.font=`${f2}px system-ui`;
    ctx.fillText(gc.sub||'',x+w*.031,y+gh*.74,gw-w*.05);
    ctx.restore();
  }

  function drawLogo(ctx,scene,format,w,h,layer){
    const brand=scene.brand||brandDefaults[format],asset=state.brandAssets[layer][format].logo;
    if(!brand.logoOn||!asset?.element)return;
    const x=brand.logoX*w,y=brand.logoY*h,rw=brand.logoW*w,rh=brand.logoH*h;
    ctx.save();ctx.globalAlpha=brand.logoOpacity;
    try{fitMedia(ctx,asset.element,asset.element.naturalWidth||rw,asset.element.naturalHeight||rh,x,y,rw,rh,'contain');}catch(_){}
    ctx.restore();
  }
  function drawFrame(ctx,scene,format,w,h,layer){
    const brand=scene.brand||brandDefaults[format],asset=state.brandAssets[layer][format].frame;
    if(brand.frameOn && brand.frameWidth>0){
      ctx.save();ctx.globalAlpha=brand.frameOpacity;ctx.strokeStyle=brand.frameColor;ctx.lineWidth=brand.frameWidth;ctx.strokeRect(brand.frameWidth/2,brand.frameWidth/2,w-brand.frameWidth,h-brand.frameWidth);ctx.restore();
    }
    if(asset?.element){
      ctx.save();ctx.globalAlpha=brand.frameOpacity;
      try{ctx.drawImage(asset.element,0,0,w,h);}catch(_){}
      ctx.restore();
    }
  }
  function drawScene(scene,format,canvas,isPreview,layer='preview') {
    if(!canvas)return;
    const ctx=canvas.getContext('2d',{alpha:false});
    const w=canvas.width,h=canvas.height;
    drawBackground(ctx,w,h,format,scene,layer);
    for(const slot of scene.slots)if(slot.enabled!==false)drawSlot(ctx,format,slot,w,h,isPreview);
    drawGC(ctx,scene,format,w,h);
    drawLogo(ctx,scene,format,w,h,layer);
    drawFrame(ctx,scene,format,w,h,layer);
  }
  const programCanvases={h:document.createElement('canvas'),v:document.createElement('canvas')};
  for(const f of ['h','v']){programCanvases[f].width=sizes[f].w;programCanvases[f].height=sizes[f].h;}
  let prevAt=0,programAt=0,meterAt=0,lastMonAt=0,lastWebAt=0;
  function loop(now) {
    if(now-programAt>=33){
      drawScene(state.program.h,'h',programCanvases.h,false,'program');
      drawScene(state.program.v,'v',programCanvases.v,false,'program');
      // Only sources that are ON AIR feed the program audio; PREVIEW is silent.
      const liveSources=new Set([...state.program.h.slots,...state.program.v.slots].filter(s=>s.enabled!==false).map(s=>s.sourceId));
      for(const src of state.sources.values()) if(src.gainNode) src.gainNode.gain.value=liveSources.has(src.id)?src.volume:0;
      const hMon=$('programMonitorH'),vMon=$('programMonitorV');
      if(hMon&&vMon&&now-lastMonAt>=130){
        hMon.getContext('2d',{alpha:false}).drawImage(programCanvases.h,0,0,hMon.width,hMon.height);
        vMon.getContext('2d',{alpha:false}).drawImage(programCanvases.v,0,0,vMon.width,vMon.height);
        lastMonAt=now;
      }
      programAt=now;
    }
    if(now-prevAt>=48){drawScene(state.preview.h,'h',$('previewH'),true,'preview');drawScene(state.preview.v,'v',$('previewV'),true,'preview');prevAt=now;}
    if(now-lastWebAt>=140){syncWebOverlays();lastWebAt=now;}
    if(now-meterAt>=90){
      const a=state.audio;if(a&&analyserData){a.analyser.getByteTimeDomainData(analyserData);let sum=0;for(const val of analyserData){const x=(val-128)/128;sum+=x*x;}const rms=Math.sqrt(sum/analyserData.length);$('audioMeter').style.width=Math.round(clamp(rms*500,0,100))+'%';}
      meterAt=now;
    }
    requestAnimationFrame(loop);
  }
  function setupCanvasInteraction(format) {
    const canvas=$('preview'+format.toUpperCase());
    const toPoint=e=>{const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};};
    canvas.addEventListener('pointerdown',e=>{
      const {x,y}=toPoint(e),slots=state.preview[format].slots;
      let selected=null;
      for(let i=slots.length-1;i>=0;i--){const s=slots[i];if(s.enabled===false)continue;if(x>=s.x&&x<=s.x+s.w&&y>=s.y&&y<=s.y+s.h){selected=s;break;}}
      if(!selected){setSelected(format,null);return;}
      setSelected(format,selected.id);
      const resize=(x>selected.x+selected.w-.065&&y>selected.y+selected.h-.065);
      state.drag={format,id:selected.id,startX:x,startY:y,original:{...selected},mode:resize?'resize':'move'};
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove',e=>{
      const drag=state.drag;if(!drag||drag.format!==format)return;
      const s=state.preview[format].slots.find(v=>v.id===drag.id);if(!s)return;
      const p=toPoint(e),dx=p.x-drag.startX,dy=p.y-drag.startY;
      if(drag.mode==='move'){
        s.x=clamp(drag.original.x+dx,0,1-s.w);s.y=clamp(drag.original.y+dy,0,1-s.h);
      } else {
        s.w=clamp(drag.original.w+dx,.05,1-s.x);s.h=clamp(drag.original.h+dy,.05,1-s.y);
      }
      refreshInspector();
    });
    const finish=e=>{if(state.drag?.format===format){rememberAuthoredLayout(format);state.drag=null;saveLocal();}if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);};
    canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
  }
  function wireInspector() {
    $('slotName').oninput=e=>{const s=getSlot();if(s){s.name=e.target.value.slice(0,80);$('selectedLabel').textContent=s.name;renderChannels();saveLocal();}};
    $('slotSource').onchange=e=>{const s=getSlot();if(s){s.sourceId=e.target.value||null;saveLocal();const src=state.sources.get(s.sourceId);if(src?.kind==='video')playMedia(src);log('Fonte de '+s.name+' atualizada.');}};
    $('slotFit').onchange=e=>{const s=getSlot();if(s){s.fit=e.target.value;rememberAuthoredLayout(state.selected.format);saveLocal();}};
    $('slotBorder').oninput=e=>{const s=getSlot();if(s){s.border=clamp(Number(e.target.value),0,20);saveLocal();}};
    $('slotColor').oninput=e=>{const s=getSlot();if(s){s.color=e.target.value;saveLocal();}};
    for(const [input,key] of [['slotX','x'],['slotY','y'],['slotW','w'],['slotH','h']]) $(input).onchange=e=>{
      const s=getSlot();if(!s)return;
      s[key]=clamp(Number(e.target.value)/100,key==='w'||key==='h'?.05:0,1);
      s.x=clamp(s.x,0,1-s.w);s.y=clamp(s.y,0,1-s.h);rememberAuthoredLayout(state.selected.format);refreshInspector();saveLocal();
    };
    $('slotUp').onclick=()=>{const s=getSlot();if(!s)return;const a=state.preview[state.selected.format].slots,i=a.indexOf(s);if(i<a.length-1){[a[i],a[i+1]]=[a[i+1],a[i]];saveLocal();}};
    $('slotDown').onclick=()=>{const s=getSlot();if(!s)return;const a=state.preview[state.selected.format].slots,i=a.indexOf(s);if(i>0){[a[i],a[i-1]]=[a[i-1],a[i]];saveLocal();}};
    $('slotDelete').onclick=()=>{const s=getSlot();if(!s)return;s.enabled=s.enabled===false;refreshInspector();renderChannels();saveLocal();};
    for(const [format,title,sub,on] of [['h','gcTitleH','gcSubH','gcOnH'],['v','gcTitleV','gcSubV','gcOnV']]) {
      $(title).value=state.preview[format].gc.title;$(sub).value=state.preview[format].gc.sub;$(on).checked=state.preview[format].gc.on;
      $(title).oninput=e=>{state.preview[format].gc.title=e.target.value;saveLocal()};
      $(sub).oninput=e=>{state.preview[format].gc.sub=e.target.value;saveLocal()};
      $(on).onchange=e=>{state.preview[format].gc.on=e.target.checked;saveLocal()};
    }
  }
  async function refreshDevices() {
    if(!navigator.mediaDevices?.enumerateDevices){log('Captura de dispositivos exige navegador/contexto seguro.','warn');return;}
    try {
      const devices=await navigator.mediaDevices.enumerateDevices();
      const cameras=devices.filter(d=>d.kind==='videoinput');
      for(let i=1;i<=3;i++){
        const select=$('cameraSelect'+i),chosen=select.value;
        select.replaceChildren(new Option(i===1?'Câmera padrão':'Selecione uma câmera',''));
        cameras.forEach((d,j)=>select.add(new Option(d.label||`Câmera disponível ${j+1}`,d.deviceId)));
        if([...select.options].some(o=>o.value===chosen))select.value=chosen;
      }
      const select=$('microphoneSelect'),selected=select.value;
      select.replaceChildren(new Option('Microfone padrão',''));
      devices.filter(d=>d.kind==='audioinput').forEach((d,i)=>select.add(new Option(d.label||`Microfone ${i+1}`,d.deviceId)));
      if([...select.options].some(o=>o.value===selected))select.value=selected;
    } catch(_) {log('Não foi possível enumerar câmeras/microfones.','warn');}
  }
  async function connectCamera(index) {
    if(!navigator.mediaDevices?.getUserMedia){toast('Câmera não disponível. Use aplicativo desktop ou localhost.');return;}
    const id='camera'+index,select=$('cameraSelect'+index),status=$('cameraStatus'+index);
    let deviceId=select.value;
    // Avoid capturing one physical camera more than once. Slots can share a captured source.
    const usedIds=new Set();
    for(let i=1;i<=3;i++)if(i!==index && state.streams['camera'+i]){
      const track=state.streams['camera'+i].getVideoTracks()[0];
      const chosen=$('cameraSelect'+i).value||track?.getSettings?.().deviceId;
      if(chosen)usedIds.add(chosen);
    }
    if(!deviceId){
      const options=Array.from(select.options).map(o=>o.value).filter(Boolean);
      deviceId=options.find(value=>!usedIds.has(value))||'';
    }
    if(deviceId && usedIds.has(deviceId)){
      toast('Câmera já está em outro canal. Selecione um dispositivo diferente.');return;
    }
    if(!deviceId&&index!==1){toast('Selecione uma câmera disponível para o canal '+index+'.');return;}
    const constraints={video:{width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30},...(deviceId?{deviceId:{exact:deviceId}}:{})},audio:false};
    try {
      let stream;
      try{stream=await navigator.mediaDevices.getUserMedia(constraints);}
      catch(err){
        // Relax resolution/framerate but never silently substitute another device.
        if(!deviceId)stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
        else stream=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:deviceId}},audio:false});
      }
      if(state.sources.get('guest_'+id)?.stream===stream)return;
    const video=document.createElement('video');video.autoplay=true;video.muted=true;video.playsInline=true;video.srcObject=stream;
      try{await video.play()}catch(_){}
      const old=state.streams[id],src=state.sources.get(id);
      src.element=video;src.ready=true;state.streams[id]=stream;
      const selectedDevice=stream.getVideoTracks()[0]?.getSettings?.().deviceId;
      if(!select.value&&selectedDevice&&[...select.options].some(o=>o.value===selectedDevice))select.value=selectedDevice;
      stream.getVideoTracks().forEach(track=>track.onended=()=>{
        if(state.streams[id]!==stream)return;
        src.element=null;src.ready=false;state.streams[id]=null;
        status.textContent='Desconectada • imagem de reserva';
        log(`Câmera ${index} desconectada; transmissão mantém os canvas com fallback.`, 'warn');
      });
      if(old)old.getTracks().forEach(track=>track.stop());
      status.textContent=stream.getVideoTracks()[0]?.label||'Câmera '+index+' conectada';
      log(`Câmera ${index} conectada para os dois formatos.`, 'good');
      toast('Câmera '+index+' disponível nos canvas 16:9 e 9:16.');refreshDevices();
    } catch(err){log('Falha na câmera '+index+': '+err.name,'err');toast('Câmera '+index+' indisponível. Verifique dispositivo e permissões.');}
  }
  function disconnectCamera(index){
    const id='camera'+index,stream=state.streams[id];
    state.streams[id]=null;
    const source=state.sources.get(id);source.element=null;source.ready=false;
    if(stream)stream.getTracks().forEach(t=>t.stop());
    $('cameraStatus'+index).textContent='Desconectada • imagem de reserva';
    log('Câmera '+index+' desconectada.','warn');
  }
  async function connectMic() {
    if(!navigator.mediaDevices?.getUserMedia){toast('Áudio não disponível neste contexto.');return;}
    const deviceId=$('microphoneSelect').value;
    try {
      let stream;
      try {stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,...(deviceId?{deviceId:{exact:deviceId}}:{})},video:false});}
      catch(error){if(!deviceId)throw error;stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});log('Microfone selecionado indisponível: usando padrão.','warn');}
      const old=state.streams.mic;connectMicStream(stream);state.streams.mic=stream;
      stream.getAudioTracks().forEach(track=>track.onended=()=>{
        if(state.streams.mic!==stream)return;
        state.streams.mic=null;$('micStatus').textContent='Microfone desconectado';
        log('Entrada de áudio desconectada. Outros áudios continuam ativos.','warn');
      });
      if(old)old.getTracks().forEach(track=>track.stop());
      $('micStatus').textContent=stream.getAudioTracks()[0]?.label||'Microfone conectado';
      log('Microfone conectado ao mixer de ambas as saídas.','good');refreshDevices();
    } catch(err) {log('Falha no microfone: '+err.name,'err');toast('Não foi possível acessar o microfone externo.');}
  }
  async function connectScreen() {
    if(!navigator.mediaDevices?.getDisplayMedia){toast('Compartilhamento de tela não disponível.');return;}
    try {
      const stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:30},audio:true});
      const old=state.streams.screen,src=state.sources.get('screen');
      if(state.sources.get('guest_'+id)?.stream===stream)return;
    const video=document.createElement('video');video.autoplay=true;video.muted=true;video.playsInline=true;video.srcObject=stream;
      await video.play();
      src.element=video;src.ready=true;state.streams.screen=stream;
      connectScreenSound(stream);
      stream.getVideoTracks()[0].onended=()=>{
        if(state.streams.screen!==stream)return;
        state.streams.screen=null;src.element=null;src.ready=false;
        log('Compartilhamento de tela encerrado.','warn');
      };
      if(old)old.getTracks().forEach(t=>t.stop());
      log('Compartilhamento de tela conectado.','good');
    } catch(err) {log('Compartilhamento cancelado ou indisponível.','warn');}
  }
  function streamForCanvas(format) {
    const a=ensureAudio(),videoStream=programCanvases[format].captureStream(30);
    const videoTracks=videoStream.getVideoTracks();
    const audioTracks=a.destination.stream.getAudioTracks().map(t=>t.clone());
    return new MediaStream([...videoTracks,...audioTracks]);
  }
  function newRecorder(stream) {
    if(typeof MediaRecorder==='undefined')throw Error('MediaRecorder não está disponível.');
    const list=['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm'];
    const mimeType=list.find(t=>MediaRecorder.isTypeSupported(t));
    if(!mimeType) throw Error('Este ambiente não suporta gravação WebM.');
    return new MediaRecorder(stream,{mimeType,videoBitsPerSecond:3500000,audioBitsPerSecond:128000});
  }
  function refreshRecordState() {
    const active=['h','v'].filter(f=>state.recordings[f]);
    $('recordingState').textContent=active.length?`Gravando ${active.map(f=>f==='h'?'16:9':'9:16').join(' + ')}`:'Inativa';
    $('btnRecordBoth').disabled=active.length>0;
    $('btnStopBoth').disabled=!active.length;
    $('btnRecH').textContent=state.recordings.h?'■ Parar 16:9':'● Gravar 16:9';
    $('btnRecV').textContent=state.recordings.v?'■ Parar 9:16':'● Gravar 9:16';
    $('systemStatus').textContent=active.length?'● GRAVANDO':'● Preparado';
    $('systemStatus').style.color=active.length?'#ff7d90':'#7bdab5';
  }
  const timestamp=()=>new Date().toISOString().replace(/[:.]/g,'-');
  async function chooseFolder(){
    if(!bridge)return null;
    if(state.recordFolder)return state.recordFolder;
    const folder=await bridge.chooseRecordingFolder();
    if(folder)state.recordFolder=folder;
    return folder;
  }
  async function startRecording(format,folder=null) {
    if(state.recordings[format])return;
    let stream,rec;
    try{stream=streamForCanvas(format);rec=newRecorder(stream);}catch(err){toast('Gravação: '+err.message);log(err.message,'err');return false;}
    const id=makeId('rec'),filename=`broadcast_${format==='h'?'16x9':'9x16'}_${timestamp()}.webm`;
    if(bridge){
      folder=folder||await chooseFolder();
      if(!folder){stream.getTracks().forEach(t=>t.stop());return false;}
      const status=await bridge.startRecordingFile({id,format,directory:folder,filename});
      if(!status?.ok){stream.getTracks().forEach(t=>t.stop());toast(status?.error||'Erro ao abrir arquivo de gravação');return false;}
    }
    const session={id,rec,stream,chunks:[],chain:Promise.resolve(),filename};
    rec.ondataavailable=e=>{
      if(!e.data?.size)return;
      if(bridge){const blob=e.data;session.chain=session.chain.then(()=>blob.arrayBuffer()).then(buf=>bridge.sendRecordingChunk(id,buf)).catch(()=>log('Falha ao enviar trecho de gravação.','err'));}
      else session.chunks.push(e.data);
    };
    rec.onerror=e=>log('Erro do MediaRecorder: '+String(e.error?.message||'erro inesperado'),'err');
    rec.onstop=async()=>{
      await session.chain;
      if(bridge){
        try {const result=await bridge.stopRecordingFile(id);if(result?.ok)log('Arquivo salvo: '+result.filepath,'good');else log('Falha ao salvar gravação: '+filename,'err');}
        catch(_){log('Erro ao finalizar gravação de '+filename,'err');}
      }else{
        const blob=new Blob(session.chunks,{type:'video/webm'});
        if(blob.size){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),45000);log('Gravação disponibilizada para download: '+filename,'good');}
        else log('A gravação não produziu dados.','err');
      }
      stream.getTracks().forEach(t=>t.stop());
      if(state.recordings[format]===session)state.recordings[format]=null;
      refreshRecordState();
    };
    try {rec.start(800);}catch(err){if(bridge)await bridge.stopRecordingFile(id);stream.getTracks().forEach(t=>t.stop());toast('Não foi possível iniciar a gravação.');return false;}
    state.recordings[format]=session;refreshRecordState();log(`Gravação ${format==='h'?'16:9':'9:16'} iniciada.`,'good');return true;
  }
  async function recordBoth() {
    const folder=bridge?await chooseFolder():null;
    if(bridge&&!folder)return;
    // Each output is created individually, ensuring both deliver separate complete program compositions.
    const first=await startRecording('h',folder);
    const second=await startRecording('v',folder);
    if(!first||!second)toast('Verifique as duas gravações; uma delas pode não ter iniciado.');
  }
  function stopRecording(format) {
    const s=state.recordings[format];if(s&&s.rec.state!=='inactive'){s.rec.stop();log(`Finalizando gravação ${format.toUpperCase()}...`);}
  }
  function stopBoth() {stopRecording('h');stopRecording('v');}

  function renderDestinations() {
    const box=$('destList');box.replaceChildren();
    const active=state.destinations.filter(x=>x.status==='iniciando'||x.status==='enviando').length;
    $('rtmpCount').textContent=active+' ativas';
    for(const dest of state.destinations){
      const row=document.createElement('div');row.className='dest-item';
      const ico=document.createElement('span');ico.className='item-ico';ico.textContent=dest.format==='h'?'▭':'▯';
      const detail=document.createElement('div');detail.className='item-content';
      const title=document.createElement('strong');title.textContent=dest.name;
      const status=document.createElement('small');status.className='state'+(dest.status==='enviando'?' ok':dest.status==='erro'?' fail':'');
      status.textContent=(dest.format==='h'?'16:9':'9:16')+' • '+({idle:'Aguardando',iniciando:'Iniciando',enviando:'Enviando',erro:'Erro',parado:'Parado'}[dest.status]||dest.status);
      detail.append(title,status);
      const remove=document.createElement('button');remove.className='icon-btn';remove.textContent='×';remove.title='Excluir destino';remove.onclick=()=>{stopOutput(dest);state.destinations=state.destinations.filter(x=>x!==dest);renderDestinations();};
      row.append(ico,detail,remove);box.append(row);
    }
  }
  function addDestination() {
    const name=$('destName').value.trim(),url=$('destUrl').value.trim(),format=$('destFormat').value;
    if(!name){toast('Informe um nome para o destino.');return;}
    if(!/^rtmps?:\/\/[^\s/]+\/.+/i.test(url)){toast('Informe a URL RTMP/RTMPS completa, com chave.');return;}
    state.destinations.push({id:makeId('out'),name:name.slice(0,80),url,format,status:'idle',recorder:null,chain:Promise.resolve()});
    $('destName').value='';$('destUrl').value='';
    renderDestinations();log('Destino criado: '+name+' ('+format.toUpperCase()+').','good');
  }
  async function startOutput(dest) {
    if(!bridge){toast('Saída RTMP exige a versão desktop Electron.');return;}
    if(dest.recorder||['iniciando','enviando'].includes(dest.status))return;
    let stream,rec;
    try{stream=streamForCanvas(dest.format);rec=newRecorder(stream);}
    catch(err){dest.status='erro';renderDestinations();log('RTMP: '+err.message,'err');return;}
    const res=await bridge.startRtmp({id:dest.id,url:dest.url,format:dest.format});
    if(!res?.ok){stream.getTracks().forEach(t=>t.stop());dest.status='erro';renderDestinations();log('RTMP '+dest.name+': '+res?.error,'err');return;}
    dest.stream=stream;dest.recorder=rec;dest.chain=Promise.resolve();dest.status='iniciando';renderDestinations();
    rec.ondataavailable=e=>{
      if(!e.data?.size)return;
      const blob=e.data;
      dest.chain=dest.chain.then(()=>blob.arrayBuffer()).then(buf=>bridge.sendChunk(dest.id,buf)).catch(()=>log('RTMP: envio de fragmento falhou.','err'));
    };
    rec.onerror=()=>{dest.status='erro';renderDestinations();log('Falha no codificador RTMP: '+dest.name,'err');};
    rec.onstop=async()=>{
      await dest.chain;
      try{await bridge.stopRtmp(dest.id);}catch(_){}
      if(dest.recorder===rec){dest.recorder=null;dest.stream=null;if(dest.status!=='erro')dest.status='parado';}
      stream.getTracks().forEach(t=>t.stop());renderDestinations();
    };
    try{rec.start(600);log('Enviando composição '+dest.format.toUpperCase()+' para '+dest.name+'.','good');}
    catch(_){dest.status='erro';dest.recorder=null;stream.getTracks().forEach(t=>t.stop());await bridge.stopRtmp(dest.id);renderDestinations();}
  }
  function stopOutput(dest) {
    if(dest.recorder&&dest.recorder.state!=='inactive')dest.recorder.stop();
    else if(bridge)bridge.stopRtmp(dest.id).catch(()=>{});
    if(dest.status!=='erro')dest.status='parado';renderDestinations();
  }
  async function startAllOutputs() {
    if(!bridge){toast('Para transmitir via RTMP, execute o app desktop com FFmpeg.');return;}
    if(!state.destinations.length){toast('Adicione ao menos um destino RTMP.');return;}
    if(state.destinations.length>3)toast('Vários encoders simultâneos exigem CPU/GPU potente; monitore o desempenho.');
    for(const dest of state.destinations)if(!dest.recorder)await startOutput(dest);
  }
  function stopAllOutputs() {for(const dest of state.destinations)stopOutput(dest);}

  function exportPreset() {
    const data=JSON.stringify({app:'Broadcast Studio Dual Canvas',version:1,scenes:state.preview},null,2);
    const blob=new Blob([data],{type:'application/json'}),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download='broadcast-dualcanvas-preset.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
    log('Preset de composição exportado.','good');
  }
  async function importPreset(file) {
    if(!file)return;
    try{
      const data=JSON.parse(await file.text());if(!data.scenes?.h||!data.scenes?.v)throw Error('Formato inválido');
      state.preview.h=normalizeScene(data.scenes.h,'h');state.preview.v=normalizeScene(data.scenes.v,'v');rememberAuthoredLayout('h');rememberAuthoredLayout('v');
      for(const f of ['h','v'])for(const slot of state.preview[f].slots)if(slot.id.endsWith('_playlist')&&slot.sourceId&&!state.sources.has(slot.sourceId))slot.sourceId=null;
      renderChannels();
      setSelected('h',state.preview.h.slots[0]?.id||null);
      for(const [format,title,sub,on] of [['h','gcTitleH','gcSubH','gcOnH'],['v','gcTitleV','gcSubV','gcOnV']]) {
        $(title).value=state.preview[format].gc.title;$(sub).value=state.preview[format].gc.sub;$(on).checked=state.preview[format].gc.on;
      }
      syncBrandingInputs();
      saveLocal();log('Preset importado na PRÉVIA. Clique em No ar para aplicar.','good');toast('Preset carregado na prévia.');
    }catch(_){toast('Arquivo de preset inválido.');}
    $('presetFile').value='';
  }
  // Quick layout presets update PREVIEW only, keeping the four fixed channels.
  function applyLayout(mode){
    const f=$('layoutFormat').value,slots=state.preview[f].slots;
    const requestedMain=Number($('layoutMain').value);
    const main=mode==='camera'?(requestedMain===3?0:requestedMain):mode==='playlist'?3:requestedMain;
    let second=Number($('layoutSecond').value);if(second===main)second=main===3?0:3;
    const place=(id,x,y,w,h,fit='cover')=>{const s=slots[id];s.enabled=true;s.x=x;s.y=y;s.w=w;s.h=h;s.fit=fit;};
    slots.forEach(s=>s.enabled=false);
    const primaryFit=main===3?'contain':'cover';
    if(['full','camera','playlist'].includes(mode)) place(main,0,0,1,1,primaryFit);
    else if(mode==='split'){
      // Preserve exactly the user's original window geometry and image fit.
      // Split is a visibility switch, NOT an auto-layout command.
      for(const i of [main,second]){
        const slot=slots[i],saved=state.authoredLayout[f][i];
        if(saved)for(const key of geometryKeys)slot[key]=saved[key];
        slot.enabled=true;
      }
    }else if(mode==='pip'){
      place(main,0,0,1,1,primaryFit);
      place(second,f==='h'?.668:.48,f==='h'?.59:.71,f==='h'?.30:.49,f==='h'?.36:.265,second===3?'contain':'cover');
    }else if(mode==='grid'){
      const coords=f==='h'?[[.018,.035,.475,.445],[.507,.035,.475,.445],[.018,.505,.475,.445],[.507,.505,.475,.445]]:[[.028,.018,.944,.227],[.028,.26,.944,.227],[.028,.503,.944,.227],[.028,.745,.944,.227]];
      slots.forEach((s,i)=>place(i,...coords[i],i===3?'contain':'cover'));
    }
    setSelected(f,slots[main].id);saveLocal();renderChannels();syncWebOverlays();
    log(mode==='split'?'Divisão aplicada mantendo tamanho e posição originais no canvas '+f.toUpperCase()+'.':'Layout '+mode+' aplicado na PRÉVIA '+f.toUpperCase()+'; PROGRAMA preservado.','good');
  }

  // Host-to-guest WebRTC signaling over isolated local producer and guest HTTP endpoints.
  // To invite someone on a phone outside localhost, expose ONLY guest port 8792 over HTTPS.
  const guestApi=async(endpoint,body=null,query='')=>{
    const u=new URL('http://127.0.0.1:8791/api/'+endpoint);
    if(endpoint!=='rooms'&&state.guests.room)u.searchParams.set('room',state.guests.room);
    if(query)for(const [key,value] of new URLSearchParams(query.replace(/^\?/,'')))u.searchParams.set(key,value);
    const res=await fetch(u.href,{method:body===null?'GET':'POST',headers:{'Content-Type':'application/json',...(state.guests.hostToken?{'x-studio-token':state.guests.hostToken}:{})},...(body!==null?{body:JSON.stringify(body)}:{})});
    const data=await res.json();if(!res.ok)throw Error(data.error||'Erro na sinalização');return data;
  };

const guestLink=(base)=>{
  const g=state.guests;
  if(!base||!g.room||!g.guestToken)return null;
  return base+'/guest.html?room='+encodeURIComponent(g.room)+'&token='+encodeURIComponent(g.guestToken);
};
let inviteValidatedBase=null;
function showInvite(){
  const g=state.guests;
  if(!g.room){$('inviteDetails').hidden=true;return;}
  $('inviteDetails').hidden=false;
  const share=inviteValidatedBase;
  $('inviteLink').value=share?guestLink(share):'';
  $('btnCopyInvite').disabled=!share;
  $('btnOpenInvite').disabled=false;
  $('btnOpenInvite').textContent=share?'Abrir convite público':'Testar neste PC';
  $('inviteWarning').textContent=share?
    'Convite HTTPS verificado. Compartilhe somente com convidados autorizados; a sala depende de conexão ativa.':
    'Ainda não existe convite público validado. 127.0.0.1 funciona apenas neste computador. Clique em Ativar convite HTTPS.';
  $('inviteLink').classList.toggle('local-only',!share);
}
async function validateManualInvite(){
  const candidate=$('publicUrl').value.trim();
  if(!state.guests.room){toast('Crie a sala primeiro.');return;}
  inviteValidatedBase=null;showInvite();
  if(!candidate){$('guestServiceStatus').textContent='Informe o domínio HTTPS ou ative o túnel.';return;}
  $('btnVerifyPublic').disabled=true;
  $('guestServiceStatus').textContent='Verificando se seu domínio HTTPS abre a sala correta...';
  try{
    const verified=await guestApi('check-public',{baseUrl:candidate});
    inviteValidatedBase=verified.baseUrl;
    $('publicUrl').value=verified.baseUrl;
    showInvite();$('guestServiceStatus').textContent='HTTPS validado; convite disponível para compartilhar.';
    log('Domínio HTTPS validado contra o servidor de convidados.','good');
  }catch(err){$('guestServiceStatus').textContent='Domínio inválido ou inacessível: '+err.message;toast('Convite não liberado: '+err.message);}
  finally{$('btnVerifyPublic').disabled=false;}
}
async function checkCloudflared(){
  const status=$('cloudflaredStatus'),button=$('btnCheckCloudflared');
  if(!state.guests.room){status.textContent='Crie uma sala primeiro para verificar o túnel.';return false;}
  button.disabled=true;
  try{
    const result=await guestApi('cloudflared-diagnostic');
    const ok=!!result.installed;
    status.textContent=ok?'cloudflared detectado ('+(result.version||'versão não informada')+'). Agora clique em Ativar convite HTTPS.':
      'Não encontrado ou inválido ('+result.reason+'). Instale pela origem oficial. Se já instalou, selecione o executável no modo desktop ou reinicie o aplicativo.';
    status.classList.toggle('cloud-ok',ok);
    return ok;
  }catch(err){status.textContent='Falha ao consultar o servidor: '+err.message;return false;}
  finally{button.disabled=false;}
}
async function chooseCloudflared(){
  if(!bridge?.selectCloudflared)return toast('Seleção de executável disponível apenas no Electron.');
  try{
    const result=await bridge.selectCloudflared();
    if(result?.cancelled)return;
    if(!result?.ok){toast(result?.error||'Não foi possível selecionar o arquivo.');return;}
    await checkCloudflared();toast('Cloudflared localizado. Agora ative o convite HTTPS.');
  }catch(err){toast('Falha na seleção: '+err.message);}
}
async function startPublicInvite(){
  if(!state.guests.room){toast('Crie a sala antes de habilitar o convite público.');return;}
  inviteValidatedBase=null;showInvite();
  $('btnHttpsInvite').disabled=true;
  $('guestServiceStatus').textContent='Verificando o cloudflared já instalado e a conexão HTTPS...';
  try{
    const result=await guestApi('tunnel',{});
    if(!result.ok||!result.baseUrl)throw Error(result.error||'Túnel não iniciou');
    inviteValidatedBase=result.baseUrl;
    $('publicUrl').value=result.baseUrl;
    showInvite();$('guestServiceStatus').textContent='Convite HTTPS verificado — '+new URL(result.baseUrl).hostname;
    log('Túnel HTTPS de convidados verificado. Estúdio permanece local.','good');
  }catch(err){$('guestServiceStatus').textContent='Convite HTTPS: '+err.message;toast('Não foi possível ativar HTTPS: '+err.message);log('Túnel HTTPS: '+err.message,'warn');}
  finally{$('btnHttpsInvite').disabled=false;}
}
  function openInvite(){
    const url=inviteValidatedBase?guestLink(inviteValidatedBase):guestLink(state.guests.localGuestBase);
    if(!url)return toast('Crie uma sala primeiro.');
    if(bridge?.openExternal)bridge.openExternal(url).catch(()=>toast('Não foi possível abrir o link de teste.'));
    else window.open(url,'_blank','noopener,noreferrer');
  }
  async function createGuestRoom(){try{
    const g=state.guests;clearTimeout(g.watch);for(const pc of g.connections.values())pc.close();g.connections.clear();g.entries.clear();g.cursor=0;
    inviteValidatedBase=null;
    const data=await guestApi('rooms',{});g.room=data.room;g.hostToken=data.hostToken;g.guestToken=data.guestToken;g.localGuestBase=data.localGuestBase;
    const ice=await guestApi('config',null,'?room='+encodeURIComponent(g.room));g.iceServers=ice.iceServers;g.iceTransportPolicy=ice.iceTransportPolicy||'all';
    showInvite();renderGuests();pollGuests();$('guestServiceStatus').textContent='Sala ativa • aguardando convidados';
    checkCloudflared().catch(()=>{});
    log('Sala de convidados criada; convites habilitados.','good');
  }catch(err){$('guestServiceStatus').textContent='Servidor indisponível: '+err.message;toast('Inicie o aplicativo com o servidor Node para convidar pessoas.');}}
  async function signalToGuest(id,type,signal){const g=state.guests;if(!g.room)return;try{await guestApi('signal',{guestId:id,type,signal})}catch(err){log('Falha na sinalização do convidado: '+err.message,'warn')}}
  function getGuestReturnStream(id){
    const a=ensureAudio();
    if(a.returnBuses.has(id))return a.returnBuses.get(id).stream;
    const bus=a.ctx.createMediaStreamDestination();a.returnBuses.set(id,bus);
    a.micGain.connect(bus);
    // Mix-minus: the invited person hears studio mic, playlist and OTHER approved guests,
    // but not their own voice (avoids feedback / echo).
    for(const src of state.sources.values())if(src.gainNode && (src.kind!=='guest'||src.id!=='guest_'+id))src.gainNode.connect(bus);
    return bus.stream;
  }
  function removeGuest(id){
    const g=state.guests,pc=g.connections.get(id);if(pc){pc.close();g.connections.delete(id)}g.pendingIce.delete(id);
    const a=state.audio,bus=a?.returnBuses.get(id);
    if(bus){try{a.micGain.disconnect(bus);}catch(_){}for(const src of state.sources.values())if(src.gainNode)try{src.gainNode.disconnect(bus);}catch(_){}a.returnBuses.delete(id);}
    
    const src=state.sources.get('guest_'+id);if(src?.audioNode)try{src.audioNode.disconnect();src.gainNode?.disconnect()}catch(_){}
    if(src){src.element?.pause();if(src.element)src.element.srcObject=null;state.sources.delete(src.id)}
    const guest=g.entries.get(id);if(guest){guest.connected=false;guest.status='Saiu';}
    renderGuests();renderMedia();refreshSlotSource();
    log('Convidado desconectado. Layout preservado com imagem de reserva.','warn');
  }
  function attachGuestStream(id,stream){
    const g=state.guests,guest=g.entries.get(id);if(!guest)return;
    if(state.sources.get('guest_'+id)?.stream===stream)return;
    const video=document.createElement('video');video.autoplay=true;video.muted=true;video.playsInline=true;video.srcObject=stream;
    video.play().catch(()=>{});
    const source=emptySource('guest_'+id,guest.name,'guest');source.element=video;source.ready=true;source.stream=stream;source.volume=1;
    // Remote audio must feed the PROGRAM bus, not the studio speakers (avoid echo).
    if(stream.getAudioTracks().length){try{const a=ensureAudio();source.audioNode=a.ctx.createMediaStreamSource(stream);source.gainNode=a.ctx.createGain();source.audioNode.connect(source.gainNode);source.gainNode.connect(a.destination);
      for(const [otherId,bus] of a.returnBuses.entries())if(otherId!==id)source.gainNode.connect(bus);}catch(_){log('Áudio remoto indisponível.','warn')}}
    state.sources.set(source.id,source);guest.status='Conectado';guest.connected=true;
    renderGuests();renderMedia();refreshSlotSource();
    log('Vídeo recebido do convidado '+guest.name+'.','good');
  }
  function hostConnection(id){const g=state.guests;if(g.connections.has(id))return g.connections.get(id);
    const pc=new RTCPeerConnection({iceServers:g.iceServers||[{urls:'stun:stun.l.google.com:19302'}],iceTransportPolicy:g.iceTransportPolicy||'all'});g.connections.set(id,pc);
    try{const returnAudio=getGuestReturnStream(id);for(const track of returnAudio.getAudioTracks())pc.addTrack(track,returnAudio);}catch(_){log('Retorno de áudio indisponível para convidado.','warn');}
    pc.onicecandidate=e=>{if(e.candidate)signalToGuest(id,'ice',e.candidate.toJSON());};
    pc.ontrack=e=>{const stream=e.streams?.[0]||new MediaStream([e.track]);if(e.track.kind==='video'||!state.sources.has('guest_'+id))attachGuestStream(id,stream);};
    pc.onconnectionstatechange=()=>{const guest=g.entries.get(id);if(guest){guest.status=pc.connectionState;renderGuests();}if(['failed','closed'].includes(pc.connectionState))log('WebRTC '+id+': '+pc.connectionState,'warn');};
    return pc;
  }
  async function handleGuestSignal(event){const id=event.guestId,g=state.guests,pc=hostConnection(id);
    try{
      if(event.signalType==='offer'){
        await pc.setRemoteDescription(new RTCSessionDescription(event.signal));
        const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await signalToGuest(id,'answer',pc.localDescription.toJSON());
        for(const ice of (g.pendingIce.get(id)||[]))await pc.addIceCandidate(ice).catch(()=>{});g.pendingIce.delete(id);
      }else if(event.signalType==='ice'){
        if(pc.remoteDescription)await pc.addIceCandidate(event.signal).catch(()=>{});
        else g.pendingIce.set(id,[...(g.pendingIce.get(id)||[]),event.signal]);
      }
    }catch(err){log('WebRTC: '+err.message,'warn');}
  }
  async function pollGuests(){const g=state.guests;if(!g.room)return;
    try{const data=await guestApi('events',null,`?room=${encodeURIComponent(g.room)}&cursor=${g.cursor}`);
      for(const participant of data.guests){let item=g.entries.get(participant.id);if(!item){item={...participant,status:'Na sala de espera'};g.entries.set(item.id,item);}else{item.approved=participant.approved;item.connected=participant.connected;}}
      for(const ev of data.events){g.cursor=ev.seq;
        if(ev.type==='joined'){const item=g.entries.get(ev.guestId);if(item)item.status='Aguardando aprovação';log('Novo convidado: '+ev.name);}
        if(ev.type==='signal')await handleGuestSignal(ev);
        if(ev.type==='left')removeGuest(ev.guestId);
      }
      if(!data.events.length)g.cursor=Math.max(g.cursor,data.cursor);
      renderGuests();$('guestServiceStatus').textContent='Sala conectada • '+[...g.entries.values()].filter(x=>x.connected).length+' participante(s)';
    }catch(err){$('guestServiceStatus').textContent='Sinalização: '+err.message;}
    if(g.room)g.watch=setTimeout(pollGuests,950);
  }
  async function approveGuest(id,approve){try{await guestApi('approve',{guestId:id,approve});
    const entry=state.guests.entries.get(id);if(entry){entry.approved=approve;entry.status=approve?'Aguardando vídeo':'Recusado';}
    if(!approve)removeGuest(id);renderGuests();
  }catch(err){toast('Não foi possível aprovar: '+err.message)}}
  function assignGuest(id,channel){const src=state.sources.get('guest_'+id);if(!src){toast('Aguarde o vídeo do convidado conectar.');return;}
    for(const f of ['h','v'])state.preview[f].slots[channel-1].sourceId=src.id;
    setSelected('h',slotId('h',channel-1));saveLocal();renderGuests();log(src.name+' enviado ao canal '+channel+' nos dois canvas. Clique em No ar para aplicar.','good');
  }
  function renderGuests(){const g=state.guests,box=$('guestList');if(!box)return;box.replaceChildren();
    const entries=[...g.entries.values()].filter(x=>x.connected||x.approved);
    $('guestCount').textContent=entries.length+' / 8';
    if(!entries.length){const empty=document.createElement('p');empty.className='muted';empty.textContent=g.room?'Sem convidados. Compartilhe o link.':'Crie uma sala para liberar o convite.';box.append(empty);return;}
    for(const entry of entries){const row=document.createElement('div');row.className='guest-row';
      const header=document.createElement('header'),name=document.createElement('strong'),tag=document.createElement('span');name.textContent=entry.name;tag.textContent=entry.status||'Conectando';tag.className='guest-tag'+(entry.status==='Conectado'?' online':'');header.append(name,tag);row.append(header);
      const actions=document.createElement('div');actions.className='form-row';
      if(!entry.approved){const yes=document.createElement('button'),no=document.createElement('button');yes.className='btn green';no.className='btn subtle';yes.textContent='✓ Aceitar';no.textContent='× Recusar';yes.onclick=()=>approveGuest(entry.id,true);no.onclick=()=>approveGuest(entry.id,false);actions.append(yes,no);}
      else{for(let i=1;i<=3;i++){const btn=document.createElement('button');btn.className='btn subtle';btn.textContent='Câmera '+i;btn.disabled=!state.sources.has('guest_'+entry.id);btn.onclick=()=>assignGuest(entry.id,i);actions.append(btn);}}
      row.append(actions);box.append(row);
    }
  }
  async function testIceConnectivity(){
    const status=$('iceNetworkStatus'),button=$('btnTestIce');
    if(!state.guests.room){status.textContent='Crie uma sala primeiro para verificar as configurações de mídia.';return;}
    button.disabled=true;status.textContent='Verificando candidatos ICE; isto NÃO testa uma ligação completa.';
    let pc=null;
    try{
      const config=await guestApi('config',null,'?room='+encodeURIComponent(state.guests.room));
      pc=new RTCPeerConnection({iceServers:config.iceServers,iceTransportPolicy:config.iceTransportPolicy||'all'});
      const types=new Set();const add=s=>{const m=String(s||'').match(/\btyp (host|srflx|prflx|relay)\b/);if(m)types.add(m[1]);};
      pc.onicecandidate=e=>{if(e.candidate)add(e.candidate.candidate);};
      pc.createDataChannel('connectivity-test');
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;resolve();};const timeout=setTimeout(finish,7500);pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete'){clearTimeout(timeout);finish();}});});
      for(const line of (pc.localDescription?.sdp||'').split('\n'))if(line.startsWith('a=candidate:'))add(line);
      const result=types.has('relay')?'Relé TURN disponível (candidato relay).':types.has('srflx')?'STUN respondeu; TURN não confirmado.':types.has('host')?'Somente candidatos locais; rede externa pode falhar.':'Nenhum candidato ICE identificado.';
      status.textContent=result+' Política: '+(config.iceTransportPolicy||'all')+'. HTTPS e sinalização devem ser testados separadamente.';
      log('Diagnóstico ICE: '+result,types.has('relay')?'good':'warn');
    }catch(err){status.textContent='Teste ICE falhou: '+err.message;log('ICE: '+err.message,'warn');}
    finally{try{pc?.close()}catch(_){}button.disabled=false;}
  }
  function initGuests(){const g=state.guests;
    $('btnTestIce').onclick=testIceConnectivity;
    const mode=$('studioSourceMode');
    mode.onchange=()=>{
      $('directCamerasPanel').hidden=mode.value==='room';
      $('remoteGuestsPanel').hidden=mode.value==='camera';
      log('Modo de captação: '+(mode.value==='camera'?'câmeras diretas':mode.value==='room'?'sala remota':'misto')+' (sem desligar fontes ativas).');
    };
    mode.onchange();
    $('btnCreateRoom').onclick=createGuestRoom;
    $('btnHttpsInvite').onclick=startPublicInvite;
    $('btnCheckCloudflared').onclick=checkCloudflared;
    $('cloudflaredDocsLink').onclick=e=>{if(bridge?.openExternal){e.preventDefault();bridge.openExternal('https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/').catch(()=>toast('Não foi possível abrir a documentação.'));}};
    $('btnChooseCloudflared').hidden=!bridge?.selectCloudflared;
    $('btnChooseCloudflared').onclick=chooseCloudflared;
    $('btnOpenInvite').onclick=openInvite;
    $('btnVerifyPublic').onclick=validateManualInvite;
    // Never reuse ephemeral URLs from previous runs or silently declare an untested domain valid.
    $('publicUrl').value='';
    $('publicUrl').oninput=()=>{inviteValidatedBase=null;showInvite();};
    $('btnCopyInvite').onclick=async()=>{
      if(!inviteValidatedBase)return toast('Ative e valide um endereço HTTPS antes de compartilhar.');
      const value=guestLink(inviteValidatedBase);
      try{await navigator.clipboard.writeText(value);toast('Convite público copiado.');}
      catch(_){$('inviteLink').select();document.execCommand('copy');toast('Selecione o link para copiar.');}
    };
    showInvite();
  }
  function wireEvents() {
    for(let i=1;i<=3;i++){$('btnCamera'+i).onclick=()=>connectCamera(i);$('btnDisconnect'+i).onclick=()=>disconnectCamera(i);}
    $('btnMic').onclick=connectMic;$('btnScreen').onclick=connectScreen;$('btnRefreshDevices').onclick=refreshDevices;
    $('micVolume').oninput=e=>{const gain=Number(e.target.value);if(state.audio)state.audio.micGain.gain.value=gain;$('micVolumeText').textContent=Math.round(gain*100)+'%';};
    $('btnFiles').onclick=()=>$('mediaFiles').click();$('mediaFiles').onchange=e=>addFiles(e.target.files);
    $('btnAddUrl').onclick=addUrl;$('mediaUrl').onkeydown=e=>{if(e.key==='Enter')addUrl()};
    $('btnPrev').onclick=()=>nextPlaylist(-1);$('btnNext').onclick=()=>nextPlaylist(1);$('btnPlay').onclick=togglePlaylist;
    $('btnRehearse').onclick=()=>{if(!state.playlist.length){toast('Adicione um vídeo ou um link à playlist.');return;}loadPlaylistIndex(state.playIndex<0?0:state.playIndex);};
    $('btnAddH').onclick=()=>newSlot('h');$('btnAddV').onclick=()=>newSlot('v');
    $('btnFullscreenH').onclick=()=>$('previewWrapH').requestFullscreen?.().catch(()=>toast('Tela cheia indisponível.'));
    $('btnFullscreenV').onclick=()=>$('previewWrapV').requestFullscreen?.().catch(()=>toast('Tela cheia indisponível.'));
    document.querySelectorAll('[data-layout]').forEach(btn=>btn.onclick=()=>applyLayout(btn.dataset.layout));
    $('btnTakeH').onclick=()=>take('h');$('btnTakeV').onclick=()=>take('v');$('btnTakeBoth').onclick=()=>{take('h');take('v')};
    $('btnRecH').onclick=()=>state.recordings.h?stopRecording('h'):startRecording('h');
    $('btnRecV').onclick=()=>state.recordings.v?stopRecording('v'):startRecording('v');
    $('btnRecordBoth').onclick=recordBoth;$('btnStopBoth').onclick=stopBoth;
    $('btnDestAdd').onclick=addDestination;$('btnStartOutputs').onclick=startAllOutputs;$('btnStopOutputs').onclick=stopAllOutputs;
    $('btnSave').onclick=exportPreset;$('btnLoad').onclick=()=>$('presetFile').click();$('presetFile').onchange=e=>importPreset(e.target.files[0]);
    $('clearLog').onclick=()=>$('logs').replaceChildren();
    if(navigator.mediaDevices?.addEventListener)navigator.mediaDevices.addEventListener('devicechange',()=>{refreshDevices();log('Alteração detectada nos dispositivos.','warn');});
    window.addEventListener('beforeunload',()=>{for(const f of ['h','v'])if(state.recordings[f]){ /* Prevent silent data loss with native browser warning below. */ }
      for(const src of state.sources.values())if(src.objectUrl)URL.revokeObjectURL(src.objectUrl);
    });
    window.addEventListener('beforeunload',e=>{if(state.recordings.h||state.recordings.v){e.preventDefault();e.returnValue='';}});
  }
  // Read-only integration surface for the remote LiveKit Cloud room manager.
  // Room secrets and token signing never run in this local frontend.
  window.BroadcastStudioCloudBridge={
    entry:id=>state.guests.entries.get(id),
    register:(id,name)=>state.guests.entries.set(id,{id,name,connected:true,approved:true,status:'Conectado'}),
    attach:attachGuestStream,
    remove:removeGuest,
    assign:assignGuest,
    getMicStream:()=>state.streams.mic
  };
  async function boot() {
    for(const f of ['h','v'])setupCanvasInteraction(f);
    renderMedia();renderPlaylist();wireInspector();wireBranding();wireEvents();refreshInspector();renderChannels();syncBrandingInputs();refreshRecordState();renderDestinations();
    requestAnimationFrame(loop);
    initAdFilter();
    if(!bridge){$('ffmpegInfo').textContent='Modo navegador: RTMP indisponível';$('btnStartOutputs').disabled=true;log('Modo navegador: composição e gravação WebM disponíveis. RTMP requer desktop.','warn');}
    else{
      try{const res=await bridge.ffmpegStatus();state.outputAvailable=!!res.available;$('ffmpegInfo').textContent=res.available?'FFmpeg detectado — RTMP disponível':'FFmpeg ausente — instale e reinicie';$('btnStartOutputs').disabled=!res.available;
        if(!res.available)log('RTMP indisponível: FFmpeg não encontrado no PATH.','warn');
      }catch(_){$('ffmpegInfo').textContent='FFmpeg: não foi possível verificar';}
      bridge.onStatus(({id,state:next,message})=>{
        const dest=state.destinations.find(d=>d.id===id);
        if(!dest)return;
        dest.status=next;renderDestinations();
        if(next==='erro'){
          log(`${dest.name}: ${message||'saída RTMP falhou'}`,'err');
          if(dest.recorder){stopOutput(dest);dest.status='erro';renderDestinations();}
        }
      });
    }
    initGuests();refreshDevices();log('Broadcast Studio v1.8.0: divisão mantém layout manual; convites com rotas WebRTC corrigidas e opção HTTPS.','good');
  }
  boot();
})();
