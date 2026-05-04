import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('jimengDesktop', {
  bridgeUrl: 'http://127.0.0.1:3210',
  openJimengWeb: (data: any) => {
    return ipcRenderer.invoke('open-jimeng-web', data);
  },
});
