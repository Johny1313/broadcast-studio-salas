'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {parseConfig,loadIceConfig,safeDiagnostics}=require('../server/ice-config.cjs');
const root=path.resolve(__dirname,'..');
const wait=n=>new Promise(resolve=>setTimeout(resolve,n));

test('V1.7 configura TURN UDP + TURN/TLS TCP 443 sem expor senhas no diagnóstico',()=>{
 const c=parseConfig({stun:['stun:stun.l.google.com:19302'],turn:[
  {urls:'turn:turn.example.org:3478?transport=udp',username:'user',credential:'ultra-secret'},
  {urls:'turns:turn.example.org:443?transport=tcp',username:'user',credential:'ultra-secret'}],iceTransportPolicy:'relay'});
 assert.equal(c.iceTransportPolicy,'relay');assert.equal(c.iceServers.length,3);
 const diag=safeDiagnostics(c);assert.equal(diag.turnConfigured,true);
 assert.equal(JSON.stringify(diag).includes('ultra-secret'),false);
 assert.deepEqual(diag.turn,['turn:turn.example.org:3478?transport=udp','turns:turn.example.org:443?transport=tcp']);
});
test('V1.7 rejeita relé sem TURN, URLs inseguras e configurações malformadas',()=>{
 assert.throws(()=>parseConfig({iceTransportPolicy:'relay'}),/TURN/);
 assert.throws(()=>parseConfig({turn:[{urls:'https://abc',username:'u',credential:'c'}]}),/TURN/);
 assert.throws(()=>parseConfig({turn:[{urls:'turn:turn.example.org:3478?transport=udp',username:'u',credential:''}]}),/credential/);
 assert.throws(()=>parseConfig({stun:['stun:host with spaces']}),/STUN/);
});
test('V1.7 serve ICE no estúdio e no convite com autenticação e preserva salas separadas',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'broadcast-v17-'));
 const config=path.join(dir,'rede.config.json');
 fs.writeFileSync(config,JSON.stringify({stun:['stun:stun.example.org:3478'],turn:[{urls:'turns:turn.example.org:443?transport=tcp',username:'room-user',credential:'room-pass'}],iceTransportPolicy:'all'}));
 const hostPort=32000+Math.floor(Math.random()*15000);
 const guestPort=hostPort+1;
 const proc=spawn(process.execPath,['server/room-server.cjs'],{cwd:root,env:{...process.env,BROADCAST_REDE_CONFIG:config,BROADCAST_HOST_PORT:String(hostPort),BROADCAST_GUEST_PORT:String(guestPort)},stdio:'ignore'});
 const host=`http://127.0.0.1:${hostPort}`, guest=`http://127.0.0.1:${guestPort}`;
 try{
  for(let i=0;i<60;i++){try{if((await fetch(host+'/index.html')).ok)break;}catch{} await wait(50)}
  const newRoom=async()=>{const r=await fetch(host+'/api/rooms',{method:'POST'});assert.equal(r.status,200);return r.json()};
  const room=await newRoom(), room2=await newRoom();assert.notEqual(room.room,room2.room);
  const hostConfig=await fetch(`${host}/api/config?room=${room.room}`,{headers:{'x-studio-token':room.hostToken}});
  assert.equal(hostConfig.status,200);const conf=await hostConfig.json();assert.equal(conf.iceServers.length,2);
  assert.equal(conf.diagnostics.turnConfigured,true);assert.equal(JSON.stringify(conf.diagnostics).includes('room-pass'),false);
  const unauthorized=await fetch(`${host}/api/config?room=${room.room}`);assert.equal(unauthorized.status,403);
  const join=await fetch(guest+'/api/join',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({room:room.room,token:room.guestToken,name:'Cam Remota'})});
  assert.equal(join.status,200);const joined=await join.json();
  const guestConfig=await fetch(`${guest}/api/config?room=${room.room}&guestId=${joined.guestId}`,{headers:{'x-guest-token':joined.guestSecret}});
  assert.equal(guestConfig.status,200);assert.equal((await guestConfig.json()).iceServers[1].credential,'room-pass');
  const cross=await fetch(`${guest}/api/config?room=${room2.room}&guestId=${joined.guestId}`,{headers:{'x-guest-token':joined.guestSecret}});
  assert.equal(cross.status,403);
  assert.equal((await fetch(`${guest}/api/config?room=${room.room}`)).status,403);
 }finally{proc.kill();fs.rmSync(dir,{recursive:true,force:true});}
});
test('V1.7 página do convidado oferece seleção de vídeo/microfone e o estúdio tem diagnóstico ICE',()=>{
 const guestHtml=fs.readFileSync(path.join(root,'guest.html'),'utf8'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const guestJS=fs.readFileSync(path.join(root,'guest.js'),'utf8'),appJS=fs.readFileSync(path.join(root,'app.js'),'utf8');
 for(const id of ['guestCameraSelect','guestMicSelect','guestRefreshDevices'])assert.ok(guestHtml.includes(`id="${id}"`));
 assert.match(guestJS,/replaceTrack/);assert.match(guestJS,/iceTransportPolicy/);
 assert.ok(html.includes('id="btnTestIce"'));assert.ok(html.includes('id="studioSourceMode"'));assert.ok(html.includes('id="directCamerasPanel"'));assert.ok(html.includes('id="remoteGuestsPanel"'));assert.match(appJS,/testIceConnectivity/);
 assert.match(appJS,/iceTransportPolicy:g.iceTransportPolicy/);
});
