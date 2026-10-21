'use strict';
/** Local studio room control + separate guest-facing HTTP surface. Zero external deps.
 * Public HTTPS tunnel MUST point at guest port only (8792), not host port (8791).
 * WebRTC media goes directly between peers (STUN; TURN optional), not through this server.
 */
const http=require('node:http');
const path=require('node:path');
const fs=require('node:fs');
const {randomBytes}=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');
const {loadIceConfig,safeDiagnostics}=require('./ice-config.cjs');
const HOST_PORT=Number(process.env.BROADCAST_HOST_PORT||8791);
const GUEST_PORT=Number(process.env.BROADCAST_GUEST_PORT||8792);
const ROOT=path.resolve(__dirname,'..');
const rooms=new Map();

// Security-first: no remote executable downloads, unpacking, or hidden installs.
// The operator installs official cloudflared separately and can choose its path.
// Public guest sharing always exposes only guest port (not the studio UI).
let tunnelProcess=null,tunnelUrl=null,tunnelStarting=null;
const GUEST_INSTANCE_ID=randomBytes(18).toString('hex');
function cloudflaredDiagnostic(){
  // Nenhum executável será baixado automaticamente. Do not download anything or execute shell commands.
  const chosen=process.env.BROADCAST_CLOUDFLARED_PATH||'cloudflared';
  const verify=spawnSync(chosen,['--version'],{shell:false,windowsHide:true,timeout:6000,encoding:'utf8'});
  const output=String(verify.stdout||'')+' '+String(verify.stderr||'');
  const found=!verify.error && verify.status===0 && /cloudflared version/i.test(output);
  const version=(output.match(/cloudflared version\s+([^\s]+)/i)||[])[1]||null;
  const reason=found?'ok':verify.error?.code==='ENOENT'?'not-found':verify.error?.code==='ETIMEDOUT'?'timeout':'invalid';
  return {installed:found,reason,version}; // Never send executable path to a guest.
}
function ensureCloudflared(){
  const check=cloudflaredDiagnostic();
  if(!check.installed)
    throw Error(check.reason==='not-found'?'cloudflared não localizado neste computador. No Windows instale pelo PowerShell com winget install -e --id Cloudflare.cloudflared; feche e reabra o aplicativo. Se já instalou, selecione o arquivo oficial no modo Electron ou configure BROADCAST_CLOUDFLARED_PATH.':'cloudflared encontrado, mas não validado (execução/versão). Confira a instalação oficial e o antivírus.');
  return process.env.BROADCAST_CLOUDFLARED_PATH||'cloudflared';
}
function validPublicOrigin(input){
  const url=new URL(String(input||''));
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)throw Error('Informe somente o domínio HTTPS público, sem caminhos ou parâmetros.');
  const host=url.hostname.toLowerCase().replace(/\.$/,'');
  if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||/^\d+\.\d+\.\d+\.\d+$/.test(host)||host==='[::1]'||!host.includes('.'))throw Error('O endereço precisa ser um domínio público HTTPS, não localhost ou IP.');
  return url.origin;
}
async function validateGuestOrigin(input){
  const origin=validPublicOrigin(input);
  const ac=new AbortController();const timer=setTimeout(()=>ac.abort(),5500);
  try{
    const response=await fetch(origin+'/api/health',{signal:ac.signal,redirect:'error',headers:{'Accept':'application/json'}});
    if(!response.ok)throw Error('HTTP '+response.status);
    const data=await response.json();
    if(data.service!=='broadcast-studio-guest'||data.instance!==GUEST_INSTANCE_ID)
      throw Error('O domínio não está apontando para a sala de convidados deste aplicativo.');
    return origin;
  }catch(e){
    const cause=String(e.cause?.code||e.code||'');
    const msg=String(e.cause?.message||e.message||'');
    if(/SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|CERT_HAS_EXPIRED|UNABLE_TO_GET_ISSUER_CERT|CERTIFICATE_VERIFY_FAILED|self.signed|certificate chain/i.test(cause+' '+msg))
      throw Error('Certificado HTTPS não confiável. Se sua rede usa inspeção TLS, peça à TI o certificado da CA corporativa e configure NODE_EXTRA_CA_CERTS com o caminho do arquivo PEM. Não desative a verificação TLS.');
    throw Error('O endereço ainda não abre a sala deste computador ('+e.message+').');
  }
  finally{clearTimeout(timer);}
}
async function verifyTunnelOrigin(origin,proc){
  let lastError;
  for(let attempt=0;attempt<7;attempt++){
    if(proc?.exitCode!==null || proc?.signalCode)throw Error('cloudflared encerrou durante a validação do link.');
    if(attempt)await new Promise(resolve=>setTimeout(resolve,950));
    try{return await validateGuestOrigin(origin);}catch(e){lastError=e;}
  }
  throw lastError||Error('Túnel HTTPS não alcançou a sala de convidados.');
}
async function startTunnel(){
  if(tunnelUrl&&tunnelProcess&&!tunnelProcess.killed)return tunnelUrl;
  if(tunnelStarting)return tunnelStarting;
  tunnelStarting=(async()=>{
    const executable=ensureCloudflared();
    const proc=spawn(executable,['tunnel','--url',`http://127.0.0.1:${GUEST_PORT}`],{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    tunnelProcess=proc;
    let buffer='',found=false;
    const foundUrl=await new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(err,url)=>{if(settled)return;settled=true;clearTimeout(timer);err?reject(err):resolve(url)};
      const timer=setTimeout(()=>finish(Error('cloudflared não forneceu um endereço HTTPS válido.')),30000);
      const onData=chunk=>{buffer=(buffer+String(chunk)).slice(-5000);
        const match=buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i);
        if(match&&!found){found=true;finish(null,match[0]);}
      };
      proc.stdout.on('data',onData);proc.stderr.on('data',onData);
      proc.once('error',()=>finish(Error('Falha ao iniciar cloudflared. Consulte o guia de instalação.')));
      proc.once('exit',code=>{const tail=/self.signed.certificate|unknown.authority|certificate.chain/i.test(buffer)?' Certificado corporativo não confiável. Consulte a TI para instalar a CA legítima no sistema; não desative TLS.':'';finish(Error('cloudflared encerrou antes de iniciar (código '+code+').'+tail));});
    });
    if(proc.exitCode!==null)throw Error('cloudflared encerrou antes de validar o endereço.');
    const verified=await verifyTunnelOrigin(foundUrl,proc);
    if(proc.exitCode!==null)throw Error('cloudflared encerrou inesperadamente.');
    tunnelUrl=verified;
    return verified;
  })().catch(err=>{try{tunnelProcess?.kill()}catch(_){}tunnelProcess=null;tunnelUrl=null;throw err;}).finally(()=>{tunnelStarting=null;});
  return tunnelStarting;
}
function stopTunnel(){try{tunnelProcess?.kill()}catch(_){}tunnelProcess=null;tunnelUrl=null;}
process.on('exit',stopTunnel);
for(const sig of ['SIGTERM','SIGINT'])process.once(sig,()=>{stopTunnel();process.exit(0);});

function iceConfig(){
  // Load on demand, so operators can edit local rede.config.json before the next call.
  // Legacy BROADCAST_TURN_* remains supported only if no explicit config is present.
  if(process.env.BROADCAST_TURN_URL && !fs.existsSync(process.env.BROADCAST_REDE_CONFIG||path.join(ROOT,'rede.config.json'))){
    const {parseConfig}=require('./ice-config.cjs');
    return parseConfig({turn:[{urls:process.env.BROADCAST_TURN_URL,username:process.env.BROADCAST_TURN_USER||'',credential:process.env.BROADCAST_TURN_PASSWORD||''}]});
  }
  return loadIceConfig();
}
function respondIce(res,host=false){
  try{const config=iceConfig();return json(res,200,{ok:true,...config,...(host?{diagnostics:safeDiagnostics(config)}:{})});}
  catch(err){return fail(res,422,'Configuração STUN/TURN inválida: '+err.message);}
}
const token=(size=24)=>randomBytes(size).toString('base64url');
const json=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(data));};
function ipOk(req){return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);}
function fail(res,code,msg){json(res,code,{ok:false,error:msg});}
function readBody(req){return new Promise((resolve,reject)=>{let raw='',size=0;req.on('data',buf=>{size+=buf.length;if(size>95000){req.destroy();reject(Error('Pedido grande'));return;}raw+=buf;});req.on('end',()=>{try{resolve(JSON.parse(raw||'{}'));}catch(_){reject(Error('JSON inválido'));}});req.on('error',reject);});}
function push(room,who,type,data){const ev={seq:++room.seq,who,type,...data};room.events.push(ev);if(room.events.length>2400)room.events.splice(0,room.events.length-2400);room.updated=Date.now();}
function identify(room,role,secret,guestId){if(role==='host')return secret===room.hostSecret?'host':null;if(role==='guest'){const p=room.guests.get(guestId);return p&&p.secret===secret?guestId:null;}return null;}
function sendFile(res,file){const p=path.join(ROOT,file);const ext=path.extname(p);const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.json':'application/json'}[ext]||'application/octet-stream';try{const stat=fs.statSync(p);if(!stat.isFile())throw Error();res.writeHead(200,{'Content-Type':type,'Content-Length':stat.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});fs.createReadStream(p).pipe(res);}catch(_){res.writeHead(404);res.end('Não encontrado');}}
function hostApi(req,res,url){
  if(!ipOk(req))return fail(res,403,'Host permitido somente localmente');
  if(req.method==='POST'&&url.pathname==='/api/rooms'){
    const id=token(9),room={id,hostSecret:token(),guestToken:token(),guests:new Map(),events:[],seq:0,created:Date.now(),updated:Date.now()};rooms.set(id,room);
    return json(res,200,{ok:true,room:id,hostToken:room.hostSecret,guestToken:room.guestToken,localGuestBase:`http://127.0.0.1:${GUEST_PORT}`});
  }
  const room=rooms.get(url.searchParams.get('room'));
  if(!room)return fail(res,404,'Sala não encontrada');
  const secret=req.headers['x-studio-token'];
  if(secret!==room.hostSecret)return fail(res,403,'Token do produtor inválido');
  if(req.method==='GET'&&url.pathname==='/api/tunnel-status')return json(res,200,{ok:true,active:!!(tunnelUrl&&tunnelProcess&&!tunnelProcess.killed),baseUrl:tunnelUrl||null});
  if(req.method==='GET'&&url.pathname==='/api/cloudflared-diagnostic')return json(res,200,{ok:true,...cloudflaredDiagnostic()});
  if(req.method==='POST'&&url.pathname==='/api/check-public')return readBody(req).then(async body=>{
    try{const baseUrl=await validateGuestOrigin(body.baseUrl);return json(res,200,{ok:true,baseUrl});}
    catch(err){return fail(res,422,err.message);}
  }).catch(()=>fail(res,400,'Endereço inválido'));
  if(req.method==='GET'&&url.pathname==='/api/config')return respondIce(res,true);
  if(req.method==='POST'&&url.pathname==='/api/tunnel'){
    return startTunnel().then(baseUrl=>json(res,200,{ok:true,baseUrl})).catch(err=>fail(res,503,err.message));
  }
  if(req.method==='GET'&&url.pathname==='/api/events'){
    const cursor=Math.max(0,Number(url.searchParams.get('cursor'))||0);
    return json(res,200,{ok:true,events:room.events.filter(e=>e.seq>cursor&&e.who==='host').slice(0,120),cursor:room.seq,guests:[...room.guests.values()].map(p=>({id:p.id,name:p.name,approved:p.approved,connected:p.connected}))});
  }
  if(req.method==='POST'&&url.pathname==='/api/approve')return readBody(req).then(body=>{
    const p=room.guests.get(body.guestId);if(!p)return fail(res,404,'Participante desconhecido');
    p.approved=!!body.approve;
    push(room,p.id,p.approved?'approved':'rejected',{});
    if(!p.approved){p.connected=false;p.rejected=true;}
    return json(res,200,{ok:true});
  }).catch(()=>fail(res,400,'Pedido inválido'));
  if(req.method==='POST'&&url.pathname==='/api/signal')return readBody(req).then(body=>{
    const p=room.guests.get(body.guestId);
    if(!p?.approved||!['offer','answer','ice'].includes(body.type)||!body.signal||typeof body.signal!=='object')return fail(res,400,'Sinal não autorizado');
    push(room,p.id,'signal',{guestId:p.id,signalType:body.type,signal:body.signal});return json(res,200,{ok:true});
  }).catch(()=>fail(res,400,'Pedido inválido'));
  return fail(res,404,'Endpoint desconhecido');
}
function guestApi(req,res,url){
  if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{service:'broadcast-studio-guest',instance:GUEST_INSTANCE_ID});
  if(req.method==='POST'&&url.pathname==='/api/join')return readBody(req).then(body=>{
    const room=rooms.get(body.room);
    if(!room||room.guestToken!==body.token)return fail(res,403,'Convite inválido ou expirado');
    if(room.guests.size>=8)return fail(res,409,'Sala cheia (máximo 8 participantes em espera)');
    const name=String(body.name||'Convidado').trim().slice(0,48)||'Convidado';
    const id=token(8),secret=token(24);
    room.guests.set(id,{id,secret,name,approved:false,connected:true});
    push(room,'host','joined',{guestId:id,name});
    return json(res,200,{ok:true,room:room.id,guestId:id,guestSecret:secret});
  }).catch(()=>fail(res,400,'Pedido inválido'));
  const room=rooms.get(url.searchParams.get('room'));if(!room)return fail(res,404,'Sala não encontrada');
  const guestId=url.searchParams.get('guestId'),secret=req.headers['x-guest-token'];const p=room.guests.get(guestId);
  if(!p||p.secret!==secret)return fail(res,403,'Convidado não autorizado');
  if(req.method==='GET'&&url.pathname==='/api/config')return respondIce(res,false);
  if(req.method==='GET'&&url.pathname==='/api/events'){
    const cursor=Math.max(0,Number(url.searchParams.get('cursor'))||0);
    return json(res,200,{ok:true,approved:p.approved,events:room.events.filter(e=>e.seq>cursor&&e.who===guestId).slice(0,120),cursor:room.seq});
  }
  if(req.method==='POST'&&url.pathname==='/api/signal')return readBody(req).then(body=>{
    if(!p.approved||!['offer','answer','ice'].includes(body.type)||!body.signal||typeof body.signal!=='object')return fail(res,403,'Aguardando aprovação');
    push(room,'host','signal',{guestId,signalType:body.type,signal:body.signal});return json(res,200,{ok:true});
  }).catch(()=>fail(res,400,'Pedido inválido'));
  if(req.method==='POST'&&url.pathname==='/api/leave'){
    room.guests.delete(guestId);push(room,'host','left',{guestId});return json(res,200,{ok:true});
  }
  return fail(res,404,'Endpoint desconhecido');
}
const hostServer=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname.startsWith('/api/'))return hostApi(req,res,u);
  const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/cloud-studio.js':'cloud-studio.js','/styles.css':'styles.css'};
  if(req.method!=='GET'||!files[u.pathname])return fail(res,404,'Não encontrado');
  return sendFile(res,files[u.pathname]);
});
const guestServer=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname.startsWith('/api/'))return guestApi(req,res,u);
  const files={'/':'guest.html','/guest.html':'guest.html','/guest.js':'guest.js','/styles.css':'styles.css'};
  if(req.method!=='GET'||!files[u.pathname])return fail(res,404,'Não encontrado');
  return sendFile(res,files[u.pathname]);
});
let readyCount=0;
for(const [server,port] of [[hostServer,HOST_PORT],[guestServer,GUEST_PORT]]){
  server.on('error',err=>{process.stderr.write(`[ROOM SERVER] Porta ${port}: ${err.message}\n`);});
  server.listen(port,'127.0.0.1',()=>{readyCount++;process.stdout.write(`[ROOM SERVER] ${port===HOST_PORT?'Estúdio':'Convidados'} disponível: http://127.0.0.1:${port}\n`);});
}
const gc=setInterval(()=>{for(const [id,room] of rooms)if(Date.now()-room.updated>12*60*60*1000)rooms.delete(id);},30*60*1000);gc.unref();
module.exports={hostServer,guestServer};
