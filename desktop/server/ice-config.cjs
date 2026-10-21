'use strict';
/** Validated WebRTC ICE configuration. No third-party server is bundled or started. */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname,'..');
const configPath = process.env.BROADCAST_REDE_CONFIG || path.join(ROOT,'rede.config.json');
function parseConfig(data){
  if(!data || typeof data !== 'object' || Array.isArray(data))throw Error('Configuração de rede deve ser objeto JSON.');
  const stun = Array.isArray(data.stun) ? data.stun : ['stun:stun.l.google.com:19302'];
  const turn = Array.isArray(data.turn) ? data.turn : [];
  const policy = data.iceTransportPolicy || 'all';
  if(!['all','relay'].includes(policy))throw Error('iceTransportPolicy deve ser all ou relay');
  if(stun.length>8||turn.length>8)throw Error('Limite de 8 STUN e 8 TURN');
  const iceServers=[];
  for(const url of stun){
    if(typeof url !== 'string' || !/^stuns?:[a-z0-9.\-\[\]:]+(?::\d{1,5})?$/i.test(url))throw Error('STUN URL inválida');
    iceServers.push({urls:url});
  }
  for(const s of turn){
    if(!s || typeof s !== 'object' || typeof s.urls !== 'string' || !/^turns?:[^\s@/?#]+(?::\d{1,5})?(?:\?transport=(?:tcp|udp))?$/i.test(s.urls))throw Error('TURN URL inválida');
    if(typeof s.username !== 'string' || !s.username || typeof s.credential !== 'string' || !s.credential)throw Error('TURN exige username e credential');
    iceServers.push({urls:s.urls,username:s.username,credential:s.credential});
  }
  if(policy==='relay' && !turn.length)throw Error('Modo relay exige servidor TURN válido');
  return {iceServers,iceTransportPolicy:policy};
}
function loadIceConfig(){
  if(!fs.existsSync(configPath))return parseConfig({});
  return parseConfig(JSON.parse(fs.readFileSync(configPath,'utf8')));
}
function safeDiagnostics(config){
  return {policy:config.iceTransportPolicy,stun:config.iceServers.filter(x=>x.urls.startsWith('stun')).map(x=>x.urls),turn:config.iceServers.filter(x=>x.urls.startsWith('turn')).map(x=>x.urls),turnConfigured:config.iceServers.some(x=>x.urls.startsWith('turn'))};
}
module.exports={parseConfig,loadIceConfig,safeDiagnostics};
