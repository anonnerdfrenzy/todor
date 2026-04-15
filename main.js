const { app, BrowserWindow, nativeImage, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// Data files live in the per-user application-support directory so the app
// is distributable and survives updates.
// Computed inside app.whenReady (DATA_DIR depends on app being ready).
let DATA_DIR = null;
let DATA_FILE = null;
let COMPLETED_FILE = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {

  let mainWin = null;
  let notesWin = null;
  let tray = null;

  app.on('second-instance', () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });

  function ensureDataFile() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, '[]');
    }
    if (!fs.existsSync(COMPLETED_FILE)) {
      fs.writeFileSync(COMPLETED_FILE, '[]');
    }
  }

  function createWindow() {
    mainWin = new BrowserWindow({
      width: 700,
      height: 800,
      title: 'Todor',
      titleBarStyle: 'hiddenInset',
      icon: path.join(__dirname, 'icon.icns'),
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    mainWin.loadFile('index.html');

    mainWin.on('closed', () => { mainWin = null; });

    fs.watchFile(DATA_FILE, { interval: 1000 }, () => {
      if (mainWin) mainWin.webContents.send('todos-changed');
    });
    fs.watchFile(COMPLETED_FILE, { interval: 1000 }, () => {
      if (mainWin) mainWin.webContents.send('todos-changed');
    });
  }

  function createTray() {
    const iconPath = path.join(__dirname, 'tray_iconTemplate.png');
    const img = nativeImage.createFromPath(iconPath);
    img.setTemplateImage(true);
    tray = new Tray(img);
    tray.setToolTip('Todor');
    const ctxMenu = Menu.buildFromTemplate([
      { label: 'Open Todor', click: showMainWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
    ]);
    tray.setContextMenu(ctxMenu);
    tray.on('click', showMainWindow);
  }

  function showMainWindow() {
    if (!mainWin || mainWin.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
  }

  // Renderer asks for the data directory at startup
  ipcMain.on('get-data-dir', (e) => { e.returnValue = DATA_DIR; });

  // Renderer pushes the menu-bar title whenever it changes
  ipcMain.on('tray-title', (e, text) => {
    if (tray && !tray.isDestroyed()) tray.setTitle(text || '');
  });

  // Open notes editor window
  ipcMain.on('open-notes', (event, { todoId, todoText, notes }) => {
    if (notesWin && !notesWin.isDestroyed()) {
      notesWin.close();
    }

    notesWin = new BrowserWindow({
      width: 500,
      height: 400,
      title: 'Notes: ' + todoText,
      titleBarStyle: 'hiddenInset',
      parent: mainWin,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    notesWin.loadFile('notes.html');

    notesWin.webContents.once('did-finish-load', () => {
      notesWin.webContents.send('load-notes', { todoId, todoText, notes });
    });

    notesWin.on('closed', () => {
      notesWin = null;
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.focus();
      }
    });
  });

  ipcMain.on('save-notes', (event, { todoId, notes }) => {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('notes-saved', { todoId, notes });
    }
  });

  app.whenReady().then(() => {
    app.setName('Todor');
    // On some Electron versions setName alone doesn't repath userData;
    // force it to the "Todor" folder for consistency across dev + packaged.
    DATA_DIR = path.join(app.getPath('appData'), 'Todor');
    DATA_FILE = path.join(DATA_DIR, 'todos.json');
    COMPLETED_FILE = path.join(DATA_DIR, 'completed.json');
    ensureDataFile();
    if (process.platform === 'darwin') {
      const icon = nativeImage.createFromPath(path.join(__dirname, 'icon_1024.png'));
      app.dock.setIcon(icon);
    }
    createTray();
    createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showMainWindow();
    }
  });

  // Don't quit on window close — keep the tray alive.
  app.on('window-all-closed', (e) => {
    if (process.platform !== 'darwin') {
      fs.unwatchFile(DATA_FILE);
      fs.unwatchFile(COMPLETED_FILE);
      app.quit();
    }
  });

  app.on('before-quit', () => {
    if (DATA_FILE) fs.unwatchFile(DATA_FILE);
    if (COMPLETED_FILE) fs.unwatchFile(COMPLETED_FILE);
  });
}
