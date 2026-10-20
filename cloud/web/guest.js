'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const p=new URLSearchParams(location.search),roomId=p.get('room'),invite=p.get('invite');
 let room=null,media=null,guestId=null,access=null,pollTimer=null,publishing=false;
 const audioElements=new Set();
 const status=(message,error=false)=>{$('guestStatus').textContent=message;$('guestStatus').classList.toggle('error',error);};
 async function api(endpoint,body=null){const result=await fetch(endpoint,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(access?{'x-guest-secret':access}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await result.json();if(!result.ok)throw Error(data.error||'Falha na conexão');return data;}
 const constraints=()=>({video:$('guestCamera').checked?{...($('guestCameraSelect').value?{deviceId:{ideal:$('guestCameraSelect').value}}:{})}:false,audio:$('guestMic').checked?{echoCancellation:true,noiseSuppression:true,autoGainControl:true,...($('guestMicSelect').value?{deviceId:{ideal:$('guestMicSelect').value}}:{})}:false});
 async function getMedia(){const options=constraints();if(!options.video&&!options.audio)throw Error('Ative a câmera ou o microfone.');
    try{return await navigator.mediaDevices.getUserMedia(options);}catch(e){
      if(options.video&&options.audio){
        try{const videoOnly=await navigator.mediaDevices.getUserMedia({...options,audio:false});$('guestMic').checked=false;status('Microfone indisponível: somente câmera.');return videoOnly;}catch(_){}
        try{const audioOnly=await navigator.mediaDevices.getUserMedia({...options,video:false});$('guestCamera').checked=false;status('Câmera indisponível: somente microfone.');return audioOnly;}catch(_){}
      }
      throw e;
    }
  }
 async function refresh(){try{const devices=await navigator.mediaDevices.enumerateDevices();for(const [id,kind,label] of [['guestCameraSelect','videoinput','Câmera'],['guestMicSelect','audioinput','Microfone']]){const s=$(id),old=s.value;s.replaceChildren(new Option(label+' padrão',''));devices.filter(x=>x.kind===kind).forEach((d,i)=>s.add(new Option(d.label||label+' '+(i+1),d.deviceId)));if([...s.options].some(x=>x.value===old))s.value=old;}}catch(_){}}
 function preview(){ $('guestPreview').srcObject=media;$('guestPlaceholder').hidden=!!media?.getVideoTracks().length; }
 async function connect(data){if(!window.LivekitClient)throw Error('SDK LiveKit não carregou. Verifique a instalação no servidor.');const lk=window.LivekitClient;
   room=new lk.Room({adaptiveStream:true,dynacast:true});
   room.on(lk.RoomEvent.TrackSubscribed,(track)=>{if(track.kind!==lk.Track.Kind.Audio)return;const el=track.attach();el.autoplay=true;el.playsInline=true;$('remoteAudioTracks').append(el);audioElements.add(el);el.play().then(()=>$('btnAudio').hidden=true).catch(()=>$('btnAudio').hidden=false);});
   room.on(lk.RoomEvent.TrackUnsubscribed,(track)=>{if(track.kind===lk.Track.Kind.Audio){for(const el of track.detach()){audioElements.delete(el);el.remove();}}});
   room.on(lk.RoomEvent.Disconnected,()=>status('Conexão encerrada. Você pode sair e solicitar nova entrada.',true));
   await room.connect(data.livekitUrl,data.token);publishing=true;
   for(const track of media.getTracks()){if(!track.enabled)continue;await room.localParticipant.publishTrack(track,{source:track.kind==='video'?lk.Track.Source.Camera:lk.Track.Source.Microphone});}
   publishing=false;status('Ao vivo na sala. O operador decide em qual janela sua câmera aparece.');
 }
 async function checkStatus(){if(!guestId)return;try{const data=await api(`/api/guest/${encodeURIComponent(roomId)}/${encodeURIComponent(guestId)}/status`);
   if(data.status==='rejected'){status('O apresentador recusou sua entrada.',true);return;}
   if(data.status==='approved'){clearTimeout(pollTimer);status('Aprovado! Conectando câmera e microfone...');await connect(data);return;}
   status('Aguardando aprovação do apresentador...');
 }catch(e){status('Erro ao verificar sala: '+e.message,true);}if(guestId&&!room)pollTimer=setTimeout(checkStatus,1600);}
 async function join(){if(!roomId||!invite){status('Convite inválido. Solicite um novo link.',true);return;}if(!navigator.mediaDevices?.getUserMedia){status('Abra o convite usando HTTPS.',true);return;}
  $('guestJoin').disabled=true;
  try{media=await getMedia();preview();await refresh();const data=await api('/api/guest/join',{roomId,invite,name:$('guestName').value});guestId=data.guestId;access=data.access;$('guestLeave').hidden=false;status('Na sala de espera. Câmera ainda não enviada.');checkStatus();}
  catch(e){status('Falha na entrada: '+e.message,true);if(media){media.getTracks().forEach(t=>t.stop());media=null;preview();}$('guestJoin').disabled=false;}
 }
 async function switchDevices(){if(!media)return;
   try{const updated=await getMedia();const old=media;media=updated;preview();if(room){for(const kind of ['audio','video']){
     for(const pub of room.localParticipant.getTrackPublications().filter(p=>p.track?.kind===kind)){await room.localParticipant.unpublishTrack(pub.track,true);}
     for(const track of updated.getTracks().filter(t=>t.kind===kind))await room.localParticipant.publishTrack(track);
   }}old.getTracks().forEach(t=>t.stop());status(room?'Dispositivo atualizado.':'Prévia atualizada.');await refresh();}
   catch(e){status('Dispositivo indisponível: '+e.message,true);}
 }
 async function leave(){guestId=null;access=null;clearTimeout(pollTimer);if(room){await room.disconnect().catch(()=>{});room=null;}for(const el of audioElements)el.remove();audioElements.clear();if(media){media.getTracks().forEach(t=>t.stop());media=null;}preview();$('guestLeave').hidden=true;$('guestJoin').disabled=false;status('Você saiu da sala.');}
 $('guestJoin').onclick=join;$('guestLeave').onclick=leave;$('btnAudio').onclick=()=>{Promise.all([...audioElements].map(el=>el.play())).then(()=>$('btnAudio').hidden=true).catch(()=>status('Não foi possível habilitar o áudio.',true));};
 $('guestCameraSelect').onchange=switchDevices;$('guestMicSelect').onchange=switchDevices;$('guestRefreshDevices').onclick=refresh;
 for(const [input,kind]of [['guestCamera','video'],['guestMic','audio']])$(input).onchange=()=>{if(!media)return;const tracks=media.getTracks().filter(t=>t.kind===kind);if(!tracks.length&&$(input).checked)switchDevices();else for(const track of tracks)track.enabled=$(input).checked;};
 window.addEventListener('pagehide',()=>{media?.getTracks().forEach(t=>t.stop());room?.disconnect();});
 if(!roomId||!invite)status('Link incompleto. Solicite um novo convite.',true);
 refresh();
})();
