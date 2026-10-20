'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const js=fs.readFileSync(path.join(root,'app.js'),'utf8');
const preload=fs.readFileSync(path.join(root,'electron','preload.cjs'),'utf8');
const electron=fs.readFileSync(path.join(root,'electron','main.cjs'),'utf8');
test('dois canvas independentes e monitores de PROGRAMA presentes',()=>{
  for(const id of ['previewH','previewV','programMonitorH','programMonitorV','btnTakeH','btnTakeV','btnTakeBoth','btnRecordBoth','btnStopBoth'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(js,/programCanvases=\{h:/);
  assert.match(js,/state\.program\[format\]=next/);
  assert.match(js,/const next=clone\(state\.preview\[format\]\)/);
});
test('arquitetura desktop não habilita Node direto na página',()=>{
  assert.match(electron,/nodeIntegration: false, contextIsolation: true/);
  assert.match(preload,/contextBridge\.exposeInMainWorld/);
  assert.match(electron,/SUPPORTED_PROTOCOL/);
});
test('composição de programa possui áudio filtrado por slot ao vivo',()=>{
  assert.match(js,/const liveSources=new Set/);
  assert.match(js,/liveSources\.has\(src\.id\)\?src\.volume:0/);
});
test('gravação 16x9 e 9x16 e destinos RTMP implementados',()=>{
  assert.match(js,/captureStream\(30\)/);
  assert.match(js,/MediaRecorder/);
  assert.match(js,/startAllOutputs/);
  assert.match(electron,/ffmpeg/);
  assert.match(electron,/record:chunk/);
});
test('V1.1 define exatamente 3 câmeras e o quarto canal playlist em ambos os canvas',()=>{
  for(const f of ['h','v']){
    for(let i=1;i<=3;i++)assert.match(js,new RegExp(`id:'${f}_cam${i}'`));
    assert.match(js,new RegExp(`id:'${f}_playlist'`));
  }
  for(let i=1;i<=3;i++){
    assert.match(html,new RegExp(`id="cameraSelect${i}"`));
    assert.match(html,new RegExp(`id="btnCamera${i}"`));
    assert.match(html,new RegExp(`id="cameraStatus${i}"`));
  }
  assert.match(js,/state\.preview\[format\]\.slots\[3\]\.sourceId=id/);
  assert.match(js,/for\(const slot of scene\.slots\)if\(slot\.enabled!==false\)drawSlot/);
});
test('slots fixos por canal: ocultar e restaurar em vez de criar quinto',()=>{
  assert.match(js,/All four channels are permanent/);
  assert.match(js,/state\.preview\[format\]\.slots\.forEach\(s=>s\.enabled=true\)/);
  assert.match(js,/s\.enabled=s\.enabled===false/);
  for(const id of ['channelsH','channelsV'])assert.match(html,new RegExp(`id="${id}"`));
});

test('V1.2 preview web OFF-AIR separado de captura de programa',()=>{
  for (const id of ['btnRehearse','linkPreviewStatus','webOverlayH','webOverlayV','previewWrapH','previewWrapV'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(js,/function classifyMediaUrl/);
  assert.match(js,/youtube-nocookie\.com\/embed/);
  assert.match(js,/player\.vimeo\.com\/video/);
  assert.match(js,/function syncWebOverlays/);
  assert.match(js,/Página externa mantida no ENSAIO/);
  assert.match(js,/slot\.sourceId=state\.sources\.get\(previous\)\?\.kind==='external'\?null:previous/);
});
