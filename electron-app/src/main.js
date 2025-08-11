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
function showOverlayNotification({ title = 'Notification', message = '', type = 'info', duration = 4000, position = 'bottom-right', achievementName = '', achievementDescription = '', communityPercent = null } = {}) {
    try {
        // Afficher sur l'écran principal (primary)
        const display = screen.getPrimaryDisplay();
        const work = display.workArea; // { x, y, width, height }
        const displayId = display.id ?? `${work.x}:${work.y}:${work.width}:${work.height}`;
        const width = 420;
        const height = 110;
        const margin = 16;
        const stackCount = __paToasts.filter(t => t && t.displayId === displayId && t.position === position).length;
        const totalOffset = stackCount * (height + 10);
        let targetX = work.x + work.width - width - margin; // default right
        let targetY = work.y + work.height - height - margin - totalOffset; // default bottom
        const [vert, horiz] = (() => {
            const p = String(position || '').toLowerCase();
            if (p.includes('top')) return ['top', p.includes('left') ? 'left' : p.includes('center') ? 'center' : 'right'];
            return ['bottom', p.includes('left') ? 'left' : p.includes('center') ? 'center' : 'right'];
        })();
        if (horiz === 'left') targetX = work.x + margin;
        if (horiz === 'center') targetX = Math.round(work.x + (work.width - width) / 2);
        if (vert === 'top') targetY = work.y + margin + totalOffset;

        // Determine entrance direction for CSS animation inside the window
        const enterDir = (horiz === 'left') ? 'left' : (horiz === 'right') ? 'right' : (vert === 'top' ? 'top' : 'bottom');

        const win = new BrowserWindow({
            width,
            height,
            x: targetX,
            y: targetY,
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
                sandbox: true,
                backgroundThrottling: false
            }
        });
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        try { win.setAlwaysOnTop(true, 'screen-saver'); } catch (_) { win.setAlwaysOnTop(true); }

        const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const border = type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#4a78c2';
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;">
        <style>
        html,body{margin:0;padding:0;background:transparent;font-family:Segoe UI,Tahoma,sans-serif}
        .outer{width:100%;height:100%;display:flex;align-items:center;justify-content:center}
        .track{display:flex;align-items:center;gap:10px}
        .core{width:84px;height:84px;border-radius:12px;background:rgba(20,20,20,0.9);border:1px solid ${border};box-shadow:0 10px 24px rgba(0,0,0,0.35);transition:transform .28s ease;will-change:transform}
        .detail{height:84px;width:0;overflow:hidden;border-radius:10px;border:1px solid #4a78c2;background:linear-gradient(135deg,#3a4a6a,#679CDF);display:flex;align-items:center;gap:12px;padding:12px 14px;box-shadow:0 10px 24px rgba(0,0,0,0.35);color:#fff;transition:width .34s cubic-bezier(.22,1,.36,1);will-change:width}
        .text{flex:1 1 auto;min-width:0}
        .title{font-weight:800;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px}
        .msg{opacity:.95;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .pct{margin-left:12px;font-weight:800;font-size:18px;white-space:nowrap}
        /* Stage 2 reveal */
        .reveal .core{transform:translateX(-10px)}
        .reveal .detail{width:280px}
        /* Directional entrance for the whole layout */
        @keyframes enter-left{from{opacity:0;transform:translateX(-120%)}to{opacity:1;transform:translateX(0)}}
        @keyframes enter-right{from{opacity:0;transform:translateX(120%)} to{opacity:1;transform:translateX(0)}}
        @keyframes enter-top{from{opacity:0;transform:translateY(-120%)} to{opacity:1;transform:translateY(0)}}
        @keyframes enter-bottom{from{opacity:0;transform:translateY(120%)} to{opacity:1;transform:translateY(0)}}
        .enter-left .outer{animation:enter-left .3s cubic-bezier(.22,1,.36,1)}
        .enter-right .outer{animation:enter-right .3s cubic-bezier(.22,1,.36,1)}
        .enter-top .outer{animation:enter-top .3s cubic-bezier(.22,1,.36,1)}
        .enter-bottom .outer{animation:enter-bottom .3s cubic-bezier(.22,1,.36,1)}
        .leave .outer{opacity:0;transform:translateY(6px);transition:all .18s ease-in}
        </style></head><body class="enter-${enterDir}">
        <div class="outer">
          <div class="track">
            <div class="core"></div>
            <div class="detail">
              <div class="text">
                <div class="title">${esc(achievementName || title)}</div>
                <div class="msg">${esc(achievementDescription || message)}</div>
              </div>
              <div class="pct">${communityPercent != null ? esc(String(communityPercent)) + '%' : ''}</div>
            </div>
          </div>
        </div>
        <script>(function(){
          try{
            setTimeout(function(){ document.body.classList.add('reveal'); }, 140);
            var ttl=${Math.max(0, Number(duration)||0)};
            if(ttl>0) setTimeout(function(){
              try{ document.body.classList.add('leave'); setTimeout(function(){ window.close() }, 180); }catch(e){ window.close(); }
            }, ttl);
          }catch(e){}
        })();</script>
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