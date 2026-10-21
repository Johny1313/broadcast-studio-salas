'use strict';
const { app, BrowserWindow, ipcMain, shell, session, dialog } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const { existsSync, createWriteStream } = require('node:fs');
const { createAdFilter, COSMETIC_CSS } = require('./ad-filter.cjs');
const {hostServer} = require('../server/room-server.cjs'); // producer-only and guest-only local endpoints

let window;
let adFilter;
const outputs = new Map();
const recordings = new Map();
const SUPPORTED_PROTOCOL = /^rtmps?:\/\/[^\s/]+\/.+/i;
const VALID_ID = /^[a-zA-Z0-9_-]{1,70}$/;
const MAX_PIPE_BUFFER = 12 * 1024 * 1024;

function ffmpegExecutable() {
  const custom = process.env.BROADCAST_FFMPEG_PATH;
  if (custom && existsSync(custom)) return custom;
  // Use the executable installed in the OS PATH, never a shell command.
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}
function ffmpegAvailable() {
  try {
    const res = spawnSync(ffmpegExecutable(), ['-version'], {timeout: 3500, windowsHide:true, encoding:'utf8'});
    return res.status === 0;
  } catch (_) { return false; }
}
function emit(data) { if (window && !window.isDestroyed()) window.webContents.send('rtmp:status', data); }
function stopOutput(id, reason='parado') {
  const item = outputs.get(id);
  if (!item) return;
  outputs.delete(id);
  try { item.proc.stdin.end(); } catch (_) {}
  const proc = item.proc;
  // Gracefully close FFmpeg. Kill it if it gets stuck.
  const killer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} }, 3000);
  killer.unref();
  proc.once('exit', () => clearTimeout(killer));
  emit({id, state:reason});
}

async function createWindow() {
  if (!adFilter) adFilter=createAdFilter(session.defaultSession.webRequest);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    // External frames must never inherit local studio camera/microphone permission.
    let safe=false;
    try {
      const req=new URL(details?.requestingUrl||'');
      safe=contents===window?.webContents && req.origin===`http://127.0.0.1:${process.env.BROADCAST_HOST_PORT||8791}`;
    } catch (_) {}
    callback(safe && (permission === 'media' || permission === 'display-capture'));
  });
  window = new BrowserWindow({
    width: 1600, height: 970, minWidth: 1100, minHeight: 700,
    backgroundColor: '#0c1018', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true
    }
  });
  window.webContents.setWindowOpenHandler(({url}) => {
    // Block unsolicited pop-up navigation when clean mode is enabled.
    // The explicit 'Abrir site' toolbar always calls the secured open:external IPC.
    if (adFilter.getMode()==='off' && /^https?:\/\//i.test(url)) shell.openExternal(url);
    return {action:'deny'};
  });
  window.webContents.on('did-frame-finish-load', (_event, isMainFrame, processId, routingId) => {
    if (isMainFrame || adFilter.getMode() !== 'enhanced') return;
    const {webFrameMain}=require('electron');
    const frame=webFrameMain.fromId(processId, routingId);
    if (!frame || frame.isDestroyed()) return;
    let url;
    try {url=new URL(frame.url);} catch (_) {return;}
    if (!['https:','http:'].includes(url.protocol)) return;
    // Do not interfere with the native player controls in video providers.
    if (/(^|\.)(youtube\.com|youtube-nocookie\.com|vimeo\.com)$/.test(url.hostname)) return;
    frame.executeJavaScript(`(()=>{if(!document.getElementById('bs-clean-filter-style')){const s=document.createElement('style');s.id='bs-clean-filter-style';s.textContent=${JSON.stringify(COSMETIC_CSS)};(document.head||document.documentElement).appendChild(s)}})()`)
      .catch(()=>{}); // CSP and cross-origin restrictions can prevent cosmetic hiding.
  });
  const loadStudio = () => window.loadURL('http://127.0.0.1:'+(process.env.BROADCAST_HOST_PORT||8791)+'/');
  if(hostServer.listening) await loadStudio(); else hostServer.once('listening', loadStudio);
  window.on('closed', () => { for (const id of [...outputs.keys()]) stopOutput(id); window = null; });
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
app.on('before-quit', () => { for (const id of [...outputs.keys()]) stopOutput(id); for (const item of recordings.values()) {try{item.stream.end()}catch(_){}} });

ipcMain.handle('adfilter:status', (event) => event.sender === window?.webContents ? adFilter.status() : {available:false});
ipcMain.handle('adfilter:mode', (event,mode) => {
  if (event.sender !== window?.webContents) return {available:false};
  try {return adFilter.setMode(mode);} catch (_) {return {available:true,error:'Modo inválido'};}
});
// Opt-in end-to-end diagnostic. A known ad host is requested from the studio's
// Chromium session; the webRequest interceptor cancels it before network access.
ipcMain.handle('adfilter:test', async event=>{
  if(event.sender !== window?.webContents)return {ok:false,error:'Origem inválida'};
  if(adFilter.getMode()==='off')return {ok:false,error:'Proteção desligada'};
  const previous=adFilter.status().blocked;
  const resource='https://ad.doubleclick.net/__broadcast_studio_adblock_test__?nonce='+Date.now();
  try{
    // A real <img> request from the studio renderer guarantees that the
    // request passes through this window's session.webRequest handler.
    await window.webContents.executeJavaScript(`new Promise(resolve=>{
      const img=new Image();let settled=false;
      const finish=()=>{if(!settled){settled=true;resolve(true)}};
      const timeout=setTimeout(finish,2500);
      img.onload=img.onerror=()=>{clearTimeout(timeout);finish()};
      img.src=${JSON.stringify(resource)};
    })`);
  }catch(_){} // ERR_BLOCKED_BY_CLIENT / ERR_ABORTED expected when filter works.
  const current=adFilter.status().blocked;
  return {ok:current>previous,error:current>previous?null:'A requisição não foi interceptada na sessão Electron.',blockedBefore:previous,blockedAfter:current};
});

// Explicit opt-in selection from a native file dialog. No automated download.
// This is only available in the trusted local producer window.
ipcMain.handle('cloudflared:choose', async event => {
  if (event.sender !== window?.webContents) return {ok:false,error:'Origem inválida'};
  const chosen=await dialog.showOpenDialog(window,{
    title:'Selecione o cloudflared oficial previamente instalado',
    properties:['openFile'],
    filters:process.platform==='win32'?[{name:'Cloudflared',extensions:['exe']}]:[]
  });
  if(chosen.canceled || !chosen.filePaths[0])return {ok:false,cancelled:true};
  const filepath=chosen.filePaths[0];
  const filename=path.basename(filepath).toLowerCase();
  if(!/^cloudflared(?:[-_][a-z0-9_-]+)?(?:\.exe)?$/.test(filename))
    return {ok:false,error:'Selecione apenas um arquivo cloudflared oficial.'};
  const check=spawnSync(filepath,['--version'],{shell:false,windowsHide:true,timeout:6000,encoding:'utf8'});
  const banner=String(check.stdout||'')+' '+String(check.stderr||'');
  if(check.error||check.status!==0||!/cloudflared version/i.test(banner))
    return {ok:false,error:'O executável escolhido não passou no teste de versão do cloudflared.'};
  process.env.BROADCAST_CLOUDFLARED_PATH=filepath;
  return {ok:true,version:(banner.match(/cloudflared version\s+([^\s]+)/i)||[])[1]||'detectado'};
});
ipcMain.handle('ffmpeg:status', () => ({available:ffmpegAvailable(), executable:ffmpegExecutable()}));
ipcMain.handle('open:external', async (event, url) => {
  if (event.sender !== window?.webContents) throw new Error('Origem inválida');
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('Apenas links HTTP/HTTPS são permitidos.');
  return shell.openExternal(url);
});
ipcMain.handle('rtmp:start', async (event, payload) => {
  if (event.sender !== window?.webContents) return {ok:false,error:'Origem inválida'};
  const {id, url, format} = payload || {};
  if (!VALID_ID.test(id || '') || typeof url !== 'string' || !SUPPORTED_PROTOCOL.test(url) || url.length > 2500) return {ok:false,error:'ID ou URL RTMP/RTMPS inválido.'};
  if (!['h','v'].includes(format)) return {ok:false,error:'Canvas inválido.'};
  if (outputs.has(id)) return {ok:false,error:'Destino já iniciado.'};
  if (!ffmpegAvailable()) return {ok:false,error:'FFmpeg não encontrado. Instale o FFmpeg e abra novamente o aplicativo.'};
  const preset = format === 'v' ? ['2000k','4000k'] : ['2500k','5000k'];
  const args = [
    '-hide_banner','-loglevel','error',
    '-fflags','+genpts','-i','pipe:0',
    '-map','0:v:0','-map','0:a:0?',
    '-c:v','libx264','-preset','veryfast','-tune','zerolatency','-pix_fmt','yuv420p',
    '-r','30','-g','60','-b:v',preset[0],'-maxrate',preset[0],'-bufsize',preset[1],
    '-c:a','aac','-ar','48000','-b:a','128k',
    '-flvflags','no_duration_filesize','-f','flv', url
  ];
  try {
    const proc = spawn(ffmpegExecutable(), args, {stdio:['pipe','ignore','pipe'],windowsHide:true});
    const item = {proc, format, bytes:0, lastError:'', started:Date.now()};
    outputs.set(id,item);
    proc.stdin.on('error',(e) => { if (outputs.get(id) === item) {item.lastError='Entrada FFmpeg indisponível';stopOutput(id,'erro');} });
    proc.stderr.on('data', data => {
      const s = data.toString().slice(0,500);
      // FFmpeg can echo URL/stream keys in errors. Never forward raw stderr to renderer.
      item.lastError = /401|403|unauthorized|permission/i.test(s) ? 'Servidor recusou a conexão ou chave.' : 'Falha no codificador ou conexão RTMP.';
    });
    proc.once('error', () => { if (outputs.get(id)===item) {outputs.delete(id);emit({id,state:'erro',message:'Não foi possível abrir o FFmpeg.'});} });
    proc.once('exit', (code) => { if (outputs.get(id)===item) {outputs.delete(id);emit({id,state:'erro',message:item.lastError||`FFmpeg finalizado (${code}).`});} });
    emit({id,state:'iniciando'});
    return {ok:true}; // Does not mean the remote destination accepted the stream.
  } catch (_) { return {ok:false,error:'Falha ao iniciar o processo FFmpeg.'}; }
});
ipcMain.on('rtmp:chunk',(event,id, bytes) => {
  if (event.sender !== window?.webContents || typeof id!=='string') return;
  const item=outputs.get(id);
  if (!item || !bytes || !item.proc.stdin.writable) return;
  try {
    const chunk=Buffer.from(bytes);
    if (!chunk.length || chunk.length > 16*1024*1024) return;
    // Protect app RAM if an RTMP endpoint stalls.
    if (item.proc.stdin.writableLength > MAX_PIPE_BUFFER) {stopOutput(id,'erro');emit({id,state:'erro',message:'Transmissão interrompida: saída congestionada.'});return;}
    item.proc.stdin.write(chunk);
    item.bytes+=chunk.length;
    if (item.bytes > 0 && Date.now()-item.started > 2500 && !item.ready) {
      item.ready=true;
      emit({id,state:'enviando'}); // Not a server-side live confirmation.
    }
  } catch (_) {stopOutput(id,'erro');}
});
ipcMain.handle('rtmp:stop', (_event,id) => { if (typeof id==='string') stopOutput(id); return {ok:true}; });

// Recording direct-to-disk via streaming chunks avoids accumulating hours of video in renderer RAM.
ipcMain.handle('record:choose-folder', async () => {
  if (!window) return null;
  const result = await dialog.showOpenDialog(window,{title:'Escolha a pasta para salvar as gravações',properties:['openDirectory','createDirectory']});
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('record:start', async (event,payload) => {
  if (event.sender !== window?.webContents) return {ok:false,error:'Origem inválida'};
  const {id,format,directory,filename}=payload||{};
  if (!VALID_ID.test(id||'') || !['h','v'].includes(format) || typeof directory !== 'string' || !existsSync(directory) || typeof filename!=='string' || !/^[a-zA-Z0-9_-]{3,100}\.webm$/.test(filename)) return {ok:false,error:'Arquivo de gravação inválido'};
  if (recordings.has(id)) return {ok:false,error:'Gravação já iniciada'};
  try {
    const filepath = path.join(directory,filename);
    const stream = createWriteStream(filepath,{flags:'wx'});
    stream.on('error',()=>emit({id,state:'erro',message:'Falha ao gravar arquivo no disco.'}));
    recordings.set(id,{stream,filepath,bytes:0});
    return {ok:true,filepath};
  } catch (_) {return {ok:false,error:'Não foi possível criar a gravação.'};}
});
ipcMain.on('record:chunk',(event,id,bytes) => {
  if (event.sender !== window?.webContents || !recordings.has(id) || !bytes) return;
  const rec=recordings.get(id);
  try { const buf=Buffer.from(bytes); if(buf.length>16*1024*1024) return; rec.stream.write(buf); rec.bytes+=buf.length; }
  catch (_) {emit({id,state:'erro',message:'Erro ao escrever gravação no disco'});}
});
ipcMain.handle('record:stop',(_event,id) => new Promise(resolve => {
  const item=recordings.get(id);
  if (!item) return resolve({ok:false,error:'Gravação desconhecida'});
  recordings.delete(id);
  item.stream.end(()=>resolve({ok:true,filepath:item.filepath,bytes:item.bytes}));
}));
