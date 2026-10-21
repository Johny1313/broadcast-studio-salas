import {existsSync,copyFileSync,mkdirSync,statSync} from 'node:fs';
import {resolve} from 'node:path';

// SDK is served from the same origin as the Worker. No third-party runtime CDN.
const dist=resolve('node_modules/livekit-client/dist/livekit-client.umd.min.js');
if(!existsSync(dist)){
  console.error('SDK LiveKit não encontrado. Execute npm install antes do build.');
  process.exitCode=1;
}else{
  const target=resolve('public/vendor/livekit-client.umd.min.js');
  mkdirSync(resolve('public/vendor'),{recursive:true});
  copyFileSync(dist,target);
  console.log('SDK LiveKit incorporado ao pacote web: '+statSync(target).size+' bytes');
}
