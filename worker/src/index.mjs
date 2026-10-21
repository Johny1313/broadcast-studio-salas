/** Broadcast Studio V1.9 — Cloudflare Worker + SQLite-backed Durable Object.
 * No cloudflared, Render, or LiveKit API secret in browser code.
 */
const ROOM_TTL = 12 * 60 * 60 * 1000;
const ID = /^[A-Za-z0-9_-]{10,90}$/;
const json = (data,status=200,headers={}) => new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',...headers}
});
const error = (status,message)=>json({ok:false,error:message},status);
const clean = (x,max=64)=>String(x??'').trim().slice(0,max);
const bytes = n=>crypto.getRandomValues(new Uint8Array(n));
const base64url = array=>{
  let text='';for(const n of array)text+=String.fromCharCode(n);
  return btoa(text).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
};
const random = (n=24)=>base64url(bytes(n));
const encode = obj=>base64url(new TextEncoder().encode(JSON.stringify(obj)));
const validWs = url=>{try{const u=new URL(url);return u.protocol==='wss:'&&!u.username&&!u.password&&!u.search&&!u.hash&&!!u.hostname;}catch{return false;}};
const safeEqual = (a,b)=>{const x=new TextEncoder().encode(String(a??'')),y=new TextEncoder().encode(String(b??''));if(x.length!==y.length)return false;let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;};
async function parseBody(request){
  const len=Number(request.headers.get('content-length')||0);
  if(len>8192)throw new HttpError(413,'Requisição muito grande');
  const body=await request.text();
  if(body.length>8192)throw new HttpError(413,'Requisição muito grande');
  try{return JSON.parse(body||'{}');}catch{throw new HttpError(400,'JSON inválido');}
}
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
function configured(env){return !!(validWs(env.LIVEKIT_URL)&&String(env.LIVEKIT_API_KEY||'').length>=4&&String(env.LIVEKIT_API_SECRET||'').length>=12&&String(env.STUDIO_OPERATOR_KEY||'').length>=24&&env.LIVEKIT_API_KEY!==env.LIVEKIT_API_SECRET&&env.STUDIO_OPERATOR_KEY!==env.LIVEKIT_API_SECRET&&env.STUDIO_OPERATOR_KEY!==env.LIVEKIT_API_KEY);}
async function token(env,room,identity,name){
  const now=Math.floor(Date.now()/1000);
  const head={alg:'HS256',typ:'JWT'};
  const payload={iss:env.LIVEKIT_API_KEY,sub:identity,iat:now,nbf:now,exp:now+900,name,
    video:{roomJoin:true,room,canPublish:true,canSubscribe:true,canPublishData:false,roomAdmin:false}};
  const signingInput=encode(head)+'.'+encode(payload);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.LIVEKIT_API_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(signingInput)));
  return signingInput+'.'+base64url(sig);
}
function cors(request,env){
  const own=new URL(request.url).origin;
  const origin=request.headers.get('origin');
  const allowed=new Set([own,'http://127.0.0.1:8791','http://localhost:8791',...(env.ALLOWED_STUDIO_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean)]);
  return {origin,valid:!origin||allowed.has(origin),headers:origin&&allowed.has(origin)?{'access-control-allow-origin':origin,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'Content-Type,X-Studio-Key,X-Guest-Secret','access-control-max-age':'600','vary':'Origin'}:{}};
}
/** Each room runs on a single Durable Object; its storage persists across Worker restarts. */
export class RoomState {
  constructor(ctx,env){this.ctx=ctx;this.env=env;}
  async alarm(){await this.ctx.storage.deleteAll();}
  async fetch(request){
    try{
      const path=new URL(request.url).pathname;
      let room=await this.ctx.storage.get('room');
      if(path==='/create'&&request.method==='POST'){
        if(room)return error(409,'Identificador de sala já utilizado');
        const data=await parseBody(request);
        if(!ID.test(data.id)||!data.invite||!data.name)return error(422,'Sala inválida');
        room={id:data.id,name:data.name,invite:data.invite,created:Date.now(),guests:{},attempts:{}};
        await this.ctx.storage.put('room',room);
        if(this.ctx.storage.setAlarm)await this.ctx.storage.setAlarm(room.created+ROOM_TTL);
        return json({ok:true,id:room.id,name:room.name,invite:room.invite});
      }
      if(!room)return error(404,'Sala inexistente ou expirada');
      if(Date.now()-room.created>ROOM_TTL){if(this.ctx.storage.deleteAll)await this.ctx.storage.deleteAll();return error(404,'Sala inexistente ou expirada');}
      if(path==='/info'&&request.method==='GET')return json({ok:true,id:room.id,name:room.name,created:room.created});
      if(path==='/invite'&&request.method==='GET')return json({ok:true,id:room.id,invite:room.invite});
      if(path==='/guests'&&request.method==='GET')return json({ok:true,guests:Object.values(room.guests).map(g=>({id:g.id,name:g.name,status:g.status,created:g.created}))});
      if(path==='/approve'&&request.method==='POST'){
        const data=await parseBody(request),guest=room.guests[data.guestId];
        if(!guest)return error(404,'Participante não encontrado');
        if(guest.status!=='waiting')return error(409,'Entrada já decidida');
        guest.status=data.approve===true?'approved':'rejected';
        await this.ctx.storage.put('room',room);
        return json({ok:true,status:guest.status});
      }
      if(path==='/join'&&request.method==='POST'){
        const data=await parseBody(request);
        const ip=clean(request.headers.get('x-verified-client-ip')||'unknown',80);
        const old=room.attempts[ip]||{count:0,since:Date.now()};
        if(Date.now()-old.since>60_000){old.count=0;old.since=Date.now();}
        old.count++;room.attempts[ip]=old;
        // Keep only recent counters so rooms do not accumulate arbitrary IP strings.
        room.attempts=Object.fromEntries(Object.entries(room.attempts).filter(([,v])=>Date.now()-v.since<=60_000).slice(-100));
        if(old.count>18){await this.ctx.storage.put('room',room);return error(429,'Muitas tentativas de entrada');}
        if(!safeEqual(data.invite,room.invite))return error(404,'Convite inválido ou expirado');
        if(Object.keys(room.guests).length>=8)return error(409,'Limite de oito convidados atingido');
        const name=clean(data.name,48);if(name.length<2)return error(422,'Informe seu nome (mínimo 2 caracteres)');
        const id='guest_'+random(10),access=random(24);
        room.guests[id]={id,name,access,status:'waiting',created:Date.now()};
        await this.ctx.storage.put('room',room);
        return json({ok:true,guestId:id,access},201);
      }
      if(path==='/status'&&request.method==='GET'){
        const id=new URL(request.url).searchParams.get('id');
        const guest=room.guests[id];
        if(!guest||!safeEqual(guest.access,request.headers.get('x-guest-secret')))return error(401,'Convidado não autorizado');
        return json({ok:true,status:guest.status,name:guest.name,roomName:room.name});
      }
      return error(404,'Rota não encontrada');
    }catch(e){if(e instanceof HttpError)return error(e.status,e.message);return error(500,'Erro interno na sala');}
  }
}
function roomStub(env,id){return env.ROOMS.get(env.ROOMS.idFromName(id));}
async function call(stub,path,method='GET',body=null,headers={}){
  const request=new Request('https://room.internal'+path,{method,headers:{'content-type':'application/json',...headers},...(body!==null?{body:JSON.stringify(body)}:{})});
  const res=await stub.fetch(request);const data=await res.json();if(!res.ok)throw new HttpError(res.status,data.error||'Falha na sala');return data;
}
async function api(request,env){
  if(!configured(env))return error(503,'Configuração LiveKit pendente no Cloudflare');
  const url=new URL(request.url),path=url.pathname;
  if(path==='/api/health'&&request.method==='GET')return json({ok:true,service:'broadcast-cloudflare-livekit',configured:true,storage:'durable-objects-sqlite'});
  if(path.startsWith('/api/studio/')){
    if(!safeEqual(request.headers.get('x-studio-key'),env.STUDIO_OPERATOR_KEY))return error(401,'Chave do operador inválida');
    if(path==='/api/studio/rooms'&&request.method==='POST'){
      await parseBody(request);
      const id=random(12),invite=random(24),name='broadcast_'+id;
      const stub=roomStub(env,id);
      await call(stub,'/create','POST',{id,name,invite});
      const host='host_'+random(10);
      const inviteUrl=`${url.origin}/guest.html?room=${encodeURIComponent(id)}&invite=${encodeURIComponent(invite)}`;
      return json({ok:true,roomId:id,inviteUrl,token:await token(env,name,host,'Produção'),livekitUrl:env.LIVEKIT_URL},201);
    }
    const match=path.match(/^\/api\/studio\/rooms\/([A-Za-z0-9_-]{10,90})\/(guests|approve|host-token|invite)$/);
    if(!match)return error(404,'Rota não encontrada');
    const [,id,action]=match,stub=roomStub(env,id);
    if(action==='guests'&&request.method==='GET')return json(await call(stub,'/guests'));
    if(action==='invite'&&request.method==='GET'){const r=await call(stub,'/invite');return json({ok:true,inviteUrl:`${url.origin}/guest.html?room=${encodeURIComponent(id)}&invite=${encodeURIComponent(r.invite)}`});}
    if(action==='approve'&&request.method==='POST')return json(await call(stub,'/approve','POST',await parseBody(request)));
    if(action==='host-token'&&request.method==='POST'){
      const r=await call(stub,'/info');
      return json({ok:true,token:await token(env,r.name,'host_'+random(10),'Produção'),livekitUrl:env.LIVEKIT_URL});
    }
    return error(405,'Método não permitido');
  }
  if(path==='/api/guest/join'&&request.method==='POST'){
    const data=await parseBody(request);
    if(!ID.test(data.roomId||''))return error(404,'Convite inválido');
    const stub=roomStub(env,data.roomId);
    return json(await call(stub,'/join','POST',data,{'x-verified-client-ip':request.headers.get('cf-connecting-ip')||'unknown'}),201);
  }
  const match=path.match(/^\/api\/guest\/([A-Za-z0-9_-]{10,90})\/([A-Za-z0-9_-]{10,90})\/status$/);
  if(match&&request.method==='GET'){
    const [,id,guestId]=match,stub=roomStub(env,id);
    const r=await call(stub,'/status?id='+encodeURIComponent(guestId),'GET',null,{'x-guest-secret':request.headers.get('x-guest-secret')||''});
    if(r.status==='approved')return json({ok:true,status:r.status,token:await token(env,r.roomName,guestId,r.name),livekitUrl:env.LIVEKIT_URL});
    return json({ok:true,status:r.status});
  }
  return error(404,'Rota não encontrada');
}
export default {
  async fetch(request,env){
    const url=new URL(request.url),path=url.pathname;
    if(path.startsWith('/api/')){
      const policy=cors(request,env);
      if(!policy.valid)return error(403,'Origem não autorizada');
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers:policy.headers});
      try{
        const res=await api(request,env);
        const headers=new Headers(res.headers);for(const [k,v]of Object.entries(policy.headers))headers.set(k,v);
        return new Response(res.body,{status:res.status,headers});
      }catch(e){const res=error(e instanceof HttpError?e.status:500,e instanceof HttpError?e.message:'Erro interno da API');
        const headers=new Headers(res.headers);for(const [k,v] of Object.entries(policy.headers))headers.set(k,v);
        return new Response(res.body,{status:res.status,headers});}
    }
    if(request.method!=='GET'&&request.method!=='HEAD')return error(405,'Método não permitido');
    // Cloudflare serves the complete web studio and guest from static assets.
    const asset=path==='/'?new Request(url.origin+'/index.html',request):request;
    const response=await env.ASSETS.fetch(asset);
    const headers=new Headers(response.headers);
    headers.set('X-Content-Type-Options','nosniff');
    headers.set('Referrer-Policy','no-referrer');
    headers.set('X-Frame-Options','DENY');
    if(path==='/'||path.endsWith('.html')) headers.set('Cache-Control','no-store');
    return new Response(response.body,{status:response.status,headers});
  }
};
