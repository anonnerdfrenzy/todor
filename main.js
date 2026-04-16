const { app, BrowserWindow, nativeImage, ipcMain, Tray, Menu, dialog, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Data files live in the per-user application-support directory so the app
// is distributable and survives updates.
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
    } else {
      showMainWindow();
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
        // Keep the Pomodoro setInterval ticking accurately even when the
        // window isn't focused or is fully hidden behind other apps.
        backgroundThrottling: false,
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

  function showMainWindow() {
    if (!mainWin || mainWin.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
  }

  function getCliPath() {
    // Packaged: extraResources places cli.py at process.resourcesPath.
    // Dev: it's in the repo root next to main.js.
    const candidates = [
      path.join(process.resourcesPath || '', 'cli.py'),
      path.join(__dirname, 'cli.py'),
    ];
    return candidates.find(p => p && fs.existsSync(p));
  }

  // ===== Update check =====
  // We can't do silent auto-updates without code signing, so on launch (and at
  // most once every 6 hours), poll GitHub Releases. If a newer version exists,
  // show a dialog with a button that opens the release page in the browser.
  const RELEASES_API = 'https://api.github.com/repos/anonnerdfrenzy/todor/releases/latest';
  const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

  function semverGreater(a, b) {
    const pa = a.split('.').map((n) => parseInt(n, 10));
    const pb = b.split('.').map((n) => parseInt(n, 10));
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) > (pb[i] || 0)) return true;
      if ((pa[i] || 0) < (pb[i] || 0)) return false;
    }
    return false;
  }

  async function checkForUpdates({ silent = true } = {}) {
    if (!DATA_DIR) return;
    const stampPath = path.join(DATA_DIR, 'update-check.json');
    if (silent) {
      try {
        const last = JSON.parse(fs.readFileSync(stampPath, 'utf-8')).t || 0;
        if (Date.now() - last < UPDATE_CHECK_INTERVAL_MS) return;
      } catch {}
    }
    try {
      const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) return;
      const data = await res.json();
      try { fs.writeFileSync(stampPath, JSON.stringify({ t: Date.now() })); } catch {}
      const latest = (data.tag_name || '').replace(/^v/, '');
      const current = app.getVersion();
      if (!latest) return;
      if (!semverGreater(latest, current)) {
        if (!silent) {
          dialog.showMessageBox({
            type: 'info',
            title: 'Todor',
            message: 'You\u2019re on the latest version (' + current + ').',
          });
        }
        return;
      }
      const choice = await dialog.showMessageBox({
        type: 'info',
        title: 'Update available',
        message: 'Todor ' + latest + ' is available.',
        detail: 'You\u2019re on ' + current + '. Open the release page to download the new .dmg.',
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (choice.response === 0) {
        shell.openExternal(data.html_url || ('https://github.com/anonnerdfrenzy/todor/releases/tag/v' + latest));
      }
    } catch {}
  }

  function showClaudeSetup() {
    const cliPath = getCliPath();
    if (!cliPath) {
      dialog.showErrorBox('Todor', 'Could not locate cli.py. Reinstall Todor.');
      return;
    }
    const prompt = `Please add a "Todor" section to my user-level Claude memory file at \`~/.claude/CLAUDE.md\` so you know how to read and modify my todos. Create the file if it doesn't exist; if a Todor section is already there, replace just that section without touching anything else. Use this exact content:

## Todor (Todo App)

A macOS todo + pomodoro app. Data lives at \`~/Library/Application Support/Todor/\`. The bundled CLI lets you read and modify todos directly.

### CLI commands:
\`\`\`bash
python3 "${cliPath}" list                              # List all todos
python3 "${cliPath}" add "Task name"                   # Add top-level todo (appended to END)
python3 "${cliPath}" add "Subtask" --parent=0          # Add sub-todo (dot-path parent)
python3 "${cliPath}" add "X" --due=2026-04-22          # Add with due date
python3 "${cliPath}" complete 0                        # Complete todo + children
python3 "${cliPath}" note 0 "Some notes"               # Set notes
python3 "${cliPath}" edit 0 New text                   # Rename
python3 "${cliPath}" today 0                           # Toggle Today flag
python3 "${cliPath}" due 0 2026-04-22                  # Set due date
python3 "${cliPath}" remove 0                          # Remove (DESTRUCTIVE)
\`\`\`

### How to use it:
- "Add a todo for X" \u2192 \`python3 "${cliPath}" add "X"\`
- "What are my todos" \u2192 \`python3 "${cliPath}" list\`
- New top-level todos go to the END \u2014 verify index with \`list\` before \`remove\`
- Sub-todos use dot-path indexing: \`0.1\` is the second child of the first todo
- The GUI auto-refreshes when the CLI modifies data
`;
    clipboard.writeText(prompt);
    dialog.showMessageBox({
      type: 'info',
      title: 'Setup Claude Code for Todor',
      message: 'Prompt copied to clipboard.',
      detail: 'Open Claude Code and paste it. Claude Code will add a Todor section to your ~/.claude/CLAUDE.md so it knows how to read and add todos for you in future conversations.',
      buttons: ['OK'],
      defaultId: 0,
    });
  }

  function createTray() {
    // Empty image so only the title text appears in the menu bar.
    const img = nativeImage.createEmpty();
    tray = new Tray(img);
    tray.setToolTip('Todor');
    tray.setIgnoreDoubleClickEvents(true);
    const ctxMenu = Menu.buildFromTemplate([
      { label: 'Open Todor', click: showMainWindow },
      { label: 'Setup Claude Code\u2026', click: showClaudeSetup },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.quit(); } },
    ]);
    tray.setContextMenu(ctxMenu);
    tray.on('click', showMainWindow);
    tray.setTitle('Todor');
  }

  function buildAppMenu() {
    const template = [
      {
        label: 'Todor',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
      {
        role: 'help',
        submenu: [
          {
            label: 'See All Commands',
            accelerator: 'CmdOrCtrl+K',
            click: () => {
              if (mainWin && !mainWin.isDestroyed()) {
                showMainWindow();
                mainWin.webContents.send('open-palette');
              }
            },
          },
          { type: 'separator' },
          { label: 'Setup Claude Code\u2026', click: showClaudeSetup },
          { label: 'Check for Updates\u2026', click: () => checkForUpdates({ silent: false }) },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  // Renderer asks for the data directory at startup
  ipcMain.on('get-data-dir', (e) => { e.returnValue = DATA_DIR; });

  // Renderer pushes the menu-bar title whenever it changes
  ipcMain.on('tray-title', (e, text) => {
    if (tray && !tray.isDestroyed()) tray.setTitle(text || '');
  });

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
    DATA_DIR = path.join(app.getPath('appData'), 'Todor');
    DATA_FILE = path.join(DATA_DIR, 'todos.json');
    COMPLETED_FILE = path.join(DATA_DIR, 'completed.json');
    ensureDataFile();
    if (process.platform === 'darwin') {
      const icon = nativeImage.createFromPath(path.join(__dirname, 'icon_1024.png'));
      app.dock.setIcon(icon);
    }
    buildAppMenu();
    createTray();
    createWindow();
    // Run a silent update check 5s after launch — won't show anything unless
    // a newer release exists and we haven't checked in the last 6 hours.
    setTimeout(() => { checkForUpdates({ silent: true }); }, 5000);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showMainWindow();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      if (DATA_FILE) fs.unwatchFile(DATA_FILE);
      if (COMPLETED_FILE) fs.unwatchFile(COMPLETED_FILE);
      app.quit();
    }
  });

  app.on('before-quit', () => {
    if (DATA_FILE) fs.unwatchFile(DATA_FILE);
    if (COMPLETED_FILE) fs.unwatchFile(COMPLETED_FILE);
  });
}
