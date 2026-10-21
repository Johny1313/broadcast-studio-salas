/* Broadcast Studio V1.9 — LiveKit Cloud host bridge. Credentials stay in the hosted backend. */
'use strict';
(()=>{
 const $=id=>document.getElementById(id),bridge=window.BroadcastStudioCloudBridge;
 let base='',operator='',roomId='',url='',livekitUrl='',room=null,pollTimer=null,scriptUrl='',loadingSDK=null;
 const names=new Map(),streams=new Map(),assigned=new Map();
 function status(message,type=''){const el=$('cloudStatus');el.textContent=message;el.dataset.status=type;}
 const trimBase=value=>{const u=new URL(String(value).trim());if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash)throw Error('Informe somente o domínio HTTPS (ex.: https://salas.exemplo.com).');return u.origin;};
 async function api(path,body=null){if(!base||!operator)throw Error('Configure o servidor HTTPS e a chave do operador.');
  const response=await fetch(base+path,{method:body===null?'GET':'POST',headers:{'Content-Type':'application/json','x-studio-key':operator},...(body!==null?{body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Falha no servidor');return data;
 }
 async function sdk(){if(window.LivekitClient)return window.LivekitClient;if(loadingSDK)return loadingSDK;
  loadingSDK=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=base+'/vendor/livekit-client.umd.min.js';s.async=true;s.onload=()=>window.LivekitClient?resolve(window.LivekitClient):reject(Error('SDK LiveKit indisponível'));s.onerror=()=>reject(Error('Não foi possível carregar o SDK do servidor hospedado'));document.head.append(s);});
  try{return await loadingSDK;}catch(e){loadingSDK=null;throw e;}
 }
 const fromSdkParticipant = p=> names.get(p.identity)||p.name||p.identity;
 function showMember(guest){if(!bridge)return;const old=bridge.entry(guest.id);if(!old)bridge.register(guest.id,guest.name);}
 function addTrack(track,participant){const id=participant.identity;if(!id.startsWith('guest_'))return;
   const name=fromSdkParticipant(participant);names.set(id,name);showMember({id,name});
   const stream=streams.get(id)||new MediaStream();const raw=track.mediaStreamTrack;if(!raw)return;
   if(!stream.getTracks().some(t=>t.id===raw.id))stream.addTrack(raw);streams.set(id,stream);
   // Refresh the source so late-arriving audio is connected to the mixing bus.
   bridge.remove(id);bridge.register(id,name);bridge.attach(id,stream);
   renderPeople();
 }
 function removeTrack(track,participant){const id=participant.identity,stream=streams.get(id);if(!stream)return;const raw=track.mediaStreamTrack;if(raw)for(const old of stream.getTracks().filter(t=>t.id===raw.id))stream.removeTrack(old);
   if(!stream.getTracks().length){streams.delete(id);bridge.remove(id);}else{bridge.remove(id);bridge.register(id,fromSdkParticipant(participant));bridge.attach(id,stream);}
   renderPeople();
 }
 async function connect(token){const LK=await sdk();if(room)await room.disconnect();room=new LK.Room({adaptiveStream:true,dynacast:true});
   room.on(LK.RoomEvent.TrackSubscribed,(track,pub,participant)=>addTrack(track,participant));
   room.on(LK.RoomEvent.TrackUnsubscribed,(track,pub,participant)=>removeTrack(track,participant));
   room.on(LK.RoomEvent.ParticipantDisconnected,participant=>{streams.delete(participant.identity);bridge.remove(participant.identity);renderPeople();});
   room.on(LK.RoomEvent.Disconnected,()=>status('Conexão LiveKit interrompida. Use Reconectar.','warn'));
   await room.connect(livekitUrl,token);
   for(const participant of room.remoteParticipants.values())for(const pub of participant.trackPublications.values())if(pub.isSubscribed&&pub.track)addTrack(pub.track,participant);
   status('Sala LiveKit conectada. Aguarde a entrada dos convidados.','good');renderPeople();
 }
 async function diagnose(){try{
   base=trimBase($('cloudOrigin').value);
   operator=$('cloudOperatorKey').value.trim();
   if(operator.length<24)throw Error('A chave do operador precisa de pelo menos 24 caracteres.');
   status('Verificando somente a configuração do servidor, sem consultar valores de segredos...');
   const result=await api('/api/studio/diagnostics');
   if(result.configured){status('Configuração estrutural válida. Se a sala ainda falhar, verifique as credenciais reais do LiveKit.','good');return;}
   const invalid=Object.entries(result.checks||{}).filter(([,ok])=>!ok).map(([name])=>name);
   if(!result.keysDistinct)invalid.push('Credenciais duplicadas');
   status('Ajuste no Cloudflare (Settings → Variables and Secrets): '+invalid.join(', ')+'. Após corrigir, clique em Deploy.','error');
 }catch(e){status('Diagnóstico: '+e.message,'error');}}
 async function create(){try{
   base=trimBase($('cloudOrigin').value);operator=$('cloudOperatorKey').value.trim();if(operator.length<24)throw Error('A chave do operador deve ter pelo menos 24 caracteres.');
   $('cloudCreate').disabled=true;status('Criando sala segura no servidor hospedado...');
   const data=await api('/api/studio/rooms',{});roomId=data.roomId;url=data.inviteUrl;livekitUrl=data.livekitUrl;try{sessionStorage.setItem('broadcast_livekit_room_id',roomId);}catch(_){}
   $('cloudReconnect').disabled=false;
   await connect(data.token);
   $('cloudInvite').value=url;$('cloudInvite').disabled=false;$('cloudCopy').disabled=false;
   await poll();status('Sala pronta. Compartilhe o convite HTTPS.','good');
 }catch(e){status('Não foi possível criar a sala: '+e.message,'error');}finally{$('cloudCreate').disabled=false;}}
 async function reconnect(){if(!roomId)return;try{base=trimBase($('cloudOrigin').value);operator=$('cloudOperatorKey').value.trim();const invite=await api(`/api/studio/rooms/${roomId}/invite`);url=invite.inviteUrl;const data=await api(`/api/studio/rooms/${roomId}/host-token`,{});livekitUrl=data.livekitUrl;await connect(data.token);await poll();$('cloudInvite').value=url;$('cloudInvite').disabled=false;$('cloudCopy').disabled=false;status('Reconectado ao LiveKit.','good');}catch(e){status('Falha na reconexão: '+e.message,'error');}}
 async function approve(id,approve){try{await api(`/api/studio/rooms/${roomId}/approve`,{guestId:id,approve});await poll();}catch(e){status('Erro de aprovação: '+e.message,'error');}}
 function renderPeople(guests=[]){const list=$('cloudPeople');if(!list)return;list.replaceChildren();
   const known=guests.length?guests:[...names].map(([id,name])=>({id,name,status:'approved'}));
   $('cloudCount').textContent=known.filter(x=>x.status!=='rejected').length+' / 8';
   if(!known.length){const e=document.createElement('small');e.textContent=roomId?'Nenhum convidado entrou ainda.':'Crie a sala para iniciar os convites.';e.className='muted';list.append(e);return;}
   for(const guest of known){if(guest.status==='rejected')continue;names.set(guest.id,guest.name);
     const row=document.createElement('div');row.className='guest-row';const name=document.createElement('strong');name.textContent=guest.name;
     const tag=document.createElement('small');tag.textContent=guest.status==='waiting'?'Na sala de espera':streams.has(guest.id)?'Câmera recebida':'Aprovado • aguardando mídia';tag.className='muted';row.append(name,tag);
     const actions=document.createElement('div');actions.className='form-row';
     if(guest.status==='waiting'){for(const [label,yes] of [['✓ Aceitar',true],['× Recusar',false]]){const b=document.createElement('button');b.className='btn '+(yes?'green':'subtle');b.textContent=label;b.onclick=()=>approve(guest.id,yes);actions.append(b);}}
     else{for(let i=1;i<=3;i++){const b=document.createElement('button');b.className='btn subtle';b.textContent='Câmera '+i;b.disabled=!streams.get(guest.id)?.getVideoTracks().length;b.onclick=()=>{bridge.assign(guest.id,i);status(guest.name+' enviado à câmera '+i+' nos dois canvas. Clique em No ar.','good');};actions.append(b);}}
     row.append(actions);list.append(row);
   }
 }
 async function poll(){clearTimeout(pollTimer);if(!roomId)return;try{const data=await api(`/api/studio/rooms/${roomId}/guests`);renderPeople(data.guests);}catch(e){status('Falha ao consultar sala: '+e.message,'warn');}
   if(roomId)pollTimer=setTimeout(poll,1900);
 }
 async function shareMic(){if(!room)return status('Crie a sala primeiro.','warn');try{const audio=bridge.getMicStream();const track=audio?.getAudioTracks()?.[0];if(!track)throw Error('Conecte primeiro o microfone no painel de áudio do estúdio.');
   const LK=await sdk();await room.localParticipant.publishTrack(track,{source:LK.Track.Source.Microphone});status('Microfone do estúdio compartilhado com os convidados.','good');
 }catch(e){status('Não foi possível compartilhar microfone: '+e.message,'error');}}
 function init(){if(!bridge)return; if(location.protocol==='https:' && !$('cloudOrigin').value){$('cloudOrigin').value=location.origin;}try{const previous=sessionStorage.getItem('broadcast_livekit_room_id');if(previous){roomId=previous;$('cloudReconnect').disabled=false;status('Sala anterior encontrada. Informe sua chave de operador e clique em Reconectar.');}}catch(_){} 
  $('cloudCreate').onclick=create;$('cloudReconnect').onclick=reconnect;$('cloudMic').onclick=shareMic;$('cloudDiagnose').onclick=diagnose;
  $('cloudCopy').onclick=async()=>{if(!url)return;try{await navigator.clipboard.writeText(url);status('Convite HTTPS copiado.','good');}catch(_){$('cloudInvite').select();status('Selecione e copie o convite.','warn');}};
  $('cloudTest').onclick=()=>{if(!url)return status('Crie primeiro a sala.','warn');window.open(url,'_blank','noopener,noreferrer');};
  renderPeople();
 }
 init();
})();
