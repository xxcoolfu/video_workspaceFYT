import { app, BrowserWindow, shell, dialog } from 'electron';
import { is } from '@electron-toolkit/utils';
import { dirname, join } from 'node:path';
import { appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
let bridge: any = null;

const logFilePath = join(require('os').homedir(), '.jimeng-video-desktop', 'app.log');
function log(msg: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  console.log(line.trimEnd());
  try {
    mkdirSync(dirname(logFilePath), { recursive: true });
    appendFileSync(logFilePath, line);
  } catch {}
}

async function createWindow() {
  log('=== 应用启动 ===');
  
  log('正在创建窗口...');
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: 'AI视频制作',
    show: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
    },
  });

  mainWindow.webContents.openDevTools();
  
  log('窗口已创建并显示');

  try {
    log(`is.dev: ${is.dev}`);
    log(`__dirname: ${__dirname}`);
    log(`process.resourcesPath: ${process.resourcesPath}`);
    log(`app.isPackaged: ${app.isPackaged}`);
    
    let serverPath;
    let nodeModulesPath;
    
    if (is.dev) {
      serverPath = join(__dirname, '../../server/jimengBridge.mjs');
      nodeModulesPath = join(__dirname, '../../node_modules');
    } else {
      serverPath = join(process.resourcesPath, 'server/jimengBridge.mjs');
      nodeModulesPath = join(__dirname, '../node_modules');
    }
    
    log(`serverPath: ${serverPath}`);
    log(`nodeModulesPath: ${nodeModulesPath}`);
    
    try {
      log('正在加载 server 模块...');
      
      let finalNodeModulesPath = nodeModulesPath;
      if (!is.dev) {
        const unpackedPath = join(process.resourcesPath, 'app.asar.unpacked/node_modules');
        log(`unpackedPath: ${unpackedPath}`);
        finalNodeModulesPath = `${unpackedPath};${nodeModulesPath}`;
        log(`finalNodeModulesPath: ${finalNodeModulesPath}`);
      }
      
      process.env.NODE_PATH = finalNodeModulesPath;
      log(`NODE_PATH: ${process.env.NODE_PATH}`);
      
      const module = await import(pathToFileURL(serverPath).href);
      const startJimengBridge = module.startJimengBridge;
      
      log('正在启动 server...');
      bridge = await startJimengBridge({ 
        port: 3210, 
        nodeModulesPath: finalNodeModulesPath 
      });
      log(`Server 启动成功，端口: ${bridge?.port}`);
    } catch (serverError) {
      log(`Server 启动失败: ${String(serverError)}`);
      dialog.showErrorBox('Server 错误', 
        `Server 启动失败:\n\n${String(serverError)}`
      );
    }

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: 'deny' };
    });

    log('正在加载页面...');
    if (is.dev && process.env.ELECTRON_RENDERER_URL) {
      await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      const rendererPath = join(__dirname, '../renderer/index.html');
      log(`Renderer 路径: ${rendererPath}`);
      await mainWindow.loadFile(rendererPath);
    }

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      log(`页面加载失败: ${errorCode} ${errorDescription}`);
    });

  } catch (error) {
    log(`启动过程出错: ${error instanceof Error ? error.message : String(error)}`);
    dialog.showErrorBox('启动出错', 
      `发生错误:\n\n${error instanceof Error ? error.message : String(error)}`
    );
  }
}

app.whenReady().then(() => {
  log('App ready');
  createWindow();
});

app.on('window-all-closed', () => {
  bridge?.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
