import { app, BrowserWindow, shell, dialog, ipcMain, BrowserView } from 'electron';
import { is } from '@electron-toolkit/utils';
import { dirname, join } from 'node:path';
import { appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startJimengBridge } from '../../server/jimengBridge.mjs';

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

let jimengView: BrowserView | null = null;

async function openJimengBrowser(data: any) {
  const { prompt, assets, options } = data;
  
  log('打开即梦网页...');
  
  const jimengUrl = 'https://jimeng.jianying.com';
  
  if (jimengView) {
    try {
      jimengView.webContents.loadURL(jimengUrl);
    } catch {
      // 忽略
    }
  } else {
    jimengView = new BrowserView({
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        sandbox: false,
      },
    });
    
    jimengView.webContents.loadURL(jimengUrl);
    
    jimengView.webContents.on('did-finish-load', () => {
      log('即梦网页加载完成');
      
      const dataStr = JSON.stringify(data);
      
      const script = `
        console.log('AI视频制作助手注入');
        
        window.fillJimengForm = function(data) {
          const { prompt, assets, options } = data;
          console.log('自动填充:', { prompt, options });
          
          const promptEditor = document.querySelector('.tiptap.ProseMirror');
          if (promptEditor) {
            promptEditor.focus();
            setTimeout(() => {
              if (window.getSelection && document.createRange) {
                const selection = window.getSelection();
                if (selection) {
                  const range = document.createRange();
                  range.selectNodeContents(promptEditor);
                  selection.removeAllRanges();
                  selection.addRange(range);
                }
              }
              
              document.execCommand('insertText', false, prompt);
              console.log('提示词已插入');
            }, 100);
          }
          
          return '提示词已填充，请手动上传素材和提交';
        };
        
        setTimeout(() => {
          window.fillJimengForm(${dataStr});
        }, 2000);
      `;
      
      jimengView?.webContents.executeJavaScript(script).catch(err => log(`注入脚本失败: ${err}`));
    });
  }
  
  const jimengWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    title: 'AI视频制作 - 即梦',
    show: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
    },
  });
  
  jimengWindow.setBrowserView(jimengView);
  jimengView.setBounds({ x: 0, y: 0, width: 1440, height: 920 });
  jimengWindow.setAutoResize({ width: true, height: true });
  
  jimengWindow.on('closed', () => {
    jimengView = null;
  });
  
  return '打开成功';
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
    
    try {
      log('正在启动 server...');

      let nodeModulesPath: string | undefined;
      if (!is.dev) {
        const unpackedPath = join(process.resourcesPath, 'app.asar.unpacked/node_modules');
        const asarNodeModules = join(__dirname, '../node_modules');
        nodeModulesPath = `${unpackedPath};${asarNodeModules}`;
        log(`nodeModulesPath: ${nodeModulesPath}`);
      }
      
      bridge = await startJimengBridge({ 
        port: 3210, 
        nodeModulesPath 
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
  
  ipcMain.handle('open-jimeng-web', async (_, data) => {
    log('收到打开即梦网页请求');
    try {
      const result = await openJimengBrowser(data);
      return { success: true, message: result };
    } catch (error) {
      log(`打开失败: ${error}`);
      return { success: false, error: String(error) };
    }
  });
});

app.on('window-all-closed', () => {
  bridge?.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
