'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const params=new URLSearchParams(location.search),room=params.get('room'),token=params.get('token');
 let media=null,pc=null,guestId=null,secret=null,cursor=0,looping=false,interval=null,pendingIce=[],changingDevice=false;
 const status=(s,error=false)=>{$('guestStatus').textContent=s;$('guestStatus').classList.toggle('error',error);};
 const api=async(path,body,method='POST')=>{const u=new URL('/api/'+path,location.origin);if(path!=='join'){u.searchParams.set('room',room);if(guestId)u.searchParams.set('guestId',guestId);}if(method==='GET')u.searchParams.set('cursor',String(cursor));const res=await fetch(u.href,{method,headers:{'Content-Type':'application/json',...(secret?{'x-guest-token':secret}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})});const data=await res.json();if(!res.ok)throw Error(data.error||'Falha de conexão');return data;};
 let iceServers=[{urls:'stun:stun.l.google.com:19302'}],iceTransportPolicy='all';const iceConfig=()=>({iceServers,iceTransportPolicy});
 async function send(type,signal){if(!pc||!guestId)return;try{await api('signal',{type,signal})}catch(e){status('Erro ao enviar sinal: '+e.message,true)}}
 async function getPC(){if(pc)return pc;pc=new RTCPeerConnection(iceConfig());pc.onicecandidate=e=>{if(e.candidate)send('ice',e.candidate.toJSON())};
 pc.ontrack=e=>{if(e.track.kind==='audio'){
   const el=$('studioAudio');el.srcObject=e.streams?.[0]||new MediaStream([e.track]);
   el.play().then(()=>$('btnAudio').hidden=true).catch(()=>$('btnAudio').hidden=false);
 }};pc.onconnectionstatechange=()=>status(({connected:'Conectado ao estúdio. Você está enviando áudio/vídeo.',connecting:'Conectando com o estúdio...',failed:'Conexão de vídeo falhou. Confira a rede ou servidor TURN.',disconnected:'Conexão instável. Tentando recuperar.',closed:'Conexão encerrada.'})[pc.connectionState]||'Conectando...');for(const track of media.getTracks())pc.addTrack(track,media);return pc;}
 async function offer(){const config=await api('config',null,'GET');if(config.iceServers)iceServers=config.iceServers;if(config.iceTransportPolicy)iceTransportPolicy=config.iceTransportPolicy;const connection=await getPC();const description=await connection.createOffer();await connection.setLocalDescription(description);await send('offer',connection.localDescription.toJSON());}
 async function handle(e){if(e.type==='approved'){status('Entrada aprovada! Conectando seu vídeo ao estúdio...');await offer();}else if(e.type==='rejected'){await leave(true);status('O produtor recusou a entrada.',true);}else if(e.type==='signal'){
   const connection=await getPC();if(e.signalType==='answer'){await connection.setRemoteDescription(new RTCSessionDescription(e.signal));for(const candidate of pendingIce.splice(0))await connection.addIceCandidate(candidate).catch(()=>{});}
   if(e.signalType==='ice'){if(connection.remoteDescription)await connection.addIceCandidate(e.signal).catch(()=>{});else pendingIce.push(e.signal);}
 }}
 async function poll(){if(!looping)return;try{const data=await api('events',null,'GET');for(const event of data.events){cursor=event.seq;await handle(event);}if(!data.events.length)cursor=Math.max(cursor,data.cursor);}catch(err){status('Sala temporariamente indisponível: '+err.message,true);}if(looping)interval=setTimeout(poll,950);}
 const constraints=()=>({video:$('guestCamera').checked?{...($('guestCameraSelect').value?{deviceId:{ideal:$('guestCameraSelect').value}}:{})}:false,audio:$('guestMic').checked?{echoCancellation:true,noiseSuppression:true,autoGainControl:true,...($('guestMicSelect').value?{deviceId:{ideal:$('guestMicSelect').value}}:{})}:false});
 async function acquire(){
   const requested=constraints();if(!requested.video&&!requested.audio)throw Error('Ative a câmera ou o microfone.');
   try{return await navigator.mediaDevices.getUserMedia(requested);}
   catch(err){
     if(requested.video&&requested.audio){
       try{const s=await navigator.mediaDevices.getUserMedia({...requested,audio:false});$('guestMic').checked=false;status('Microfone indisponível; usando só vídeo.');return s;}catch(_){}
       const s=await navigator.mediaDevices.getUserMedia({...requested,video:false});$('guestCamera').checked=false;status('Câmera indisponível; usando só áudio.');return s;
     }
     throw err;
   }
 }
 async function refreshDevices(){
   if(!navigator.mediaDevices?.enumerateDevices)return;
   try{const devices=await navigator.mediaDevices.enumerateDevices();
     for(const [id,kind,label] of [['guestCameraSelect','videoinput','Câmera'],['guestMicSelect','audioinput','Microfone']]){
       const select=$(id),selected=select.value;select.replaceChildren(new Option(label+' padrão',''));
       devices.filter(d=>d.kind===kind).forEach((d,i)=>select.add(new Option(d.label||label+' '+(i+1),d.deviceId)));
       if([...select.options].some(o=>o.value===selected))select.value=selected;
     }
   }catch(_){status('Não foi possível listar dispositivos. Verifique permissões do navegador.',true);}
 }
 async function switchDevice(){
   if(!media||changingDevice)return;
   changingDevice=true;
   try{const fresh=await acquire(),old=media;media=fresh;
     if(pc){
       for(const kind of ['video','audio']){
         const track=fresh.getTracks().find(t=>t.kind===kind)||null;
         const sender=pc.getSenders().find(s=>s.track?.kind===kind);
         if(sender)await sender.replaceTrack(track);
         else if(track){status('Nova trilha '+kind+' disponível. Para ativá-la na chamada, saia e entre novamente.');}
       }
     }
     $('guestPreview').srcObject=fresh;$('guestPlaceholder').hidden=!fresh.getVideoTracks().length;
     old.getTracks().forEach(t=>t.stop());await refreshDevices();
     if(pc?.connectionState==='connected')status('Dispositivo substituído na transmissão.');
   }catch(err){status('Não foi possível trocar o dispositivo: '+err.message,true)}finally{changingDevice=false;}
 }
 async function join(){if(!room||!token){status('Link de convite incompleto.',true);return;}if(!navigator.mediaDevices?.getUserMedia){status('A câmera exige HTTPS ou localhost. Abra o convite seguro.',true);return;}$('guestJoin').disabled=true;try{media=await acquire();$('guestPreview').srcObject=media;$('guestPlaceholder').hidden=!media.getVideoTracks().length;await refreshDevices();const data=await api('join',{room,token,name:$('guestName').value});guestId=data.guestId;secret=data.guestSecret;$('guestLeave').hidden=false;status('Na sala de espera. Aguardando aprovação do produtor...');looping=true;poll();}catch(err){status('Não foi possível entrar: '+err.message,true);$('guestJoin').disabled=false;if(media){media.getTracks().forEach(t=>t.stop());media=null;}}}
 async function leave(notify=true){looping=false;clearTimeout(interval);if(notify&&guestId)try{await api('leave',{})}catch(_){}if(pc){pc.close();pc=null;}if(media){media.getTracks().forEach(t=>t.stop());media=null;}$('guestPreview').srcObject=null;$('studioAudio').srcObject=null;$('btnAudio').hidden=true;$('guestPlaceholder').hidden=false;guestId=null;secret=null;$('guestLeave').hidden=true;$('guestJoin').disabled=false;if(notify)status('Você saiu da sala.');}
 $('guestJoin').onclick=join;$('guestLeave').onclick=()=>leave();$('btnAudio').onclick=()=>{$('studioAudio').play().then(()=>$('btnAudio').hidden=true).catch(()=>status('Toque em Ativar áudio para ouvir o estúdio.'));};$('guestCameraSelect').onchange=switchDevice;$('guestMicSelect').onchange=switchDevice;$('guestRefreshDevices').onclick=refreshDevices;
 $('guestCamera').onchange=e=>{if(media&&!media.getVideoTracks().length&&e.target.checked){switchDevice();return;}for(const t of media?.getVideoTracks()||[])t.enabled=e.target.checked};$('guestMic').onchange=e=>{if(media&&!media.getAudioTracks().length&&e.target.checked){switchDevice();return;}for(const t of media?.getAudioTracks()||[])t.enabled=e.target.checked};
 window.addEventListener('pagehide',()=>{if(media)media.getTracks().forEach(t=>t.stop());if(pc)pc.close();});if(!room||!token)status('Convite incompleto ou inválido.',true);refreshDevices();
})();
