import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('jimengDesktop', {
  bridgeUrl: 'http://127.0.0.1:3210',
});
