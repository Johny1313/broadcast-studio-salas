'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createCloudServer}=require('../server.cjs');
const env={PUBLIC_ORIGIN:'https://salas.example.com',LIVEKIT_URL:'wss://demo.livekit.cloud',LIVEKIT_API_KEY:'livekit-demo',LIVEKIT_API_SECRET:'s'.repeat(40),STUDIO_OPERATOR_KEY:'operator-'.padEnd(36,'o')};
class FakeToken{constructor(_k,_s,opts){this.opts=opts;}addGrant(g){this.grant=g;}async toJwt(){return Buffer.from(JSON.stringify({identity:this.opts.identity,grant:this.grant})).toString('base64url')}}
async function withServer(run){const app=createCloudServer({env,sdk:{AccessToken:FakeToken}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const req=async(path,{method='GET',body=null,key=null,secret=null,origin=null}={})=>{const res=await fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(key?{'x-studio-key':key}:{}),...(secret?{'x-guest-secret':secret}:{}),...(origin?{origin}:{} )},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,data:await res.json()}};
 try{await run(req,app);}finally{await new Promise(r=>app.server.close(r));}}
const key=env.STUDIO_OPERATOR_KEY;
test('public health never exposes operator secrets',async()=>withServer(async req=>{const h=await req('/api/health');assert.equal(h.status,200);assert.ok(!JSON.stringify(h.data).includes(env.STUDIO_OPERATOR_KEY));}));
test('studio authentication and waiting room gate',async()=>withServer(async req=>{
 let r=await req('/api/studio/rooms',{method:'POST',body:{}});assert.equal(r.status,401);
 r=await req('/api/studio/rooms',{method:'POST',body:{},key});assert.equal(r.status,201);const id=r.data.roomId;assert.match(r.data.inviteUrl,/https:\/\/salas.example.com\/guest.html\?room=/);
 const invite=new URL(r.data.inviteUrl).searchParams.get('invite');
 let bad=await req('/api/guest/join',{method:'POST',body:{roomId:id,invite:'bad',name:'Pessoa'}});assert.equal(bad.status,404);
 const guest=await req('/api/guest/join',{method:'POST',body:{roomId:id,invite,name:'Pessoa Convidada'}});assert.equal(guest.status,201);
 let status=await req(`/api/guest/${id}/${guest.data.guestId}/status`,{secret:guest.data.access});assert.equal(status.data.status,'waiting');assert.ok(!status.data.token);
 const approve=await req(`/api/studio/rooms/${id}/approve`,{method:'POST',key,body:{guestId:guest.data.guestId,approve:true}});assert.equal(approve.data.status,'approved');
 status=await req(`/api/guest/${id}/${guest.data.guestId}/status`,{secret:guest.data.access});assert.equal(status.data.status,'approved');assert.ok(status.data.token);
 const decoded=JSON.parse(Buffer.from(status.data.token,'base64url').toString());assert.equal(decoded.grant.roomJoin,true);assert.equal(decoded.grant.room,'broadcast_'+id);assert.equal(decoded.grant.roomAdmin,false);
}));
test('rejected guest never gets LiveKit token',async()=>withServer(async req=>{
 const r=(await req('/api/studio/rooms',{method:'POST',body:{},key})).data;const invite=new URL(r.inviteUrl).searchParams.get('invite');
 const guest=(await req('/api/guest/join',{method:'POST',body:{roomId:r.roomId,invite,name:'Pessoa Recusada'}})).data;
 await req(`/api/studio/rooms/${r.roomId}/approve`,{method:'POST',key,body:{guestId:guest.guestId,approve:false}});
 const result=await req(`/api/guest/${r.roomId}/${guest.guestId}/status`,{secret:guest.access});assert.equal(result.data.status,'rejected');assert.ok(!result.data.token);
}));
test('CORS blocks untrusted origin and never echoes it',async()=>withServer(async req=>{
 const denied=await req('/api/studio/rooms',{method:'POST',body:{},key,origin:'https://attacker.example'});assert.equal(denied.status,403);
 const accepted=await req('/api/studio/rooms',{method:'POST',body:{},key,origin:'http://127.0.0.1:8791'});assert.equal(accepted.status,201);
}));
test('backend refuses invalid non-HTTPS production config',()=>{
 assert.throws(()=>createCloudServer({env:{...env,PUBLIC_ORIGIN:'http://127.0.0.1:8080'},sdk:{AccessToken:FakeToken}}),/HTTPS/);
});
test('invite page with room query parameters is served as HTML',async()=>withServer(async (_req,app)=>{
 const port=app.server.address().port;
 const resp=await fetch(`http://127.0.0.1:${port}/guest.html?room=abc&invite=def`);
 assert.equal(resp.status,200);
 assert.match(resp.headers.get('content-type'),/text\/html/);
 assert.match(await resp.text(),/guestJoin/);
}));
