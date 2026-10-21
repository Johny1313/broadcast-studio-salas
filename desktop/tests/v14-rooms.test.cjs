'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const root=path.resolve(__dirname,'..');
test('V1.4 — convites, aprovação, autorização e sinalização em portas separadas', async()=>{
  const port=22000+Math.floor(Math.random()*2000);
  const host=`http://127.0.0.1:${port}`,guest=`http://127.0.0.1:${port+1}`;
  const proc=spawn(process.execPath,['server/room-server.cjs'],{cwd:root,env:{...process.env,BROADCAST_HOST_PORT:String(port),BROADCAST_GUEST_PORT:String(port+1)},stdio:'ignore'});
  const api=async(url,method='GET',body=null,headers={})=>{
    const response=await fetch(url,{method,headers:{'Content-Type':'application/json',...headers},...(body===null?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json()};
  };
  try{
    for(let i=0;i<40;i++){if(proc.exitCode!==null)throw Error('servidor encerrou');try{const a=await fetch(host+'/index.html');if(a.ok)break;}catch(_){await new Promise(r=>setTimeout(r,60))}}
    const room=(await api(host+'/api/rooms','POST',{})).data;
    assert.ok(room.room&&room.hostToken&&room.guestToken);
    const code=room.room,h={'x-studio-token':room.hostToken};
    const invite=(await api(guest+'/api/join','POST',{room:code,token:room.guestToken,name:'Mobile tester'})).data;
    assert.ok(invite.guestId&&invite.guestSecret);
    const g={'x-guest-token':invite.guestSecret};
    const hostURL=host+'/api/events?room='+code+'&cursor=0';
    const hostEvents=await api(hostURL,'GET',null,h);
    assert.equal(hostEvents.data.events[0].type,'joined');
    const forbidden=await api(hostURL,'GET',null,{'x-studio-token':'fake'});
    assert.equal(forbidden.status,403);
    const cannotCreate=await api(guest+'/api/rooms','POST',{});
    assert.equal(cannotCreate.status,404);
    const approved=await api(host+'/api/approve?room='+code,'POST',{guestId:invite.guestId,approve:true},h);
    assert.equal(approved.status,200);
    const guestEvents=await api(guest+'/api/events?room='+code+'&guestId='+invite.guestId+'&cursor=0','GET',null,g);
    assert.ok(guestEvents.data.events.some(e=>e.type==='approved'));
    const ice=(await api(guest+'/api/config?room='+code+'&guestId='+invite.guestId,'GET',null,g)).data;
    assert.ok(ice.iceServers.length>=1);
    const msg=await api(guest+'/api/signal?room='+code+'&guestId='+invite.guestId,'POST',{type:'ice',signal:{candidate:'fake'}},g);
    assert.equal(msg.status,200);
    assert.ok((await api(hostURL,'GET',null,h)).data.events.some(e=>e.signalType==='ice'));
    const noHostConfig=await api(host+'/api/config?room='+code);
    assert.equal(noHostConfig.status,403);
    const left=await api(guest+'/api/leave?room='+code+'&guestId='+invite.guestId,'POST',{},g);
    assert.equal(left.status,200);
  }finally{proc.kill();}
});
test('V1.4 — presets e fontes WebRTC sem alterar o canal 4',()=>{
 const src=fs.readFileSync(path.join(root,'app.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.match(src,/function applyLayout\(mode\)/);
 for(const layout of ['full','camera','playlist','split','pip','grid'])assert.ok(html.includes(`data-layout="${layout}"`));
 assert.match(src,/function hostConnection\(id\)/);
 assert.match(src,/state\.preview\[f\]\.slots\[channel-1\]\.sourceId=src\.id/);
 assert.match(src,/function routePlaylistSource\(id\)/);
 assert.match(html,/id="btnFullscreenH"/);
 assert.match(html,/id="btnFullscreenV"/);
});
