'use strict';
// HTTPS is terminated by the cloud host. This process must run behind an HTTPS proxy.
// Never put LIVEKIT_API_SECRET or STUDIO_OPERATOR_KEY in browser code or client links.
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const {randomBytes,timingSafeEqual} = require('node:crypto');
const HOME = path.join(__dirname,'web');
const random = (size=24)=>randomBytes(size).toString('base64url');
const MAX_JSON=16*1024;
const VALID_ID=/^[A-Za-z0-9_-]{10,90}$/;
const ttlMs=12*60*60*1000;
const text=(v,n=64)=>String(v||'').trim().slice(0,n);
function secureEqual(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y);}
function readJson(req){return new Promise((resolve,reject)=>{let buf='';req.on('data',chunk=>{buf+=chunk;if(buf.length>MAX_JSON){reject(Error('Corpo da requisição muito grande'));req.destroy();}});req.on('end',()=>{try{resolve(JSON.parse(buf||'{}'))}catch(_){reject(Error('JSON inválido'))}});req.on('error',reject);});}
function json(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(payload));}
function createCloudServer({env=process.env,sdk=null,now=()=>Date.now()}={}){
  const origin=text(env.PUBLIC_ORIGIN||'',250).replace(/\/$/,'');
  const ws=text(env.LIVEKIT_URL||'',250),key=String(env.LIVEKIT_API_KEY||''),secret=String(env.LIVEKIT_API_SECRET||'');
  const operatorKey=String(env.STUDIO_OPERATOR_KEY||'');
  if(!/^https:\/\/[\w.-]+(?::443)?$/i.test(origin))throw Error('Configure PUBLIC_ORIGIN com domínio HTTPS público.');
  if(!/^wss:\/\/[\w.-]+(?::443)?$/i.test(ws))throw Error('LIVEKIT_URL deve usar wss:// e domínio válido.');
  if(key.length<4||secret.length<12||operatorKey.length<24)throw Error('Credenciais LIVEKIT_API_KEY, LIVEKIT_API_SECRET e STUDIO_OPERATOR_KEY obrigatórias.');
  if(operatorKey===secret||operatorKey===key)throw Error('A chave de operador não pode ser a chave do LiveKit.');
  const origins=(env.ALLOWED_STUDIO_ORIGINS||'http://127.0.0.1:8791,http://localhost:8791').split(',').map(x=>x.trim()).filter(Boolean);
  const rooms=new Map();
  const rate=new Map();
  const service={rooms};
  let deps=sdk;
  async function livekitSdk(){if(!deps)deps=await import('livekit-server-sdk');return deps;}
  async function mint(room,identity,name,host=false){const {AccessToken}=await livekitSdk();const tok=new AccessToken(key,secret,{identity,name,ttl:15*60});tok.addGrant({roomJoin:true,room:room.name,canPublish:true,canSubscribe:true,canPublishData:false,roomAdmin:false});return await tok.toJwt();}
  function cleanup(){for(const [id,room] of rooms)if(now()-room.created>ttlMs)rooms.delete(id);for(const [ip,info]of rate)if(now()-info.at>60000)rate.delete(ip);}
  function reject(res,status,message){json(res,status,{ok:false,error:message});}
  function authorized(req){return secureEqual(req.headers['x-studio-key'],operatorKey);}
  function getRoom(id){const r=rooms.get(id);return r&&now()-r.created<ttlMs?r:null;}
  function guestOf(room,id,req){const guest=room?.guests.get(id);return guest&&secureEqual(guest.access,req.headers['x-guest-secret'])?guest:null;}
  function limit(req){const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim().slice(0,80);const old=rate.get(ip);const next=old&&now()-old.at<60000?{at:old.at,count:old.count+1}:{at:now(),count:1};rate.set(ip,next);return next.count<=18;}
  async function route(req,res){
    cleanup();
    const pathname=new URL(req.url||'/','http://localhost').pathname;
    const reqOrigin=req.headers.origin;
    if(reqOrigin&&origins.includes(reqOrigin)){res.setHeader('Access-Control-Allow-Origin',reqOrigin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type,X-Studio-Key,X-Guest-Secret');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');}
    if(req.method==='OPTIONS'){res.writeHead(reqOrigin&&!origins.includes(reqOrigin)?403:204);return res.end();}
    if(reqOrigin&&!origins.includes(reqOrigin)&&reqOrigin!==origin)return reject(res,403,'Origem não autorizada');
    if(req.method==='GET'&&pathname==='/api/health')return json(res,200,{ok:true,service:'broadcast-livekit-cloud',configured:true,rooms:rooms.size});
    if(pathname.startsWith('/api/studio/')){
      if(!authorized(req))return reject(res,401,'Chave do operador inválida');
      if(req.method==='POST'&&pathname==='/api/studio/rooms'){
        const id=random(12),invite=random(24),room={id,name:'broadcast_'+id,invite,created:now(),guests:new Map()};rooms.set(id,room);
        return json(res,201,{ok:true,roomId:id,inviteUrl:`${origin}/guest.html?room=${encodeURIComponent(id)}&invite=${encodeURIComponent(invite)}`,token:await mint(room,'host_'+random(9),'Produção',true),livekitUrl:ws});
      }
      let m=pathname.match(/^\/api\/studio\/rooms\/([A-Za-z0-9_-]{10,90})\/(guests|approve|host-token)$/);
      if(!m)return reject(res,404,'Rota não encontrada');
      const room=getRoom(m[1]);if(!room)return reject(res,404,'Sala expirada ou inexistente');
      if(req.method==='GET'&&m[2]==='guests')return json(res,200,{ok:true,guests:[...room.guests.values()].map(g=>({id:g.id,name:g.name,status:g.status,created:g.created}))});
      if(req.method==='POST'&&m[2]==='host-token')return json(res,200,{ok:true,token:await mint(room,'host_'+random(9),'Produção',true),livekitUrl:ws});
      if(req.method==='POST'&&m[2]==='approve'){
        const body=await readJson(req),guest=room.guests.get(body.guestId);
        if(!guest)return reject(res,404,'Participante não encontrado');
        if(guest.status!=='waiting')return reject(res,409,'Entrada já decidida');
        guest.status=body.approve===true?'approved':'rejected';return json(res,200,{ok:true,status:guest.status});
      }
      return reject(res,405,'Método não permitido');
    }
    if(req.method==='POST'&&pathname==='/api/guest/join'){
      if(!limit(req))return reject(res,429,'Muitas tentativas de entrada');
      const body=await readJson(req);const room=getRoom(body.roomId);
      if(!room||!secureEqual(body.invite,room.invite))return reject(res,404,'Convite inválido ou expirado');
      if(room.guests.size>=8)return reject(res,409,'Limite de oito convidados atingido');
      const name=text(body.name,48);if(name.length<2)return reject(res,422,'Informe seu nome (mínimo 2 caracteres)');
      const guest={id:'guest_'+random(10),access:random(24),name,status:'waiting',created:now()};room.guests.set(guest.id,guest);
      return json(res,201,{ok:true,guestId:guest.id,access:guest.access});
    }
    const gm=pathname.match(/^\/api\/guest\/([A-Za-z0-9_-]{10,90})\/([A-Za-z0-9_-]{10,90})\/status$/);
    if(req.method==='GET'&&gm){const room=getRoom(gm[1]);const guest=guestOf(room,gm[2],req);
      if(!guest)return reject(res,401,'Convidado não autorizado');
      const result={ok:true,status:guest.status};
      if(guest.status==='approved')Object.assign(result,{livekitUrl:ws,token:await mint(room,guest.id,guest.name)});
      return json(res,200,result);
    }
    if(req.method==='GET'&&['/','/guest.html','/guest.js','/styles.css','/vendor/livekit-client.umd.min.js'].includes(pathname)){
      const files={'/':'guest.html','/guest.html':'guest.html','/guest.js':'guest.js','/styles.css':'styles.css','/vendor/livekit-client.umd.min.js':path.join(__dirname,'node_modules','livekit-client','dist','livekit-client.umd.min.js')};
      const file=pathname.startsWith('/vendor')?files[pathname]:path.join(HOME,files[pathname]);
      try{const s=fs.statSync(file);if(!s.isFile())throw Error('missing');
        const mime=pathname.endsWith('.html')?'text/html; charset=utf-8':pathname.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8';
        res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','Content-Length':s.size,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self' https: wss:;"});fs.createReadStream(file).pipe(res);return;
      }catch(_){return reject(res,503,'SDK LiveKit não instalado no servidor. Execute npm install no diretório cloud.');}
    }
    return reject(res,404,'Não encontrado');
  }
  const server=http.createServer((req,res)=>{Promise.resolve(route(req,res)).catch(err=>{if(!res.headersSent)reject(res,500,'Erro interno na sala');console.error('[Cloud]',err.message)})});
  service.server=server;
  return service;
}
if(require.main===module){
  try{const app=createCloudServer();const port=Number(process.env.PORT||8080);app.server.listen(port,'0.0.0.0',()=>console.log('Cloud signaling pronto na porta '+port));}
  catch(e){console.error('Erro de configuração:',e.message);process.exitCode=1;}
}
module.exports={createCloudServer};
