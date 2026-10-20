'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const root=path.resolve(__dirname,'..');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function startServer(executable) {
 const hostPort=48000+Math.floor(Math.random()*11000),guestPort=hostPort+1;
 const proc=spawn(process.execPath,['server/room-server.cjs'],{cwd:root,stdio:'ignore',env:{...process.env,BROADCAST_CLOUDFLARED_PATH:executable,BROADCAST_HOST_PORT:String(hostPort),BROADCAST_GUEST_PORT:String(guestPort)}});
 const host=`http://127.0.0.1:${hostPort}`;
 for(let i=0;i<60;i++){try{if((await fetch(host)).ok)break;}catch(_){}await sleep(40)}
 return {proc,host};
}
async function diagnostic(executable) {
 const s=await startServer(executable);
 try{
  const room=await (await fetch(s.host+'/api/rooms',{method:'POST'})).json();
  const url=s.host+'/api/cloudflared-diagnostic?room='+encodeURIComponent(room.room);
  assert.equal((await fetch(url)).status,403,'must reject unauthenticated diagnostic');
  const resp=await fetch(url,{headers:{'x-studio-token':room.hostToken}});
  assert.equal(resp.status,200);
  return await resp.json();
 }finally{s.proc.kill()}
}
test('V1.7.1 reports missing cloudflared and does not download/install',async()=>{
 const r=await diagnostic('/__nonexistent__/cloudflared');
 assert.equal(r.installed,false);assert.equal(r.reason,'not-found');
 const code=fs.readFileSync(path.join(root,'server/room-server.cjs'),'utf8');
 assert.doesNotMatch(code,/execSync\(|shell:true|NODE_TLS_REJECT_UNAUTHORIZED/);
 assert.match(code,/Nenhum executável será baixado automaticamente/);
});
test('V1.7.1 recognizes a manually installed cloudflared using explicit executable path',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'broadcast-cloudflared-check-'));
 try{
  const name=path.join(dir,'cloudflared');
  fs.writeFileSync(name,'#!/bin/sh\necho cloudflared version 2026.10.0\n',{mode:0o700});
  const r=await diagnostic(name);
  assert.equal(r.installed,true);assert.equal(r.version,'2026.10.0');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('V1.7.1 only exposes choose executable via trusted Electron IPC',()=>{
 const main=fs.readFileSync(path.join(root,'electron/main.cjs'),'utf8');
 const preload=fs.readFileSync(path.join(root,'electron/preload.cjs'),'utf8');
 const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
 assert.match(main,/event\.sender !== window\?\.webContents/);
 assert.match(main,/cloudflared:choose/);
 assert.match(preload,/selectCloudflared/);
 assert.match(app,/checkCloudflared/);
});
