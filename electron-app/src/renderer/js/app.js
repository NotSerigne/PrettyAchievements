class PrettyAchievementsUI {
    constructor() {
        this.sidebarOpen = false; // ✅ Track sidebar state
        this.isScanning = false;
        this.scanSeq = 0;
        this.rescanRequested = false;

        this.initializeElements();
        this.initializeDemoData();
        this.bindEvents(); // ✅ Doit inclure les events burger
        this.bindSteamEvents();
        this.loadDashboard();
        this.ensureAchievementCountStyles();
        this.scanOnStartup();

        // Écoute des jeux détectés depuis le main process
        if (window.electronAPI?.on) {
            window.electronAPI.on('games/detected', (data) => {
                try {
                    this.detectedCrackedGames = data || {};
                    this.renderDetectedCrackedGames();
                    this.renderSidebarGames();
                } catch (e) { console.warn('render cracked games failed:', e); }
            });
        }

        // Fallback: tenter une détection à la demande si rien reçu
        setTimeout(async () => {
            if (!this.detectedCrackedGames && window.electronAPI?.invoke) {
                try {
                    const data = await window.electronAPI.invoke('games/detect-cracked');
                    this.detectedCrackedGames = data || {};
                    this.renderDetectedCrackedGames();
                    this.renderSidebarGames();
                } catch (e) { /* ignore */ }
            }
        }, 3000);
    }

    initializeElements() {
        // ✅ Éléments burger
        this.burgerMenu = document.getElementById('burgerMenu');
        this.sidebar = document.getElementById('sidebar');
        this.closeBtn = document.getElementById('closeBtn');
        this.overlay = document.getElementById('overlay');
        this.mainContent = document.getElementById('mainContent');

        // Autres éléments
        this.searchBar = document.getElementById('searchBar');
        this.menuItems = document.querySelectorAll('.menu-item');
        this.contentSections = document.querySelectorAll('.content-section');

        // Eléments section jeux
        this.gamesLoadingEl = document.getElementById('gamesLoading');
        // Élément liste jeux sidebar
        this.sidebarListEl = document.querySelector('.scrollable-content');

        // ✅ Vérification des éléments critiques
        if (!this.burgerMenu) console.error('❌ burgerMenu not found');
        if (!this.sidebar) console.error('❌ sidebar not found');
        if (!this.overlay) console.error('❌ overlay not found');
    }

    bindEvents() {
        // ✅ EVENTS BURGER (prioritaires)
        if (this.burgerMenu) {
            this.burgerMenu.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('🍔 Burger clicked!');
                this.toggleSidebar();
            });
        }

        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.closeSidebar();
            });
        }

        if (this.overlay) {
            this.overlay.addEventListener('click', () => {
                this.closeSidebar();
            });
        }

        // Fermer avec Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.sidebarOpen) {
                this.closeSidebar();
            }
        });

        // ✅ EVENTS NAVIGATION
        this.menuItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const section = item.dataset.section;
                if (section) {
                    this.showSection(section);
                    this.closeSidebar(); // Fermer après navigation mobile
                }
            });
        });

        // ✅ EVENTS RECHERCHE
        if (this.searchBar) {
            this.searchBar.addEventListener('input', (e) => {
                this.handleSearch(e.target.value);
            });
        }

        // ✅ EVENTS SETTINGS
        this.bindSettingsEvents();
    }

    // ✅ GESTION SIDEBAR
    toggleSidebar() {
        console.log('🔄 Toggle sidebar - current state:', this.sidebarOpen);

        if (this.sidebarOpen) {
            this.closeSidebar();
        } else {
            this.openSidebar();
        }
    }

    openSidebar() {
        console.log('📂 Opening sidebar');
        this.sidebarOpen = true;

        // Classes CSS
        this.sidebar?.classList.add('open');
        this.overlay?.classList.add('active');
        this.burgerMenu?.classList.add('active');
        this.mainContent?.classList.add('sidebar-open');

        // Bloquer le scroll du body
        document.body.style.overflow = 'hidden';
    }

    closeSidebar() {
        console.log('📁 Closing sidebar');
        this.sidebarOpen = false;

        // Classes CSS
        this.sidebar?.classList.remove('open');
        this.overlay?.classList.remove('active');
        this.burgerMenu?.classList.remove('active');
        this.mainContent?.classList.remove('sidebar-open');

        // Restaurer le scroll
        document.body.style.overflow = '';
    }

    // ✅ NAVIGATION SECTIONS
    showSection(sectionId) {
        console.log('📄 Showing section:', sectionId);

        // Masquer toutes les sections
        this.contentSections.forEach(section => {
            section.classList.remove('active');
        });

        // Désactiver tous les menus items
        this.menuItems.forEach(item => {
            item.classList.remove('active');
        });

        // Activer la section demandée
        const targetSection = document.getElementById(sectionId);
        const targetMenuItem = document.querySelector(`[data-section="${sectionId}"]`);

        if (targetSection) {
            targetSection.classList.add('active');
        }

        if (targetMenuItem) {
            targetMenuItem.classList.add('active');
        }

        // Charger le contenu selon la section
        switch(sectionId) {
            case 'games':
                if (this.skipNextGamesScan) {
                    this.skipNextGamesScan = false;
                    this.loadGames();
                } else {
                    this.scanAndLoadGames();
                }
                break;
            case 'achievements':
                this.loadAchievements();
                break;
            case 'statistics':
                this.loadStatistics();
                break;
            case 'dashboard':
                this.loadDashboard();
                break;
        }
    }

    // ✅ RECHERCHE
    handleSearch(query) {
        console.log('🔍 Search:', query);

        if (!query.trim()) {
            this.loadGames().then(() =>{} );
            return;
        }

        // Filtrer uniquement sur les jeux détectés
        const detectedGames = this.getDetectedGames();
        const filteredGames = detectedGames.filter(game =>
            (game.name || '').toLowerCase().includes(query.toLowerCase())
        );

        this.displayFilteredGames(filteredGames);
    }

    displayFilteredGames(games) {
        const gamesGrid = document.getElementById('gamesGrid');
        if (!gamesGrid) return;

        gamesGrid.innerHTML = '';

        if (games.length === 0) {
            gamesGrid.innerHTML = `
                <div class="no-results">
                    <h3>🔍 Aucun jeu trouvé</h3>
                    <p>Essayez un autre terme de recherche</p>
                </div>
            `;
            return;
        }

        games.forEach(game => {
            const achievements = Number(game.achievements || 0);
            const unlocked = Number(game.unlocked || 0);
            const progress = achievements > 0 ? Math.round((unlocked / achievements) * 100) : 0;
            const gameCard = document.createElement('div');
            gameCard.className = 'game-card';
            gameCard.innerHTML = this.createGameCardHTML(game, progress, null);
            gamesGrid.appendChild(gameCard);
        });
    }

    renderDetectedCrackedGames() {
        // Rafraîchir la grille des jeux si la section est visible
        const gamesSection = document.getElementById('games');
        this.renderSidebarGames();
        if (!gamesSection) return;
        const isActive = gamesSection.classList.contains('active');
        if (isActive) {
            this.loadGames();
        }
    }

    // ===== VOS MÉTHODES EXISTANTES (inchangées) =====
    bindSteamEvents() { /* ... votre code Steam ... */ }
    async scanAndLoadGames() {
        if (this.isScanning) {
            this.rescanRequested = true;
            return;
        }
        this.isScanning = true;
        const localScanId = ++this.scanSeq;

        const gamesGrid = document.getElementById('gamesGrid');
        if (gamesGrid) gamesGrid.innerHTML = '';
        this.showGamesLoading();
        try {
            let data = null;
            if (window.electronAPI?.invoke) {
                data = await window.electronAPI.invoke('games/detect-cracked').catch(() => null);
                let count = data && typeof data === 'object' ? Object.keys(data).length : 0;
                if (count === 0) {
                    await this.sleep(800);
                    const retry = await window.electronAPI.invoke('games/detect-cracked').catch(() => null);
                    if (retry) data = retry;
                }
            }

            if (localScanId !== this.scanSeq) {
                // Un autre scan a été lancé entre-temps, ignorer ce résultat
                return;
            }

            this.detectedCrackedGames = data || {};
            await this.loadGames();
            this.renderSidebarGames();
        } catch (e) {
            console.warn('games detection failed:', e);
        } finally {
            this.hideGamesLoading(true);
            this.isScanning = false;
            if (this.rescanRequested) {
                this.rescanRequested = false;
                // Relance immédiatement un nouveau scan demandé pendant l'exécution
                this.scanAndLoadGames();
            }
        }
    }
    showGamesLoading() {
        let el = this.gamesLoadingEl || document.getElementById('gamesLoading');
        if (!el) {
            const gamesSection = document.getElementById('games');
            if (gamesSection) {
                el = document.createElement('div');
                el.id = 'gamesLoading';
                el.className = 'games-loading';
                this.gamesLoadingEl = el;
            }
        }
        if (el) {
            // Positionner explicitement le loader juste après le H1 de la section Jeux
            const gamesSection = document.getElementById('games');
            if (gamesSection) {
                const h1 = gamesSection.querySelector('h1');
                if (h1) {
                    if (el.parentNode !== gamesSection || el.previousElementSibling !== h1) {
                        gamesSection.insertBefore(el, h1.nextSibling);
                    }
                } else if (!el.parentNode) {
                    gamesSection.insertBefore(el, gamesSection.firstChild);
                }
            }
            el.style.display = 'flex';
            el.style.alignItems = 'center';
            el.style.justifyContent = 'center';
            el.style.flexDirection = 'column';
            el.style.padding = '10px 0';
            el.style.rowGap = '6px';
            el.innerHTML = `
                <div class="loading-spinner">⚡</div>
                <p>Scan des jeux...</p>
                <div id="gamesProgressBar" style="width:80%;max-width:420px;height:8px;border-radius:4px;background:#1b1b1b;border:1px solid #333;overflow:hidden;margin-top:6px;">
                  <div id="gamesProgressBarInner" style="height:100%;width:0%;background:linear-gradient(90deg, #679CDF, #5489CC);transition:width 0.3s ease;"></div>
                </div>
            `;
        }
        // Loader synchronisé dans la sidebar
        this.showSidebarLoading();

        if (this._progressTimer) clearInterval(this._progressTimer);
        let progress = 0;
        this._progressTimer = setInterval(() => {
            progress += Math.random() * 10 + 5;
            if (progress > 90) progress = 90;
            const barMain = document.getElementById('gamesProgressBarInner');
            if (barMain) barMain.style.width = progress + '%';
            const barSide = document.getElementById('sidebarProgressBarInner');
            if (barSide) barSide.style.width = progress + '%';
        }, 300);
    }
    hideGamesLoading(done = false) {
        const el = this.gamesLoadingEl || document.getElementById('gamesLoading');
        if (this._progressTimer) {
            clearInterval(this._progressTimer);
            this._progressTimer = null;
        }
        const barMain = document.getElementById('gamesProgressBarInner');
        if (barMain && done) barMain.style.width = '100%';
        const barSide = document.getElementById('sidebarProgressBarInner');
        if (barSide && done) barSide.style.width = '100%';
        setTimeout(() => {
            if (el) {
                el.style.display = 'none';
                el.innerHTML = '';
            }
            this.hideSidebarLoading(done);
        }, done ? 200 : 0);
    }
    showSidebarLoading() {
        const container = this.sidebarListEl || document.querySelector('.scrollable-content');
        if (!container) return;
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.alignItems = 'center';
        container.style.justifyContent = 'center';
        container.innerHTML = `
            <div class="loading-spinner">⚡</div>
            <p>Scan des jeux...</p>
            <div id="sidebarProgressBar" style="width:90%;max-width:320px;height:8px;border-radius:4px;background:#1b1b1b;border:1px solid #333;overflow:hidden;margin-top:10px;">
                <div id="sidebarProgressBarInner" style="height:100%;width:0%;background:linear-gradient(90deg, #679CDF, #5489CC);transition:width 0.3s ease;"></div>
            </div>
        `;
    }
    hideSidebarLoading(done = false) {
        const container = this.sidebarListEl || document.querySelector('.scrollable-content');
        if (!container) return;
        setTimeout(() => {
            container.style.display = '';
        }, done ? 150 : 0);
    }
    renderSidebarGames() {
        const container = this.sidebarListEl || document.querySelector('.scrollable-content');
        if (!container) return;
        const games = this.getDetectedGames();
        if (!games || games.length === 0) {
            container.innerHTML = '<div class="sidebar-note" style="color:var(--text-secondary);font-size:0.9rem;padding:8px 4px;text-align:center;">Aucun jeu détecté pour le moment.</div>';
            return;
        }
        const cards = games.map(game => {
            const achievements = Number(game.achievements || 0);
            const unlocked = Number(game.unlocked || 0);
            const progress = achievements > 0 ? Math.round((unlocked / achievements) * 100) : 0;
            return `<div class="game-card">${this.createGameCardHTML(game, progress, null)}</div>`;
        }).join('');
        container.innerHTML = `<div class="games-grid sidebar-games-grid">${cards}</div>`;
        if (!container._sgClickBound) {
            container.addEventListener('click', (e) => {
                const card = e.target.closest?.('.game-card');
                if (!card) return;
                // Ouvrir la page Jeux sans relancer un scan
                this.skipNextGamesScan = true;
                this.showSection('games');
            });
            container._sgClickBound = true;
        }
    }
    async scanOnStartup() {
        try {
            if (!window.electronAPI?.invoke) return;
            if (this.isScanning) return;
            this.isScanning = true;
            this.showSidebarLoading();
            if (this._progressTimer) clearInterval(this._progressTimer);
            let progress = 0;
            this._progressTimer = setInterval(() => {
                progress += Math.random() * 10 + 5;
                if (progress > 90) progress = 90;
                const barSide = document.getElementById('sidebarProgressBarInner');
                if (barSide) barSide.style.width = progress + '%';
            }, 300);

            const data = await window.electronAPI.invoke('games/detect-cracked');
            this.detectedCrackedGames = data || {};
            this.renderSidebarGames();
        } catch (e) {
            console.warn('startup scan failed:', e);
        } finally {
            this.hideSidebarLoading(true);
            if (this._progressTimer) {
                clearInterval(this._progressTimer);
                this._progressTimer = null;
            }
            this.isScanning = false;
        }
    }
    async loadGames() {
        const gamesGrid = document.getElementById('gamesGrid');
        if (!gamesGrid) return;

        gamesGrid.innerHTML = '';

        const detected = this.getDetectedGames();

        const toRender = detected;

        if (toRender.length === 0) {
            gamesGrid.innerHTML = `
                <div class="no-results" style="display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center;min-height:200px;gap:6px;">
                    <h3 style="margin:0;">Aucun jeu détecté</h3>
                    <p style="margin:0;color:var(--text-secondary);">Ajoutez des dossiers à scanner dans les réglages ou vérifiez vos chemins par défaut.</p>
                </div>
            `;
            return;
        }

        toRender.forEach(game => {
            const achievements = Number(game.achievements || 0);
            const unlocked = Number(game.unlocked || 0);
            const progress = achievements > 0 ? Math.round((unlocked / achievements) * 100) : 0;
            const gameCard = document.createElement('div');
            gameCard.className = 'game-card';
            gameCard.innerHTML = this.createGameCardHTML(game, progress, null);
            gamesGrid.appendChild(gameCard);
        });
    }
    createGameCardHTML(game, progress, steamData) {
        const appId = game.steamAppId || game.appId || game.id || '';
        const name = game.name || `App ${appId}`;
        const enableImages = !!document.getElementById('enableSteamImages')?.checked;
        const quality = document.getElementById('steamImageQuality')?.value || 'medium';
        let headerUrl = '';
        let logoUrl = '';
        const logoCandidate = appId ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/logo.png` : '';

        if (enableImages && appId) {
            // Toujours tenter de récupérer le logo
            logoUrl = logoCandidate;
            if (quality === 'high') {
                headerUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_hero.jpg`;
            } else if (quality === 'low') {
                headerUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/capsule_616x353.jpg`;
            } else {
                headerUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;
            }
        }

        // Debug: print logo URL for each game
        if (logoCandidate) {
            try { console.log(`[DEBUG] Logo URL for ${name} [${appId}]: ${logoCandidate}`); } catch (_) {}
        }

        const achievements = Number(game.achievements || 0);
        const unlocked = Number(game.unlocked || 0);
        const countHtml = `<div class="achievement-count">${unlocked}/${achievements}</div>`;

        return `
          <div class="game-card-header ${headerUrl ? '' : 'no-image'}">
            ${headerUrl ? `<img src="${headerUrl}" alt="${this.escapeHtml(name)}" onload="this.classList.add('loaded')" referrerpolicy="no-referrer">` : ''}
            ${logoUrl ? `<img class=\"game-logo\" src=\"${logoUrl}\" alt=\"${this.escapeHtml(name)}\" referrerpolicy=\"no-referrer\" onerror=\"this.remove()\" onload=\"var f=this.nextElementSibling; if(f&&f.classList.contains('game-title-fallback')) f.style.display='none';\">` : ''}
            <div class=\"game-title-fallback\">${this.escapeHtml(name)}</div>
          </div>
          <div class="game-card-body">
            <div class="game-name">${this.escapeHtml(name)}</div>
            <div class="game-progress-container">
              ${countHtml}
              <div class="progress-bar"><div class="progress" style="width:${progress}%"></div></div>
              <div class="progress-text">${progress}% complété</div>
            </div>
          </div>
        `;
    }
    loadDashboard() { /* ... votre code dashboard ... */ }
    loadAchievements() { /* ... votre code achievements ... */ }
    loadStatistics() { /* ... votre code stats ... */ }
    getDetectedGames() {
        try {
            const dict = this.detectedCrackedGames || {};
            return Object.keys(dict).map(k => {
                const raw = dict[k];
                let name = `App ${k}`;
                let achievements = 0;
                let unlocked = 0;
                if (typeof raw === 'string') {
                    name = raw;
                } else if (raw && typeof raw === 'object') {
                    name = String(raw.name || raw.title || `App ${k}`);
                    achievements = Number(raw.achievements || raw.totalAchievements || 0);
                    unlocked = Number(raw.unlocked || raw.unlockedAchievements || raw.achievementsUnlocked || 0);
                }
                return {
                    id: Number(k),
                    steamAppId: Number(k),
                    name,
                    achievements,
                    unlocked
                };
            });
        } catch (e) { return []; }
    }
    getAllGames() {
        const detected = this.getDetectedGames();
        const demo = Array.isArray(this.demoData?.games) ? this.demoData.games : [];
        const seen = new Set(detected.map(g => g.steamAppId || g.id));
        const merged = detected.slice();
        demo.forEach(g => {
            const key = g.steamAppId || g.id;
            if (!seen.has(key)) merged.push(g);
        });
        return merged;
    }
    // ... toutes vos autres méthodes Steam etc.

    // ✅ SETTINGS EVENTS
    bindSettingsEvents() {
        // Contrôles pour l'ajout de dossiers à scanner
        this.scanFolderInput = document.getElementById('scanFolderPath');
        this.addScanFolderBtn = document.getElementById('addScanFolderBtn');
        this.addedScanFoldersList = document.getElementById('addedScanFolders');
        this.browseScanFolderBtn = document.querySelector('.browse-btn[data-target="scanFolderPath"]');

        // Charger depuis le stockage et afficher
        this.scanFolders = this.loadScanFolders();
        this.renderScanFolders();

        // Bouton Parcourir
        if (this.browseScanFolderBtn) {
            this.browseScanFolderBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                try {
                    const selectedPath = await this.pickDirectory();
                    if (selectedPath && this.scanFolderInput) {
                        this.scanFolderInput.value = selectedPath;
                    }
                } catch (err) {
                    console.error('❌ Erreur sélection dossier:', err);
                }
            });
        }

        // Bouton Ajouter
        if (this.addScanFolderBtn) {
            this.addScanFolderBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const path = (this.scanFolderInput?.value || '').trim();
                if (!path) return;

                if (!this.scanFolders.includes(path)) {
                    this.scanFolders.push(path);
                    this.saveScanFolders();
                    this.renderScanFolders();
                }

                if (this.scanFolderInput) this.scanFolderInput.value = '';
            });
        }

        // Suppression via délégation
        if (this.addedScanFoldersList) {
            this.addedScanFoldersList.addEventListener('click', (e) => {
                const btn = e.target.closest?.('.remove-folder');
                if (btn) {
                    const path = btn.getAttribute('data-path');
                    this.scanFolders = this.scanFolders.filter(p => p !== path);
                    this.saveScanFolders();
                    this.renderScanFolders();
                }
            });
        }
    }

    // ===== Dossiers à scanner - helpers =====
    loadScanFolders() {
        try {
            const raw = localStorage.getItem('scanFolders');
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            console.warn('Impossible de charger scanFolders:', e);
            return [];
        }
    }

    saveScanFolders() {
        try {
            localStorage.setItem('scanFolders', JSON.stringify(this.scanFolders || []));
        } catch (e) {
            console.warn("Impossible d'enregistrer scanFolders:", e);
        }
    }

    renderScanFolders() {
        if (!this.addedScanFoldersList) return;
        this.addedScanFoldersList.innerHTML = '';

        if (!this.scanFolders || this.scanFolders.length === 0) {
            const li = document.createElement('li');
            li.style.color = 'var(--text-secondary)';
            li.textContent = 'Aucun dossier ajouté';
            this.addedScanFoldersList.appendChild(li);
            return;
        }

        this.scanFolders.forEach(path => {
            const li = document.createElement('li');
            li.innerHTML = `<span class="folder-path">📁 <strong>${this.escapeHtml(path)}</strong></span> <button class="remove-folder" data-path="${this.escapeHtml(path)}" title="Supprimer">✖</button>`;
            this.addedScanFoldersList.appendChild(li);
        });
    }

    escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    async pickDirectory() {
        // Tentative API moderne
        if (window.showDirectoryPicker) {
            try {
                const handle = await window.showDirectoryPicker();
                // Par sécurité le chemin absolu n'est pas exposé ; on utilise le nom
                return handle.name;
            } catch (e) {
                if (e && e.name === 'AbortError') return '';
                throw e;
            }
        }

        // Fallback input[type=file] subdirectory
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.setAttribute('subdirectory', '');
            input.setAttribute('directory', '');
            input.multiple = true;

            input.addEventListener('change', () => {
                const files = input.files;
                if (!files || files.length === 0) {
                    resolve('');
                    return;
                }
                const first = files[0];
                let result;
                if (first.path) {
                    const norm = first.path.replace(/\\\\/g, '/');
                    result = norm.slice(0, norm.lastIndexOf('/'));
                } else if (first.webkitRelativePath) {
                    result = first.webkitRelativePath.split('/')[0] || '';
                } else {
                    result = '';
                }
                resolve(result);
            }, { once: true });

            input.click();
        });
    }

    sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    ensureAchievementCountStyles() {
        try {
            if (document.getElementById('achievement-count-styles')) return;
            const css = `
            .achievement-count{display:block;width:100%;color:var(--text-secondary);font-weight:700;font-size:.85rem;line-height:1;text-align:right;margin-bottom:6px}
            .sidebar-games-grid .achievement-count{font-size:.7rem;margin-bottom:4px}
            `;
            const style = document.createElement('style');
            style.id = 'achievement-count-styles';
            style.textContent = css;
            document.head.appendChild(style);
        } catch (_) { /* ignore */ }
    }

    initializeDemoData() {
        // Vos demoData existantes...
        this.demoData = {
            games: [
                { id: 1, name: 'Assassin\'s Creed Odyssey', achievements: 50, unlocked: 47, steamAppId: 812140 },
                { id: 2, name: 'The Witcher 3: Wild Hunt', achievements: 78, unlocked: 62, steamAppId: 292030 },
                { id: 3, name: 'Cyberpunk 2077', achievements: 44, unlocked: 31, steamAppId: 1091500 },
                { id: 4, name: 'Red Dead Redemption 2', achievements: 52, unlocked: 28, steamAppId: 1174180 },
                { id: 5, name: 'Grand Theft Auto V', achievements: 69, unlocked: 45, steamAppId: 271590 },
                { id: 6, name: 'Horizon Zero Dawn', achievements: 56, unlocked: 38, steamAppId: 1151640 }
            ],
            achievements: [
                { id: 1, name: 'Premier Pas', description: 'Terminer le tutoriel', unlocked: true, icon: '🌟', game: 'The Witcher 3: Wild Hunt' },
                // ... vos autres achievements
            ]
        };
    }
}

// ✅ INITIALISATION SÉCURISÉE
document.addEventListener('DOMContentLoaded', () => {
    try {
        window.app = new PrettyAchievementsUI();
        console.log('✅ Pretty Achievements UI initialized successfully');
    } catch (error) {
        console.error('❌ Erreur initialisation:', error);
    }
});
