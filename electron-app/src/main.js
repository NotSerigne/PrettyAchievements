// pretty-achievements/electron-app/src/main.js
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

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

    app.whenReady().then(() => {
        const win = createMainWindow();

        // Exécuter le détecteur au démarrage et envoyer le résultat au renderer
        runGameDetector()
            .then((data) => {
                try { win.webContents.send('games/detected', data); } catch (_) {}
            })
            .catch((err) => {
                console.error('Erreur detection jeux:', err);
                try { win.webContents.send('games/detected', {}); } catch (_) {}
            });

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
ipcMain.handle('games/detect-cracked', async () => {
    try { return await runGameDetector(); } catch (e) { return {}; }
});
