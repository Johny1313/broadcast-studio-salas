import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto as crypto} from 'node:crypto';
import worker,{RoomState} from '../worker/src/index.mjs';

const enc = x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const fixtures = async () => {
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);jwk.kid='key-unique-193';jwk.alg='RS256';jwk.use='sig';
  const domain='https://qa-access-v193.cloudflareaccess.com',aud='broadcast-auth-application-identifier';
  const jwt=async (claims={})=>{
    const now=Math.floor(Date.now()/1000),head=enc({alg:'RS256',kid:jwk.kid,typ:'JWT'}),body=enc({iss:domain,aud,sub:'operator@example.com',iat:now,exp:now+600,...claims});
    const sign=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(head+'.'+body)));
    return `${head}.${body}.${Buffer.from(sign).toString('base64url')}`;
  };
  const store=new Map(),env={CLOUDFLARE_ACCESS_TEAM_DOMAIN:domain,CLOUDFLARE_ACCESS_AUD:aud,LIVEKIT_URL:'wss://studio.example.livekit.cloud',LIVEKIT_API_KEY:'live_test_123',LIVEKIT_API_SECRET:'TEST_SECRET_not_a_real_key_1234567890',STUDIO_OPERATOR_KEY:'',
    ASSETS:{fetch:async req=>new Response('asset: '+new URL(req.url).pathname)},
    ROOMS:{idFromName:n=>n,get(n){if(!store.has(n)){
      const data=new Map();const context={storage:{get:async x=>data.get(x),put:async(x,v)=>data.set(x,structuredClone(v)),setAlarm:async()=>{}}};store.set(n,new RoomState(context,env));
    }return {fetch:req=>store.get(n).fetch(req)}}}};
  const api=async(path,{method='GET',body,access,origin}={})=>{
    const headers={};if(access)headers['cf-access-jwt-assertion']=access;if(origin)headers.origin=origin;
    if(body!==undefined)headers['content-type']='application/json';
    return worker.fetch(new Request('https://broadcast.example.workers.dev'+path,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})}),env);
  };
  return {env,api,jwt,domain,jwk};
};

// Workers and Cloudflare Access are simulated: these tests verify only our signed-token gate.
test('Cloudflare Access permite criar sala sem chave no navegador quando JWT assinado é válido',async()=>{
  const f=await fixtures(),original=globalThis.fetch;
  globalThis.fetch=async url=>String(url)===f.domain+'/cdn-cgi/access/certs'?new Response(JSON.stringify({keys:[f.jwk]}),{status:200}):Promise.reject(Error('URL não autorizada'));
  try{
    const access=await f.jwt();const sess=await f.api('/api/studio/session',{access});
    assert.equal(sess.status,200);assert.match(await sess.text(),/Acesso autorizado/);
    const diag=await f.api('/api/studio/diagnostics',{access});assert.equal(diag.status,200);
    const detail=await diag.json();assert.equal(detail.configured,true);assert.equal(detail.operatorMode,'cloudflare_access');assert.ok(!JSON.stringify(detail).includes(f.env.LIVEKIT_API_SECRET));
    const create=await f.api('/api/studio/rooms',{method:'POST',body:{},access});assert.equal(create.status,201);
    const room=await create.json();assert.match(room.inviteUrl,/guest\.html\?room=/);
    assert.ok(room.token&&room.livekitUrl);
    const guest=await f.api('/guest.html?room=abc');assert.equal(guest.status,200);
    assert.equal((await guest.text()),'asset: /guest.html');
  }finally{globalThis.fetch=original;}
});

test('sem JWT, com JWT adulterado, audiência errada ou expirado: não há acesso de operador',async()=>{
  const f=await fixtures(),original=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({keys:[f.jwk]}));
  try{
    assert.equal((await f.api('/api/studio/rooms',{method:'POST',body:{}})).status,401);
    assert.equal((await f.api('/api/studio/session',{access:'not-a-jwt'})).status,401);
    assert.equal((await f.api('/api/studio/rooms',{method:'POST',body:{},access:await f.jwt({aud:'some-other-application'})})).status,401);
    assert.equal((await f.api('/api/studio/rooms',{method:'POST',body:{},access:await f.jwt({exp:Math.floor(Date.now()/1000)-100})})).status,401);
    const valid=await f.jwt();assert.equal((await f.api('/api/studio/rooms',{method:'POST',body:{},access:valid.slice(0,-1)+(valid.endsWith('a')?'b':'a')})).status,401);
    // O envio da chave legada não faz downgrade quando Cloudflare Access está configurado.
    assert.equal((await f.api('/api/studio/rooms',{method:'POST',body:{},access:null})).status,401);
  }finally{globalThis.fetch=original;}
});
