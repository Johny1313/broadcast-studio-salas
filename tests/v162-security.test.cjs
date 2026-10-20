"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('sem baixador de executáveis e sem desativar proteções do Windows',()=>{
  const files=['server/room-server.cjs','INICIAR_WINDOWS.bat','INICIAR_MAC.command','electron/main.cjs'];
  for(const file of files){const s=read(file);assert.doesNotMatch(s,/downloadWithSha|powershell\s+-enc|ExecutionPolicy\s+Bypass|certutil\s+-urlcache/i,file);}
  assert.doesNotMatch(read('server/room-server.cjs'),/https\.get\(|github\.com\/cloudflare\/cloudflared\/releases/);
  assert.match(read('server/room-server.cjs'),/spawnSync\(chosen,\['--version'\]/);
});
test('bloqueador tem detecção explícita para execução no navegador',()=>{
 const s=read('app.js');assert.match(s,/Modo navegador comum: o aplicativo NÃO bloqueia anúncios/);
 assert.match(s,/bridge\.testAdFilter\(\)/);
 assert.match(read('index.html'),/btnTestAdFilter/);
 assert.match(read('electron/main.cjs'),/adfilter:test/);
});
test('script principal prefere modo Electron somente quando instalado',()=>{
 assert.match(read('INICIAR_WINDOWS.bat'),/node_modules\\.bin\\electron.cmd/);
 assert.match(read('INICIAR_MAC.command'),/node_modules\/.bin\/electron/);
});
test('navegação Electron usa sandbox e restringe permissão a domínio local do produtor',()=>{
 const s=read('electron/main.cjs');assert.match(s,/sandbox: true/);
 assert.match(s,/details\?\.requestingUrl/);
 assert.match(s,/contents===window\?\.webContents/);
});
