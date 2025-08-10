// pretty-achievements/electron-app/src/main.js
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

const isDev = process.env.NODE_ENV === 'development' || process.env.ELECTRON_DEV === 'true';

function createMainWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'), // __dirname = .../electron-app/src
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    const indexHtml = path.join(__dirname, 'renderer', 'index.html');
    win.loadFile(indexHtml).catch(err => {
        console.error('Erreur loading index.html:', err);
    });

    if (isDev) win.webContents.openDevTools({ mode: 'right' });

    win.once('ready-to-show', () => win.show());

    // Ouvrir les liens externes dans le navigateur par défaut
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    return win;
}

// Empêcher plusieurs instances
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length) {
            const w = wins[0];
            if (w.isMinimized()) w.restore();
            w.focus();
        }
    });

    app.whenReady().then(() => {
        createMainWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
        });
    });

    app.on('window-all-closed', () => {
        // Sous macOS garder l'app ouverte requiert des comportements différents ; ici on quitte
        if (process.platform !== 'darwin') app.quit();
    });
}

/* Exemples d'IPC (adapter selon ton backend Python)
  - ipcMain.handle('app/get-app-path', () => app.getAppPath());
  - ipcMain.handle('backend/start', async () => { ... })
*/
ipcMain.handle('app/get-app-path', () => app.getAppPath());
