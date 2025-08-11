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
    win.setMenuBarVisibility(false);
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

// ===== Custom overlay notification (outside app window) =====
let __paToasts = [];
function showOverlayNotification({ title = 'Notification', message = '', type = 'info', duration = 4000, position = 'bottom-right' } = {}) {
    try {
        // Positionner sur l'écran où se trouve le curseur pour garantir la visibilité
        const point = screen.getCursorScreenPoint();
        const display = screen.getDisplayNearestPoint(point);
        const work = display.workArea; // { x, y, width, height }
        const displayId = display.id ?? `${work.x}:${work.y}:${work.width}:${work.height}`;
        const width = 360;
        const height = 100;
        const margin = 16;
        const stackCount = __paToasts.filter(t => t && t.displayId === displayId && t.position === position).length;
        const totalOffset = stackCount * (height + 10);
        let x = work.x + work.width - width - margin; // default right
        let y = work.y + work.height - height - margin - totalOffset; // default bottom
        const [vert, horiz] = (() => {
            const p = String(position || '').toLowerCase();
            if (p.includes('top')) return ['top', p.includes('left') ? 'left' : p.includes('center') ? 'center' : 'right'];
            return ['bottom', p.includes('left') ? 'left' : p.includes('center') ? 'center' : 'right'];
        })();
        if (horiz === 'left') x = work.x + margin;
        if (horiz === 'center') x = Math.round(work.x + (work.width - width) / 2);
        if (vert === 'top') y = work.y + margin + totalOffset;

        const win = new BrowserWindow({
            width,
            height,
            x,
            y,
            frame: false,
            transparent: true,
            resizable: false,
            movable: false,
            focusable: false,
            show: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            hasShadow: false,
            backgroundColor: '#00000000',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true
            }
        });
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        try { win.setAlwaysOnTop(true, 'screen-saver'); } catch (_) { win.setAlwaysOnTop(true); }

        const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const border = type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#4a78c2';
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;">
        <style>
        html,body{margin:0;padding:0;background:transparent;}
        .toast{display:flex;gap:10px;align-items:center;box-sizing:border-box;width:100%;height:100%;padding:12px 14px;border-radius:10px;background:rgba(20,20,20,0.9);border:1px solid ${border};color:#fff;font-family:Segoe UI,Tahoma,sans-serif;box-shadow:0 10px 24px rgba(0,0,0,0.35);}
        .content{flex:1 1 auto;}
        .title{font-weight:700;margin-bottom:2px}
        .msg{opacity:.85;font-size:14px}
        .close{background:transparent;border:0;color:#ccc;cursor:pointer;font-size:14px}
        .enter{animation:enter .2s ease-out}
        @keyframes enter{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        </style></head><body>
        <div class="toast enter">
            <div class="content">
                <div class="title">${esc(title)}</div>
                <div class="msg">${esc(message)}</div>
            </div>
            <button class="close" onclick="window.close()" aria-label="Fermer">✖</button>
        </div>
        <script>setTimeout(()=>window.close(), ${Math.max(0, Number(duration)||0)});</script>
        </body></html>`;
        win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() =>{});
        win.once('ready-to-show', () => {
            try { win.showInactive?.(); } catch (_) { win.show(); }
        });
        win.on('closed', () => {
            __paToasts = __paToasts.filter(t => t.win !== win);
        });
        __paToasts.push({ win, displayId, position });
        return true;
    } catch (e) {
        console.error('Failed to show overlay notification:', e);
        return false;
    }
}

ipcMain.handle('notify/custom', async (_event, payload) => {
    try { return { ok: showOverlayNotification(payload) }; } catch (e) { return { ok: false, error: String(e) }; }
});
ipcMain.handle('notify:custom', async (_event, payload) => {
    try { return { ok: showOverlayNotification(payload) }; } catch (e) { return { ok: false, error: String(e) }; }
});

// Save config to project root config.json
ipcMain.handle('config/save', async (_event, configObj) => {
    try {
        const target = path.resolve(__dirname, 'config.json');
        const data = JSON.stringify(configObj || {}, null, 2);
        fs.writeFileSync(target, data, 'utf-8');
        return { ok: true, path: target };
    } catch (err) {
        console.error('Failed to save config.json:', err);
        return { ok: false, error: String(err) };
    }
});

// Load config from project root config.json
ipcMain.handle('config/load', async () => {
    try {
        const target = path.resolve(__dirname, 'config.json');
        if (!fs.existsSync(target)) return {};
        const raw = fs.readFileSync(target, 'utf-8');
        const parsed = JSON.parse(raw || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
        console.error('Failed to load config.json:', err);
        return {};
    }
});
