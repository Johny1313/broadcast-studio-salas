'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function startServer(extra={}){
 const port=31000+Math.floor(Math.random()*16000);
 const env={...process.env,BROADCAST_HOST_PORT:String(port),BROADCAST_GUEST_PORT:String(port+1),...extra};
 const proc=spawn(process.execPath,['server/room-server.cjs'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
 let output='';proc.stdout.on('data',x=>{output+=x});proc.stderr.on('data',x=>{output+=x});
 const host=`http://127.0.0.1:${port}`,guest=`http://127.0.0.1:${port+1}`;
 for(let i=0;i<80;i++){try{if((await fetch(host+'/index.html')).ok)break}catch{} await wait(45)}
 return {proc,host,guest,output:()=>output};
}
async function request(url,method='GET',body=null,secret=null,key='x-studio-token'){
 const res=await fetch(url,{method,headers:{'Content-Type':'application/json',...(secret?{[key]:secret}:{})},...(body===null?{}:{body:JSON.stringify(body)})});return {status:res.status,data:await res.json()};
}
test('V1.6 convite abre guest.html + fluxo completo de join, approve, offer, answer, ICE, leave',async()=>{
 const s=await startServer();
 try{
  const room=await request(s.host+'/api/rooms','POST',{});assert.equal(room.status,200);
  const {room:id,hostToken,guestToken}=room.data;
  const invite=`${s.guest}/guest.html?room=${id}&token=${guestToken}`;
  assert.equal((await fetch(invite)).status,200,'Página do convite carrega');
  assert.equal((await fetch(s.guest+'/guest.js')).status,200,'JS do convidado carrega');
  assert.equal((await fetch(s.guest+'/styles.css')).status,200,'CSS do convidado carrega');
  const join=await request(s.guest+'/api/join','POST',{room:id,token:guestToken,name:'Convidado Teste'});
  assert.equal(join.status,200,JSON.stringify(join.data));
  const {guestId,guestSecret}=join.data;
  const head=`${s.host}/api/events?room=${id}&cursor=0`;
  const events=await request(head,'GET',null,hostToken);
  assert.equal(events.data.events[0].type,'joined');
  const a=await request(`${s.host}/api/approve?room=${id}`,'POST',{guestId,approve:true},hostToken);
  assert.equal(a.status,200,JSON.stringify(a.data));
  const guestEvents=`${s.guest}/api/events?room=${id}&guestId=${guestId}&cursor=0`;
  assert.equal((await request(guestEvents,'GET',null,guestSecret,'x-guest-token')).data.events[0].type,'approved');
  const offer={type:'offer',sdp:'v=0\no=fake'};
  const sent=await request(`${s.guest}/api/signal?room=${id}&guestId=${guestId}`,'POST',{type:'offer',signal:offer},guestSecret,'x-guest-token');
  assert.equal(sent.status,200,JSON.stringify(sent.data));
  const fromGuest=await request(head,'GET',null,hostToken);
  assert.ok(fromGuest.data.events.some(e=>e.signalType==='offer'),'Offer chegou ao produtor');
  const answer={type:'answer',sdp:'v=0\no=fake'};
  const back=await request(`${s.host}/api/signal?room=${id}`,'POST',{guestId,type:'answer',signal:answer},hostToken);
  assert.equal(back.status,200,JSON.stringify(back.data));
  const backIce=await request(`${s.host}/api/signal?room=${id}`,'POST',{guestId,type:'ice',signal:{candidate:'candidate:test'}},hostToken);
  assert.equal(backIce.status,200);
  const toGuest=await request(guestEvents,'GET',null,guestSecret,'x-guest-token');
  assert.ok(toGuest.data.events.some(e=>e.signalType==='answer'));
  assert.ok(toGuest.data.events.some(e=>e.signalType==='ice'));
  const leave=await request(`${s.guest}/api/leave?room=${id}&guestId=${guestId}`,'POST',{},guestSecret,'x-guest-token');
  assert.equal(leave.status,200);
  assert.ok((await request(head,'GET',null,hostToken)).data.events.some(e=>e.type==='left'));
  assert.equal((await request(s.guest+'/api/rooms','POST',{})).status,404,'Rota do produtor inacessível na porta de convidados');
  assert.equal((await request(s.guest+'/api/tunnel','POST',{})).status,404,'Túnel não exposto na porta de convidados');
 }finally{s.proc.kill()}
});
test('V1.6.1 não aceita executável do túnel inválido; não libera URL simulada',async(t)=>{
 if(process.platform==='win32')return t.skip('Simulação CLI POSIX');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'broadcast-test-tunnel-'));
 const fake=path.join(dir,'cloudflared');
 fs.writeFileSync(fake,'#!/usr/bin/env node\nif(process.argv.includes("--version")){console.log("fake 1.0");process.exit(0)}\nconsole.error("https://fake-unverified.trycloudflare.com");process.exit(1);\n',{mode:0o755});
 const s=await startServer({BROADCAST_CLOUDFLARED_PATH:fake});
 try{
  const {data}=await request(s.host+'/api/rooms','POST',{});
  const url=s.host+'/api/tunnel?room='+data.room;
  assert.equal((await request(url,'POST',{},'bad')).status,403);
  const result=await request(url,'POST',{},data.hostToken);
  assert.equal(result.status,503,'Túnel que não funciona não pode ser marcado como ativo');
 }finally{s.proc.kill();fs.rmSync(dir,{recursive:true,force:true})}
});
test('V1.6 cliente envia sala também nas ações POST e preserva geometria manual no split',()=>{
 const src=fs.readFileSync(path.join(root,'app.js'),'utf8'),guest=fs.readFileSync(path.join(root,'guest.js'),'utf8');
 assert.match(src,/u\.searchParams\.set\('room',state\.guests\.room\)/);
 assert.match(guest,/u\.searchParams\.set\('room',room\)/);
 assert.match(guest,/u\.searchParams\.set\('guestId',guestId\)/);
 assert.match(src,/mode==='split'/);
 assert.match(src,/state\.authoredLayout\[f\]\[i\]/);
 assert.match(src,/function rememberAuthoredLayout\(format\)/);
});
