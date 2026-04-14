const { app, BrowserWindow, nativeImage, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const DATA_FILE = path.join(__dirname, 'todos.json');
const COMPLETED_FILE = path.join(__dirname, 'completed.json');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {

  let mainWin = null;
  let notesWin = null;

  app.on('second-instance', () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });

  function ensureDataFile() {
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

  // Open notes editor window
  ipcMain.on('open-notes', (event, { todoId, todoText, notes }) => {
    // If a notes window is already open, close it first
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

  // Save notes back from editor
  ipcMain.on('save-notes', (event, { todoId, notes }) => {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('notes-saved', { todoId, notes });
    }
  });

  app.whenReady().then(() => {
    ensureDataFile();
    if (process.platform === 'darwin') {
      const icon = nativeImage.createFromPath(path.join(__dirname, 'icon_1024.png'));
      app.dock.setIcon(icon);
    }
    app.setName('Todor');
    createWindow();
  });

  app.on('window-all-closed', () => {
    fs.unwatchFile(DATA_FILE);
    fs.unwatchFile(COMPLETED_FILE);
    app.quit();
  });
}
