const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  checkProxies: (data) => ipcRenderer.invoke('check-proxies', data),
  saveCsv: (data) => ipcRenderer.invoke('save-csv', data),
  onStarted: (cb) => ipcRenderer.on('check-started', (_, d) => cb(d)),
  onProgress: (cb) => ipcRenderer.on('check-progress', (_, d) => cb(d)),
  onResult: (cb) => ipcRenderer.on('check-result', (_, d) => cb(d)),
  onDone: (cb) => ipcRenderer.on('check-done', (_, d) => cb(d)),
});
