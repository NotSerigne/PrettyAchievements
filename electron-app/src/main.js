// pretty-achievements/electron-app/src/main.js
const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const isDev = process.env.NODE_ENV === 'development' || process.env.ELECTRON_DEV === 'true';

// Start Python Flask backend (python-backend/src/main.py)
let pyProc = null;
function startPythonBackend() {
    if (pyProc && !pyProc.killed) return pyProc;
    try {
        const script = path.resolve(__dirname, '..', '..', 'python-backend', 'src', 'main.py');
        const cwd = path.dirname(script);
        const py = process.platform === 'win32' ? 'python' : 'python3';
        pyProc = spawn(py, [script], {
            cwd,
            windowsHide: true,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        });
        pyProc.stdout.on('data', (d) => console.log('[py]', d.toString().trim()));
        pyProc.stderr.on('data', (d) => console.error('[py-err]', d.toString().trim()));
        pyProc.on('close', (code) => {
            console.log('Python backend exited with code', code);
            pyProc = null;
        });
    } catch (e) {
        console.error('Failed to start Python backend:', e);
    }
    return pyProc;
}

function createMainWindow() {
    console.log('[DEBUG][main.js] createMainWindow cwd:', process.cwd());
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    win.setMenuBarVisibility(false);
    // Correction : utiliser un chemin absolu et normalisé pour index.html
    const indexHtml = path.normalize(path.resolve(__dirname, 'renderer', 'index.html'));
    console.log('[DEBUG][main.js] indexHtml path:', indexHtml, 'exists:', fs.existsSync(indexHtml));
    if (!fs.existsSync(indexHtml)) {
        console.error('[ERREUR] Le fichier index.html est introuvable à', indexHtml);
    }
    win.loadFile(indexHtml).catch(err => {
        console.error('Erreur loading index.html:', err);
    });
    if (isDev) win.webContents.openDevTools({ mode: 'right' });
    win.once('ready-to-show', () => win.show());
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
    return win;
}

// Python game detector integration
function runGameDetector() {
    return new Promise((resolve, reject) => {
        try {
            const pythonSrc = path.resolve(__dirname, '..', '..', 'python-backend', 'src');
            const code = [
                'import sys, json',
                `sys.path.append(r"${pythonSrc.replace(/\\/g, '\\\\')}")`,
                'from game_detector import GameDetector',
                'd = GameDetector()',
                'd.scan_all_locations()',
                'd.get_all_games_names()',
                'print(json.dumps(d.games, ensure_ascii=False))'
            ].join('; ');

            const py = process.platform === 'win32' ? 'python' : 'python3';
            const child = spawn(py, ['-c', code], {
                windowsHide: true,
                env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (d) => { stdout += d.toString(); });
            child.stderr.on('data', (d) => { stderr += d.toString(); });

            child.on('error', (err) => reject(err));

            child.on('close', (code) => {
                if (code !== 0) {
                    return reject(new Error(`Python exited with code ${code}: ${stderr}`));
                }

                const raw = (stdout || '').trim();
                // Try direct parse first
                const tryParses = [];
                tryParses.push(() => JSON.parse(raw));
                // Extract last JSON object between braces
                tryParses.push(() => {
                    const start = raw.lastIndexOf('{');
                    const end = raw.lastIndexOf('}');
                    if (start !== -1 && end !== -1 && end > start) {
                        const candidate = raw.slice(start, end + 1);
                        return JSON.parse(candidate);
                    }
                    throw new Error('No JSON braces found');
                });
                // Parse last line that looks like a JSON object
                tryParses.push(() => {
                    const line = raw.split(/\r?\n/).reverse().find(l => {
                        const t = l.trim();
                        return t.startsWith('{') && t.endsWith('}');
                    });
                    if (line) return JSON.parse(line.trim());
                    throw new Error('No JSON line found');
                });

                for (const fn of tryParses) {
                    try {
                        const parsed = fn();
                        return resolve(parsed && typeof parsed === 'object' ? parsed : {});
                    } catch (_) { /* try next strategy */ }
                }

                console.error('Failed to parse Python output:', stdout);
                resolve({});
            });
        } catch (e) {
            reject(e);
        }
    });
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

    app.whenReady().then(async () => {
        const win = createMainWindow();

        // Démarrer le backend Python (Flask) au démarrage
        startPythonBackend();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
        });
    });

    app.on('window-all-closed', () => {
        // Sous macOS garder l'app ouverte requiert des comportements différents ; ici on quitte
        if (process.platform !== 'darwin') app.quit();
    });

    // Ensure Python backend is terminated when Electron quits
    app.on('quit', () => {
        try { if (pyProc && !pyProc.killed) pyProc.kill(); } catch (_) {}
    });
}

/* Exemples d'IPC (adapter selon ton backend Python)
  - ipcMain.handle('app/get-app-path', () => app.getAppPath());
  - ipcMain.handle('backend/start', async () => { ... })
*/
ipcMain.handle('app/get-app-path', () => app.getAppPath());
ipcMain.handle('games/detect-cracked', async () => {
    try { return await runGameDetector(); } catch (e) { return {}; }
});

// Nouveau système de notification : utilise une fenêtre dédiée
const NOTIF_POSITIONS = {
    'top-left': { x: 32, y: 32 },
    'top-center': 'center-top',
    'top-right': 'top-right',
    'bottom-left': { x: 32, y: 'bottom' },
    'bottom-center': 'center-bottom',
    'bottom-right': 'bottom-right'
};
function getNotificationPosition(pos, winWidth, winHeight, notifWidth, notifHeight) {
    // Calcule la position (x, y) en pixels selon le sélecteur
    switch (pos) {
        case 'top-left':
            return { x: 32, y: 32 };
        case 'top-center':
            return { x: Math.round((winWidth - notifWidth) / 2), y: 32 };
        case 'top-right':
            return { x: winWidth - notifWidth - 32, y: 32 };
        case 'bottom-left':
            return { x: 32, y: winHeight - notifHeight - 32 };
        case 'bottom-center':
            return { x: Math.round((winWidth - notifWidth) / 2), y: winHeight - notifHeight - 32 };
        case 'bottom-right':
        default:
            return { x: winWidth - notifWidth - 32, y: winHeight - notifHeight - 32 };
    }
}
function showCustomNotification({ message, duration = 3000, position }) {
    const { screen } = require('electron');
    const display = screen.getPrimaryDisplay();
    const winWidth = display.workArea.width;
    const winHeight = display.workArea.height;

    // Fenêtre notification prend toute la taille de l'écran
    const notifWin = new BrowserWindow({
        width: winWidth,
        height: winHeight,
        x: 0,
        y: 0,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        focusable: false,
        show: false,
        hasShadow: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        },
        // Ajout pour forcer l'affichage au-dessus de tout, même des apps admin
        alwaysOnTop: true,
        alwaysOnTopLevel: 'screen-saver', // niveau le plus élevé possible
        // Ajout pour Windows : notifications au-dessus des jeux admin
        // (nécessite Electron >= 14)
        // Voir https://www.electronjs.org/docs/latest/api/browser-window/#new-browserwindowoptions
        // et https://github.com/electron/electron/issues/28642
        // On force le type de fenêtre à 'toolbar' pour Windows
        type: process.platform === 'win32' ? 'toolbar' : undefined
    });
    notifWin.setIgnoreMouseEvents(true);
    notifWin.loadFile(path.join(__dirname, 'notifications', 'notification.html'));
    notifWin.once('ready-to-show', () => {
        notifWin.webContents.send('notification/show', { message, position });
        notifWin.showInactive();
    });
    setTimeout(() => {
        if (!notifWin.isDestroyed()) notifWin.close();
    }, duration);
}
ipcMain.on('show-custom-notification', (event, args) => {
    showCustomNotification(args);
});

// Nouveau système de notification : utilise l'API native Electron Notification
function showNativeNotification({ message, duration = 3000 }) {
    new Notification({
        title: 'Pretty Achievements',
        body: message,
        silent: true // pas de son
    }).show();
}

ipcMain.on('show-native-notification', (event, args) => {
    showNativeNotification(args);
});

// Save config to electron-app/src/config.json
ipcMain.handle('config/save', async (_event, configObj) => {
    try {
        // Chemin du fichier config Electron (toujours chiffré)
        const target = path.resolve(__dirname, 'config.json');
        let config = {};
        if (fs.existsSync(target)) {
            config = JSON.parse(fs.readFileSync(target, 'utf-8'));
        }
        // Remplacer tout le contenu par le nouveau (sauf si tu veux merger)
        config = { ...config, ...configObj };
        fs.writeFileSync(target, JSON.stringify(config, null, 2), 'utf-8');
        // Synchroniser la clé Steam API déchiffrée dans le config.json racine
        await syncSteamApiKeyToRootConfig();
        return { ok: true, path: target };
    } catch (err) {
        console.error('Failed to save electron config.json:', err);
        return { ok: false, error: String(err) };
    }
});

// Load config from electron-app/src/config.json
ipcMain.handle('config/load', async () => {
    try {
        const target = path.resolve(__dirname, 'config.json');
        if (!fs.existsSync(target)) return {};
        const raw = fs.readFileSync(target, 'utf-8');
        const parsed = JSON.parse(raw || '{}');
        return parsed;
    } catch (err) {
        console.error('Failed to load electron config.json:', err);
        return {};
    }
});

// Synchronise la clé Steam API déchiffrée dans le config.json racine
async function syncSteamApiKeyToRootConfig() {
    try {
        const electronConfigPath = path.resolve(__dirname, 'config.json');
        const rootConfigPath = path.resolve(__dirname, '..', '..', 'config.json');
        if (!fs.existsSync(electronConfigPath)) return;
        const electronConfig = JSON.parse(fs.readFileSync(electronConfigPath, 'utf-8'));
        const encrypted = electronConfig?.general?.steamApiKey;
        if (!encrypted) return;
        let apiKey = '';
        try {
            const key = 'prettyachievements2024';
            let decoded = '';
            if (typeof Buffer !== 'undefined') {
                decoded = Buffer.from(encrypted, 'base64').toString('utf-8');
            } else {
                decoded = atob(encrypted);
            }
            if (decoded.endsWith(':' + key)) {
                apiKey = decoded.slice(0, -key.length - 1);
            }
        } catch (_) {}
        if (!apiKey) return;
        let rootConfig = {};
        if (fs.existsSync(rootConfigPath)) {
            rootConfig = JSON.parse(fs.readFileSync(rootConfigPath, 'utf-8'));
        }
        if (!rootConfig.steam_api) rootConfig.steam_api = {};
        rootConfig.steam_api.api_key = apiKey;
        fs.writeFileSync(rootConfigPath, JSON.stringify(rootConfig, null, 2), 'utf-8');
    } catch (err) {
        console.error('Erreur synchro steamApiKey vers config racine:', err);
    }
}

// Handler manuel si besoin (optionnel)
ipcMain.handle('config/syncSteamApiKeyFromElectronConfig', async () => {
    try {
        await syncSteamApiKeyToRootConfig();
        return { ok: true };
    } catch (err) {
        return { ok: false, error: String(err) };
    }
});
