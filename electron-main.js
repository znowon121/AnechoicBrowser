const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// 載入 .env（若存在），方便未來整合 Flask 等服務
try {
  require('dotenv').config();
} catch (e) {
  // dotenv 可能未安裝；略過但不阻止應用啟動
}

let mainWindow;
let flaskProcess = null; // child process for Flask
let chatWindow = null; // separate BrowserWindow for chatroom
let authWindow = null; // [新增]

// ============================================================================
// History & Bookmarks Storage Helper
// ============================================================================

/**
 * Get the path to the data file (history.json or bookmarks.json)
 */
function getDataFilePath(filename) {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, filename);
}

/**
 * Read JSON data from file, return empty array if file doesn't exist
 */
function readDataFile(filename) {
  const filePath = getDataFilePath(filename);
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`Error reading ${filename}:`, error);
  }
  return [];
}

/**
 * Write JSON data to file
 */
function writeDataFile(filename, data) {
  const filePath = getDataFilePath(filename);
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error(`Error writing ${filename}:`, error);
    return false;
  }
}

// Read FLASK_URL (or FLASK_HOST/FLASK_PORT) from environment (dotenv already loaded earlier)
const FLASK_URL = process.env.FLASK_URL || `http://${process.env.FLASK_HOST || '127.0.0.1'}:${process.env.FLASK_PORT || '5000'}`;

// ============================================================================
// History Feature: Listen to navigation events and save to history.json
// ============================================================================

/**
 * Add entry to history
 * @param {string} title - Page title
 * @param {string} url - Page URL
 */
function addToHistory(title, url) {
  // Skip localhost and file:// protocols
  if (url && (url.startsWith('file://') || url.includes('localhost'))) {
    return;
  }

  const history = readDataFile('history.json');
  
  // Remove duplicate URL if it exists
  const filteredHistory = history.filter(item => item.url !== url);
  
  // Add new entry at the beginning
  const newEntry = {
    title: title || 'Unknown',
    url: url,
    timestamp: new Date().toISOString()
  };
  
  const updatedHistory = [newEntry, ...filteredHistory];
  
  // Keep only the latest 100 items
  const maxItems = 100;
  const limitedHistory = updatedHistory.slice(0, maxItems);
  
  writeDataFile('history.json', limitedHistory);
  console.log(`History updated: ${url}`);
}

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  const iconPath = path.join(__dirname, 'Browser', 'assets', 'icon.png');

  const windowOptions = {
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true  // 啟用 <webview> 標籤
    }
  };

  // 只有當 icon 真正存在時才傳入 icon 屬性，避免找不到檔案造成錯誤
  if (fs.existsSync(iconPath)) {
    windowOptions.icon = iconPath;
  }

  mainWindow = new BrowserWindow(windowOptions);

  // 載入 Browser/index.html
  mainWindow.loadFile(path.join(__dirname, 'Browser', 'index.html'));

  // 開發模式下開啟 DevTools
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

    mainWindow.on('closed', function () {
      mainWindow = null;
    });
}

// IPC: open Chatroom in a separate BrowserWindow (creates window if needed)
ipcMain.handle('chatroom:open-window', async () => {
  try {
    // if already opened, focus and return
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.focus();
      return { ok: true };
    }

    // create new BrowserWindow for chatroom
    chatWindow = new BrowserWindow({
      width: 900,
      height: 700,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    // load FLASK_URL from env
    chatWindow.loadURL(FLASK_URL);

    chatWindow.on('closed', () => {
      chatWindow = null;
    });

    return { ok: true };
  } catch (e) {
    console.error('chatroom:open-window error', e);
    return { ok: false, error: e.message };
  }
});

// ============================================================================
// IPC: Auth (Google Login)
// ============================================================================
ipcMain.on('auth:start-google-login', () => {
  if (authWindow) {
    authWindow.focus();
    return;
  }

  authWindow = new BrowserWindow({
    width: 500,
    height: 600,
    show: false,
    parent: mainWindow,
    modal: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const loginUrl = `${FLASK_URL}/auth/google`;
  authWindow.loadURL(loginUrl);
  
  authWindow.once('ready-to-show', () => authWindow.show());

  // 監聽轉址，攔截 /auth/success
  const handleAuthRedirect = (event, url) => {
    // [DEBUG] 印出目前視窗正在載入的網址
    console.log('Auth Window navigating to:', url);

    if (url.includes('/auth/success')) {
      console.log('✅ Detected success URL!'); // [DEBUG]
      try {
        const urlObj = new URL(url);
        const user = {
          id: urlObj.searchParams.get('uid'), // 確保這裡對應 main.py 的參數
          name: urlObj.searchParams.get('name'),
          avatar: urlObj.searchParams.get('avatar')
        };
        
        console.log('👤 User data extracted:', user); // [DEBUG]

        // 通知主視窗更新 UI
        if (mainWindow && !mainWindow.isDestroyed()) {
          console.log('📡 Sending to mainWindow...'); // [DEBUG]
          mainWindow.webContents.send('auth:login-success', user);
        } else {
            console.error('❌ MainWindow is missing or destroyed!');
        }

        authWindow.destroy();
        authWindow = null;
      } catch (error) {
        console.error('Auth redirect error:', error);
      }
    }
  };

  authWindow.webContents.on('will-redirect', handleAuthRedirect);
  authWindow.webContents.on('did-navigate', handleAuthRedirect);

  authWindow.on('closed', () => {
    authWindow = null;
  });
});

// ============================================================================
// IPC: History Handlers
// ============================================================================

ipcMain.handle('history:get', async () => {
  try {
    const history = readDataFile('history.json');
    return { ok: true, data: history };
  } catch (error) {
    console.error('history:get error', error);
    return { ok: false, error: error.message };
  }
});

// ============================================================================
// IPC: Bookmarks Handlers
// ============================================================================

ipcMain.handle('bookmarks:add', async (event, bookmarkData) => {
  try {
    if (!bookmarkData || !bookmarkData.url) {
      return { ok: false, error: 'URL is required' };
    }

    const bookmarks = readDataFile('bookmarks.json');
    
    // Check if bookmark already exists
    const exists = bookmarks.some(item => item.url === bookmarkData.url);
    if (exists) {
      return { ok: false, error: 'Bookmark already exists' };
    }

    const newBookmark = {
      title: bookmarkData.title || 'Untitled',
      url: bookmarkData.url,
      addedAt: new Date().toISOString()
    };

    const updatedBookmarks = [newBookmark, ...bookmarks];
    writeDataFile('bookmarks.json', updatedBookmarks);

    return { ok: true, data: updatedBookmarks };
  } catch (error) {
    console.error('bookmarks:add error', error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('bookmarks:remove', async (event, url) => {
  try {
    if (!url) {
      return { ok: false, error: 'URL is required' };
    }

    const bookmarks = readDataFile('bookmarks.json');
    const updatedBookmarks = bookmarks.filter(item => item.url !== url);

    writeDataFile('bookmarks.json', updatedBookmarks);

    return { ok: true, data: updatedBookmarks };
  } catch (error) {
    console.error('bookmarks:remove error', error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('bookmarks:get', async () => {
  try {
    const bookmarks = readDataFile('bookmarks.json');
    return { ok: true, data: bookmarks };
  } catch (error) {
    console.error('bookmarks:get error', error);
    return { ok: false, error: error.message };
  }
});

// ============================================================================
// Capture navigation events from all webviews (tabs)
// ============================================================================
app.on('web-contents-created', (event, contents) => {
  // Only listen to webviews (tabs), not the main window itself
  if (contents.getType() === 'webview') {
    // Capture when a user navigates to a new URL
    contents.on('did-navigate', (event, url) => {
      addToHistory(contents.getTitle(), url);
    });

    // Update history again when title is finalized (for better UX)
    contents.on('page-title-updated', (event, title) => {
      addToHistory(title, contents.getURL());
    });
  }
});

// Electron 準備好時建立視窗
app.whenReady().then(() => {
  // Start Flask server automatically when Electron ready
  startFlaskServer();
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 所有視窗關閉時退出應用程式（macOS 除外）
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Ensure Flask child is killed when app is quitting
app.on('before-quit', () => {
  if (flaskProcess) {
    try {
      // attempt graceful kill
      flaskProcess.kill();
    } catch (e) {
      console.error('Error killing Flask process:', e);
    }
    flaskProcess = null;
  }
});

/**
 * Start Flask server as a child process (only once).
 * Uses python main.py in the ./Chatroom directory.
 */
function startFlaskServer() {
  if (flaskProcess) {
    console.log('Flask already running');
    return;
  }

  const chatDir = path.join(__dirname, 'Chatroom');
  const pythonCmd = process.env.PYTHON || 'python';

  try {
    flaskProcess = spawn(pythonCmd, ['main.py'], {
      cwd: chatDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    flaskProcess.stdout.on('data', (data) => {
      console.log(`[flask stdout] ${data.toString()}`);
    });

    flaskProcess.stderr.on('data', (data) => {
      console.error(`[flask stderr] ${data.toString()}`);
    });

    flaskProcess.on('exit', (code, signal) => {
      console.log(`Flask process exited with code ${code} signal ${signal}`);
      flaskProcess = null;
    });

    console.log('Started Flask server as child process');
  } catch (e) {
    console.error('Failed to start Flask server:', e);
    flaskProcess = null;
  }
}
