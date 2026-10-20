'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('broadcastBridge', Object.freeze({
  adFilterStatus: () => ipcRenderer.invoke('adfilter:status'),
  testAdFilter: () => ipcRenderer.invoke('adfilter:test'),
  setAdFilterMode: (mode) => ipcRenderer.invoke('adfilter:mode', mode),
  startRtmp: (payload) => ipcRenderer.invoke('rtmp:start', payload),
  stopRtmp: (id) => ipcRenderer.invoke('rtmp:stop', id),
  sendChunk: (id, bytes) => ipcRenderer.send('rtmp:chunk', id, bytes),
  onStatus: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('rtmp:status', listener);
    return () => ipcRenderer.removeListener('rtmp:status', listener);
  },
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  selectCloudflared: () => ipcRenderer.invoke('cloudflared:choose'),
  ffmpegStatus: () => ipcRenderer.invoke('ffmpeg:status'),
  chooseRecordingFolder: () => ipcRenderer.invoke('record:choose-folder'),
  startRecordingFile: (p) => ipcRenderer.invoke('record:start', p),
  sendRecordingChunk: (id, bytes) => ipcRenderer.send('record:chunk', id, bytes),
  stopRecordingFile: (id) => ipcRenderer.invoke('record:stop', id)
}));
