'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function server(){
 const hostPort=42000+Math.floor(Math.random()*6000),guestPort=hostPort+1;
 const proc=spawn(process.execPath,['server/room-server.cjs'],{cwd:root,env:{...process.env,BROADCAST_HOST_PORT:String(hostPort),BROADCAST_GUEST_PORT:String(guestPort)},stdio:'ignore'});
 const host=`http://127.0.0.1:${hostPort}`,guest=`http://127.0.0.1:${guestPort}`;
 for(let i=0;i<75;i++){if(proc.exitCode!==null)throw Error('Servidor não iniciou');try{const r=await fetch(host);if(r.ok)return {proc,host,guest};}catch{}await wait(40)}
 throw Error('Timeout servidor');
}
async function api(url,token=null,body=null){const res=await fetch(url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{'x-studio-token':token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {code:res.status,data:await res.json()};}
test('V1.6.1 página local convidado responde mas não é URL pública',async()=>{
 const s=await server();
 try{
  assert.equal((await fetch(s.guest+'/guest.html')).status,200);
  const health=await api(s.guest+'/api/health');
  assert.equal(health.code,200);assert.equal(health.data.service,'broadcast-studio-guest');assert.match(health.data.instance,/^[a-f\d]{36}$/);
  assert.equal((await fetch(s.guest+'/api/rooms',{method:'POST'})).status,404);
  assert.equal((await fetch(s.guest+'/index.html')).status,404);
  const room=await api(s.host+'/api/rooms',null,{});
  const u=s.host+'/api/check-public?room='+room.data.room;
  assert.equal((await api(u,'bad',{baseUrl:'https://test.example'})).code,403);
  assert.equal((await api(u,room.data.hostToken,{baseUrl:'http://127.0.0.1:8792'})).code,422);
  assert.equal((await api(u,room.data.hostToken,{baseUrl:'https://127.0.0.1'})).code,422);
  assert.equal((await api(u,room.data.hostToken,{baseUrl:'https://example.org/path'})).code,422);
  const tunnelState=await api(s.host+'/api/tunnel-status?room='+room.data.room,room.data.hostToken);
  assert.equal(tunnelState.data.active,false);
  assert.equal(tunnelState.data.baseUrl,null);
 }finally{s.proc.kill()}
});
test('V1.6.1 cliente nunca libera copiar link local e oferece validação explícita',()=>{
 const js=readFileSync(path.join(root,'app.js'),'utf8');
 const html=readFileSync(path.join(root,'index.html'),'utf8');
 assert.match(js,/\$\('btnCopyInvite'\)\.disabled=!share/);
 assert.match(js,/inviteValidatedBase=null;showInvite\(\)/);
 assert.match(js,/const verified=await guestApi\('check-public'/);
 assert.match(js,/if\(!inviteValidatedBase\)return toast/);
 assert.match(js,/guestLink\(state\.guests\.localGuestBase\)/);
 assert.match(html,/id="btnVerifyPublic"/);
 assert.match(html,/127\.0\.0\.1/);
 const serverSrc=readFileSync(path.join(root,'server/room-server.cjs'),'utf8');
 assert.match(serverSrc,/const GUEST_INSTANCE_ID=randomBytes/);
 assert.match(serverSrc,/data\.instance!==GUEST_INSTANCE_ID/);
 assert.doesNotMatch(serverSrc,/downloadWithSha|createWriteStream\(temp/);
 assert.match(serverSrc,/Nenhum executável será baixado automaticamente/);
});
