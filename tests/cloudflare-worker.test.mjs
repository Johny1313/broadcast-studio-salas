import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import worker,{RoomState} from '../worker/src/index.mjs';

function setup(){
  const objects=new Map();
  const env={LIVEKIT_URL:'wss://broadcast-test.livekit.cloud',LIVEKIT_API_KEY:'devKeyABC',LIVEKIT_API_SECRET:'superSecret_Teste_que_nao_e_real_98765',STUDIO_OPERATOR_KEY:'local_operator_key_for_tests_123456789',
    ASSETS:{fetch:async(req)=>new Response('ASSET:'+new URL(req.url).pathname,{status:200})},
    ROOMS:{idFromName:name=>name,get(name){if(!objects.has(name)){
      const store=new Map();const ctx={storage:{get:async k=>store.get(k),put:async(k,v)=>store.set(k,structuredClone(v))}};
      objects.set(name,{state:new RoomState(ctx,env),store});
    }return {fetch:request=>objects.get(name).state.fetch(request)};}}
  };
  async function call(path,{method='GET',body,headers={}}={}){
    const res=await worker.fetch(new Request('https://broadcast-studio.workers.dev'+path,{method,headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env);
    let data;try{data=await res.json()}catch{data={}};
    return {status:res.status,data,headers:res.headers};
  }
  const auth={'x-studio-key':env.STUDIO_OPERATOR_KEY};
  return {env,objects,call,auth};
}
async function create(s){const c=await s.call('/api/studio/rooms',{method:'POST',headers:s.auth,body:{}});assert.equal(c.status,201);return c.data;}
const decode=t=>JSON.parse(Buffer.from(t.split('.')[1],'base64url').toString('utf8'));
const verify=(t,secret)=>{const [head,payload,signature]=t.split('.');return createHmac('sha256',secret).update(head+'.'+payload).digest('base64url')===signature;};

test('saúde configurada e assets na mesma origem',async()=>{const s=setup();assert.equal((await s.call('/api/health')).data.configured,true);const res=await worker.fetch(new Request('https://broadcast-studio.workers.dev/guest.html?room=a'),s.env);assert.equal(await res.text(),'ASSET:/guest.html');});
test('somente operador cria e consulta salas',async()=>{const s=setup();assert.equal((await s.call('/api/studio/rooms',{method:'POST',body:{}})).status,401);const c=await create(s);assert.match(c.inviteUrl,/^https:\/\/broadcast-studio\.workers\.dev\/guest\.html\?room=/);assert.equal((await s.call(`/api/studio/rooms/${c.roomId}/guests`,{headers:s.auth})).status,200);assert.equal((await s.call(`/api/studio/rooms/${c.roomId}/guests`)).status,401);});
test('convidado aguarda aprovação e token só é liberado após autorização',async()=>{const s=setup(),c=await create(s),u=new URL(c.inviteUrl),invite=u.searchParams.get('invite');const join=await s.call('/api/guest/join',{method:'POST',body:{roomId:c.roomId,invite,name:'Participante'}});assert.equal(join.status,201);const path=`/api/guest/${c.roomId}/${join.data.guestId}/status`;
 const unauthorized=await s.call(path);assert.equal(unauthorized.status,401);
 let st=await s.call(path,{headers:{'x-guest-secret':join.data.access}});assert.equal(st.data.status,'waiting');assert.equal(st.data.token,undefined);
 const approve=await s.call(`/api/studio/rooms/${c.roomId}/approve`,{method:'POST',headers:s.auth,body:{guestId:join.data.guestId,approve:true}});assert.equal(approve.data.status,'approved');
 st=await s.call(path,{headers:{'x-guest-secret':join.data.access}});assert.equal(st.data.status,'approved');assert.equal(st.data.livekitUrl,s.env.LIVEKIT_URL);
 assert.equal(verify(st.data.token,s.env.LIVEKIT_API_SECRET),true);const claims=decode(st.data.token);assert.equal(claims.video.room,'broadcast_'+c.roomId);assert.equal(claims.sub,join.data.guestId);assert.ok(claims.exp-claims.iat===900);
});
test('convite errado e recusa não fornecem mídia',async()=>{const s=setup(),c=await create(s);assert.equal((await s.call('/api/guest/join',{method:'POST',body:{roomId:c.roomId,invite:'incorrect',name:'Foo'}})).status,404);const inv=new URL(c.inviteUrl).searchParams.get('invite');const j=await s.call('/api/guest/join',{method:'POST',body:{roomId:c.roomId,invite:inv,name:'Foo'}});await s.call(`/api/studio/rooms/${c.roomId}/approve`,{method:'POST',headers:s.auth,body:{guestId:j.data.guestId,approve:false}});const r=await s.call(`/api/guest/${c.roomId}/${j.data.guestId}/status`,{headers:{'x-guest-secret':j.data.access}});assert.equal(r.data.status,'rejected');assert.equal(r.data.token,undefined);});
test('origens não autorizadas bloqueadas, origem desktop autorizada',async()=>{const s=setup();const denied=await s.call('/api/health',{headers:{origin:'https://site-malicioso.example'}});assert.equal(denied.status,403);const allowed=await s.call('/api/health',{headers:{origin:'http://127.0.0.1:8791'}});assert.equal(allowed.status,200);assert.equal(allowed.headers.get('access-control-allow-origin'),'http://127.0.0.1:8791');const preflight=await worker.fetch(new Request('https://broadcast-studio.workers.dev/api/studio/rooms',{method:'OPTIONS',headers:{origin:'http://127.0.0.1:8791','access-control-request-method':'POST'}}),s.env);assert.equal(preflight.status,204);});
test('salas persistem quando instância do worker recebe nova requisição',async()=>{const s=setup(),c=await create(s);const inv=new URL(c.inviteUrl).searchParams.get('invite');const j=await s.call('/api/guest/join',{method:'POST',body:{roomId:c.roomId,invite:inv,name:'Outra pessoa'}});assert.equal(j.status,201);assert.equal((await s.call(`/api/studio/rooms/${c.roomId}/guests`,{headers:s.auth})).data.guests.length,1);});
test('não permite mais de oito solicitações por sala',async()=>{const s=setup(),c=await create(s),inv=new URL(c.inviteUrl).searchParams.get('invite');for(let i=0;i<8;i++){const j=await s.call('/api/guest/join',{method:'POST',body:{roomId:c.roomId,invite:inv,name:'Pessoa '+i}});assert.equal(j.status,201);}assert.equal((await s.call('/api/guest/join',{method:'POST',body:{roomId:c.roomId,invite:inv,name:'Nona pessoa'}})).status,409);});
test('sem secrets não expõe serviço LiveKit',async()=>{const s=setup();s.env.LIVEKIT_API_SECRET='';const h=await s.call('/api/health');assert.equal(h.status,503);assert.ok(!JSON.stringify(h.data).includes('local_operator'));});
test('chave de host renovável só pelo operador',async()=>{const s=setup(),c=await create(s);const path=`/api/studio/rooms/${c.roomId}/host-token`;assert.equal((await s.call(path,{method:'POST',body:{}})).status,401);const r=await s.call(path,{method:'POST',headers:s.auth,body:{}});assert.equal(r.status,200);assert.equal(decode(r.data.token).video.room,'broadcast_'+c.roomId);});

test('operador restaura convite sem expor segredo a convidados',async()=>{const s=setup(),c=await create(s);const url=`/api/studio/rooms/${c.roomId}/invite`;const bad=await s.call(url);assert.equal(bad.status,401);const ok=await s.call(url,{headers:s.auth});assert.equal(ok.status,200);assert.equal(ok.data.inviteUrl,c.inviteUrl);});


test('diagnóstico protegido distingue segredo ausente de URL inválida, sem vazar valores',async()=>{
  const s=setup();s.env.LIVEKIT_URL='https://endereco-invalido.example';s.env.LIVEKIT_API_SECRET='';
  const unauthorized=await s.call('/api/studio/diagnostics');assert.equal(unauthorized.status,401);
  const result=await s.call('/api/studio/diagnostics',{headers:s.auth});
  assert.equal(result.status,200);assert.equal(result.data.configured,false);
  assert.equal(result.data.checks.LIVEKIT_URL,false);
  assert.equal(result.data.checks.LIVEKIT_API_SECRET,false);
  assert.equal(result.data.checks.LIVEKIT_API_KEY,true);
  assert.equal(result.data.checks.STUDIO_OPERATOR_KEY,true);
  assert.ok(!JSON.stringify(result.data).includes('local_operator_key_for_tests'));
});

test('diagnóstico indica chave de operador ausente sem divulgar segredos',async()=>{
  const s=setup();s.env.STUDIO_OPERATOR_KEY='';
  const result=await s.call('/api/studio/diagnostics');
  assert.equal(result.status,503);
  assert.ok(!JSON.stringify(result.data).includes('superSecret'));
});

test('diagnóstico identifica credenciais duplicadas',async()=>{
  const s=setup();s.env.LIVEKIT_API_SECRET=s.env.LIVEKIT_API_KEY;
  const result=await s.call('/api/studio/diagnostics',{headers:s.auth});
  assert.equal(result.status,200);assert.equal(result.data.keysDistinct,false);
});
