import {copyFileSync, existsSync, mkdirSync, statSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// LiveKit v2 distributes the UMD SDK as livekit-client.umd.js in some releases.
// Keep the public alias stable for guest.html and cloud-studio.js.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const candidates=[
  resolve(root,'node_modules/livekit-client/dist/livekit-client.umd.min.js'),
  resolve(root,'node_modules/livekit-client/dist/livekit-client.umd.js')
];
const sdk=candidates.find(path=>existsSync(path)&&statSync(path).isFile()&&statSync(path).size>0);
if(!sdk){
  console.error('Não foi possível encontrar o SDK UMD do LiveKit. Caminhos verificados:');
  for(const candidate of candidates)console.error(' - '+candidate);
  console.error('Verifique se livekit-client foi instalado e se o pacote contém o arquivo dist/livekit-client.umd.js.');
  process.exitCode=1;
}else{
  const target=resolve(root,'public/vendor/livekit-client.umd.min.js');
  mkdirSync(dirname(target),{recursive:true});
  copyFileSync(sdk,target);
  console.log('SDK LiveKit incorporado: '+sdk.split(/[\\/]/).pop()+' → /vendor/livekit-client.umd.min.js ('+statSync(target).size+' bytes)');
}
