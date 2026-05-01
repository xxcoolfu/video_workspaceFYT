import { app, BrowserWindow, shell } from 'electron';
import { is } from '@electron-toolkit/utils';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startJimengBridge } from '../../server/jimengBridge.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
let bridge: Awaited<ReturnType<typeof startJimengBridge>> | null = null;

async function createWindow() {
  bridge = await startJimengBridge({ port: 3210 });

  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: 'AI视频制作',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  bridge?.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
