console.log('[DEBUG] app.js chargé et exécuté');
// ...existing code...

// Instanciation de l'UI principale
document.addEventListener('DOMContentLoaded', () => {
    window.PrettyAchievementsUI = new PrettyAchievementsUI();
});
class PrettyAchievementsUI {
    constructor() {
        this.sidebarOpen = false; // ✅ Track sidebar state
        this.isScanning = false;
        this.scanSeq = 0;
        this.rescanRequested = false;
        this.lastDetectedCrackedGames = null; // cache dernier résultat non vide

        this.initializeElements();
        this.ensureRescanButton();
        this.ensureSortButton();
        this.sortMode = this.loadSortMode(); // 'completion-desc' | 'completion-asc' | 'alpha-asc' | 'alpha-desc'
        this.bindEvents(); // ✅ Doit inclure les events burger
        this.bindSteamEvents();
        // Initialise les boutons de position de notification
        this.initNotifyPositionGrid();
        this.loadDashboard();
        this.ensureAchievementCountStyles();
        this.scanOnStartup();
        this.loadConfigOnStartup();

        // Écoute des jeux détectés depuis le main process
        if (window.electronAPI?.on) {
            window.electronAPI.on('games/detected', (data) => {
                try {
                    const incoming = (data && typeof data === 'object') ? data : {};
                    const prev = (this.detectedCrackedGames && typeof this.detectedCrackedGames === 'object') ? this.detectedCrackedGames : {};
                    const prevCount = Object.keys(prev).length;
                    const newCount = Object.keys(incoming).length;
                    // Ne pas écraser les jeux déjà détectés par un résultat vide
                    if (newCount > 0 || prevCount === 0) {
                        this.detectedCrackedGames = incoming;
                        if (newCount > 0) this.lastDetectedCrackedGames = incoming;
                    }
                    this.renderDetectedCrackedGames();
                    this.renderSidebarGames();
                } catch (e) { console.warn('render cracked games failed:', e); }
            });
        }

        // Fallback: tente une récupération via l'API backend si rien reçu
        setTimeout(async () => {
            if (!this.detectedCrackedGames) {
                try {
                    const mapped = await this.fetchGamesFromBackend();
                    const incoming = (mapped && typeof mapped === 'object') ? mapped : {};
                    const prev = (this.detectedCrackedGames && typeof this.detectedCrackedGames === 'object') ? this.detectedCrackedGames : {};
                    if (Object.keys(incoming).length > 0 || Object.keys(prev).length === 0) {
                        this.detectedCrackedGames = incoming;
                        if (Object.keys(incoming).length > 0) this.lastDetectedCrackedGames = incoming;
                    }
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
                console.log('[DEBUG] CLIC burgerMenu reçu');
                this.toggleSidebar();
            });
            console.log('[DEBUG] Listener burgerMenu ajouté:', this.burgerMenu);
        } else {
            console.error('[DEBUG] burgerMenu introuvable dans le DOM');
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

        // ✅ BOUTON RESCAN (top-right)
        this.rescanBtn = document.getElementById('rescanMenuBtn');
        if (this.rescanBtn) {
            this.rescanBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.scanAndLoadGames();
            });
        }

        // ✅ BOUTON TRI (top-right next to refresh)
        this.sortBtn = document.getElementById('sortMenuBtn');
        if (this.sortBtn) {
            this.updateSortButtonAppearance();
            this.sortBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.cycleSortMode();
                // Recharger l'affichage des jeux selon le nouveau tri
                if (document.getElementById('games')?.classList.contains('active')) {
                    this.loadGames();
                }
            });
        }

        // ✅ EVENTS SETTINGS
        this.bindSettingsEvents();
        this.bindSaveSettings();
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

        // Masquer le bouton rescan par défaut
        const rescan = document.getElementById('rescanMenuBtn');
        if (rescan) rescan.style.display = 'none';

        // Charger le contenu selon la section
        switch(sectionId) {
            case 'games':
                this.loadGames();
                // If a scan is already running (e.g., startup), mirror the loader into the games page without triggering a scan
                if (this.isScanning) {
                    this.ensureGamesLoaderVisible();
                }
                if (rescan) rescan.style.display = 'flex';
                const sortBtn = document.getElementById('sortMenuBtn');
                if (sortBtn) sortBtn.style.display = 'flex';
                break;
            case 'achievements':
                this.loadAchievements();
                const sortBtnAch = document.getElementById('sortMenuBtn');
                if (sortBtnAch) sortBtnAch.style.display = 'none';
                break;
            case 'statistics':
                this.loadStatistics();
                const sortBtnStat = document.getElementById('sortMenuBtn');
                if (sortBtnStat) sortBtnStat.style.display = 'none';
                break;
            case 'dashboard':
                this.loadDashboard();
                const sortBtnDash = document.getElementById('sortMenuBtn');
                if (sortBtnDash) sortBtnDash.style.display = 'none';
                break;
        }
    }

    // ✅ RECHERCHE (sidebar uniquement)
    handleSearch(query = '') {
        console.log('🔍 Sidebar Search:', query);
        const q = (query || '').trim().toLowerCase();
        if (!q) {
            // Réinitialiser la liste de la sidebar
            this.renderSidebarGames();
            return;
        }
        const detectedGames = this.getDetectedGames();
        const filteredGames = detectedGames.filter(game =>
            (game.name || '').toLowerCase().includes(q)
        );
        // Afficher uniquement dans la sidebar, sans impacter la page Jeux
        this.renderSidebarGames(filteredGames);
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

        games = this.sortGames(games);
        games.forEach(game => {
            const achievements = Number(game.achievements || 0);
            const unlocked = Number(game.unlocked || 0);
            const progress = achievements > 0 ? Math.round((unlocked / achievements) * 100) : 0;
            const gameCard = document.createElement('div');
            gameCard.className = 'game-card';
            gameCard.innerHTML = this.createGameCardHTML(game, progress, null);
            gamesGrid.appendChild(gameCard);
        });
        this.applyStaggerAnimation();
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

    // Fetch games from backend API, trying HTTPS first then HTTP
    async fetchGamesFromBackend() {
        const urls = ['http://localhost:5000/api/games'];
        for (const url of urls) {
            try {
                const res = await fetch(url, { method: 'GET' });
                if (!res.ok) continue;
                const json = await res.json();
                if (json && json.success && Array.isArray(json.games)) {
                    return this.mapBackendGames(json.games);
                }
            } catch (_) { /* try next */ }
        }
        return null;
    }

    mapBackendGames(gamesArray) {
        try {
            const out = {};
            (gamesArray || []).forEach(g => {
                const appId = String(g.app_id ?? g.id ?? '').trim();
                if (!appId) return;
                const achievements = Number(g.local_achievements_count || g.totalAchievements || 0) || 0;
                const unlocked = Number(g.unlocked || 0) || 0;
                out[appId] = {
                    name: String(g.name || `App ${appId}`),
                    achievements,
                    unlocked
                };
            });
            return out;
        } catch (_) {
            return {};
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
        const prevCount = this.detectedCrackedGames && typeof this.detectedCrackedGames === 'object' ? Object.keys(this.detectedCrackedGames).length : 0;
        if (prevCount === 0 && gamesGrid) gamesGrid.innerHTML = '';
        this.showGamesLoading();
        try {
            let mapped = await this.fetchGamesFromBackend();
            if (!mapped) {
                await this.sleep(800);
                mapped = await this.fetchGamesFromBackend();
            }

            if (localScanId !== this.scanSeq) {
                // Un autre scan a été lancé entre-temps, ignorer ce résultat
                return;
            }

            const prevCountNow = this.detectedCrackedGames && typeof this.detectedCrackedGames === 'object' ? Object.keys(this.detectedCrackedGames).length : 0;
            const newCount = mapped && typeof mapped === 'object' ? Object.keys(mapped).length : 0;
            if (newCount > 0 || prevCountNow === 0) {
                // Remplacer uniquement si on a de nouvelles données, ou si on n'avait rien avant
                this.detectedCrackedGames = mapped || {};
                if (newCount > 0) this.lastDetectedCrackedGames = this.detectedCrackedGames;
            }
            if (newCount === 0 && prevCountNow === 0 && (!this.lastDetectedCrackedGames || Object.keys(this.lastDetectedCrackedGames).length === 0)) {
                this.renderNoGamesEmptyState();
            } else {
                await this.loadGames();
                await this.waitForGameCardsVisible();
            }
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
    ensureGamesLoaderVisible() {
        try {
            const gamesSection = document.getElementById('games');
            if (!gamesSection || !gamesSection.classList.contains('active')) return;
            let el = this.gamesLoadingEl || document.getElementById('gamesLoading');
            if (!el) {
                el = document.createElement('div');
                el.id = 'gamesLoading';
                el.className = 'games-loading';
                this.gamesLoadingEl = el;
            }
            const h1 = gamesSection.querySelector('h1');
            if (h1) {
                if (el.parentNode !== gamesSection || el.previousElementSibling !== h1) {
                    gamesSection.insertBefore(el, h1.nextSibling);
                }
            } else if (!el.parentNode) {
                gamesSection.insertBefore(el, gamesSection.firstChild);
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
        } catch (_) { /* ignore */ }
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
        // Mirror loader in games page if open, without triggering a scan
        this.ensureGamesLoaderVisible();
    }
    hideSidebarLoading(done = false) {
        const container = this.sidebarListEl || document.querySelector('.scrollable-content');
        if (!container) return;
        setTimeout(() => {
            container.style.display = '';
            // Ne pas cacher le loader de la page Jeux ici; il sera géré par hideGamesLoading
        }, done ? 150 : 0);
    }
    renderSidebarGames(gamesList) {
        const container = this.sidebarListEl || document.querySelector('.scrollable-content');
        if (!container) return;
        const usingFilter = Array.isArray(gamesList);
        const games = usingFilter ? gamesList : this.getDetectedGames();
        if (!games || games.length === 0) {
            const msg = usingFilter ? 'Aucun jeu trouvé' : 'Aucun jeu détecté pour le moment.';
            container.innerHTML = `<div class="sidebar-note" style="color:var(--text-secondary);font-size:0.9rem;padding:8px 4px;text-align:center;">${msg}</div>`;
            return;
        }
        const cards = games.map(game => {
            const achievements = Number(game.achievements || 0);
            const unlocked = Number(game.unlocked || 0);
            const progress = achievements > 0 ? Math.round((unlocked / achievements) * 100) : 0;
            return `<div class="game-card">${this.createGameCardHTML(game, progress, null)}</div>`;
        }).join('');
        container.innerHTML = `<div class="games-grid sidebar-games-grid">${cards}</div>`;
        const gridEl = container.querySelector('.games-grid');
        if (gridEl) this.applyStaggerAnimationIn(gridEl, 30, 1200);
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
                const barMain = document.getElementById('gamesProgressBarInner');
                if (barMain) barMain.style.width = progress + '%';
            }, 300);

            const mapped = await this.fetchGamesFromBackend();
            const incoming = (mapped && typeof mapped === 'object') ? mapped : {};
            const prev = (this.detectedCrackedGames && typeof this.detectedCrackedGames === 'object') ? this.detectedCrackedGames : {};
            if (Object.keys(incoming).length > 0 || Object.keys(prev).length === 0) {
                this.detectedCrackedGames = incoming;
                if (Object.keys(incoming).length > 0) this.lastDetectedCrackedGames = incoming;
            }
            this.renderSidebarGames();
        } catch (e) {
            console.warn('startup scan failed:', e);
        } finally {
            try {
                const gamesActive = document.getElementById('games')?.classList.contains('active');
                if (gamesActive) {
                    await this.loadGames();
                    await this.waitForGameCardsVisible();
                }
            } catch (_) { /* ignore */ }
            this.hideGamesLoading(true);
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

        // Appliquer le tri courant
        const toRender = this.sortGames(detected);

        if (toRender.length === 0) {
            gamesGrid.innerHTML = `
                <div class="no-results" style="display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center;min-height:200px;gap:6px;grid-column:1 / -1;justify-self:center;width:100%;">
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
        this.applyStaggerAnimation();
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
            // Afficher le logo uniquement si le mode n'est pas "Header"
            if (quality !== 'medium') {
                logoUrl = logoCandidate;
            } else {
                logoUrl = '';
            }
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
    async loadDashboard() {
        try {
            // 1) Supprimer la carte "Succès Totaux" si présente
            const totalAchEl = document.getElementById('totalAchievements');
            if (totalAchEl) {
                const card = totalAchEl.closest('.stat-card');
                if (card && card.parentNode) card.parentNode.removeChild(card);
            }

            // 2) Renommer la carte de complétion
            const completionEl = document.getElementById('completionRate');
            if (completionEl) {
                const compCard = completionEl.closest('.stat-card');
                const header = compCard?.querySelector('h3');
                if (header) header.textContent = 'Taux de Complétion Moyen';
            }

            // 3) Récupérer total_games depuis l'API backend
            const totalGamesEl = document.getElementById('totalGames');
            let totalGamesVal = null;
            try {
                const res = await fetch('http://localhost:5000/api/games', { method: 'GET' });
                if (res.ok) {
                    const json = await res.json();
                    if (json && json.success && Number.isFinite(json.total_games)) {
                        totalGamesVal = json.total_games;
                    }
                }
            } catch (_) { /* ignore, fallback below */ }

            // 4) Calcul des métriques locales à partir des jeux détectés
            const games = this.getDetectedGames();
            const fallbackTotal = Array.isArray(games) ? games.length : 0;
            if (totalGamesEl) {
                const target = Number(totalGamesVal ?? fallbackTotal) || 0;
                this.animateCounter(totalGamesEl, target, 900);
            }

            let sumUnlocked = 0;
            let sumRatio = 0;
            let countWithAchievements = 0;
            for (const g of games) {
                const a = Number(g.achievements || 0);
                const u = Number(g.unlocked || 0);
                sumUnlocked += Number.isFinite(u) ? u : 0;
                if (a > 0) {
                    sumRatio += Math.max(0, Math.min(1, u / a));
                    countWithAchievements += 1;
                }
            }
            // Total succès débloqués
            const unlockedEl = document.getElementById('unlockedAchievements');
            if (unlockedEl) unlockedEl.textContent = String(sumUnlocked);

            // Taux de complétion moyen (en %)
            const avg = countWithAchievements > 0 ? (sumRatio / countWithAchievements) * 100 : 0;
            if (completionEl) completionEl.textContent = `${Math.round(avg)}%`;
        } catch (_) { /* ignore dashboard errors */ }
    }
    loadAchievements() { /* ... votre code achievements ... */ }
    loadStatistics() { /* ... votre code stats ... */ }

    // ===== TRI DES JEUX =====
    sortGames(arr) {
        try {
            const list = Array.isArray(arr) ? arr.slice() : [];
            const mode = this.sortMode || 'completion-desc';
            const pct = (g) => {
                const a = Number(g.achievements || 0);
                const u = Number(g.unlocked || 0);
                if (!Number.isFinite(a) || a <= 0) return 0;
                return u / a;
            };
            if (mode === 'completion-desc') {
                list.sort((a, b) => pct(b) - pct(a) || (a.name || '').localeCompare(b.name || ''));
            } else if (mode === 'completion-asc') {
                list.sort((a, b) => pct(a) - pct(b) || (a.name || '').localeCompare(b.name || ''));
            } else if (mode === 'alpha-asc') {
                list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            } else if (mode === 'alpha-desc') {
                list.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
            }
            return list;
        } catch (_) { return arr; }
    }

    cycleSortMode() {
        const order = ['completion-desc', 'completion-asc', 'alpha-asc', 'alpha-desc'];
        const idx = Math.max(0, order.indexOf(this.sortMode || 'completion-desc'));
        const next = order[(idx + 1) % order.length];
        this.sortMode = next;
        this.saveSortMode(next);
        this.updateSortButtonAppearance();
    }

    updateSortButtonAppearance() {
        try {
            const btn = this.sortBtn || document.getElementById('sortMenuBtn');
            if (!btn) return;
            let label = '';
            let title = '';
            switch (this.sortMode) {
                case 'completion-desc':
                    label = '％↓';
                    title = 'Tri: completion décroissant';
                    break;
                case 'completion-asc':
                    label = '％↑';
                    title = 'Tri: completion croissant';
                    break;
                case 'alpha-asc':
                    label = 'A→Z';
                    title = 'Tri: alphabétique croissant';
                    break;
                case 'alpha-desc':
                    label = 'Z→A';
                    title = 'Tri: alphabétique décroissant';
                    break;
            }
            btn.textContent = label;
            btn.title = title;
        } catch (_) { /* ignore */ }
    }

    saveSortMode(mode) {
        try { localStorage.setItem('sortMode', String(mode || '')); } catch (_) {}
    }
    loadSortMode() {
        try { return localStorage.getItem('sortMode') || 'completion-desc'; } catch (_) { return 'completion-desc'; }
    }
    getDetectedGames() {
        try {
            const base = this.detectedCrackedGames || {};
            const dict = (Object.keys(base).length === 0 && this.lastDetectedCrackedGames && Object.keys(this.lastDetectedCrackedGames).length > 0)
                ? this.lastDetectedCrackedGames
                : base;
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
        const seen = new Set(detected.map(g => g.steamAppId || g.id));
        const merged = detected.slice();
        demo.forEach(g => {
            const key = g.steamAppId || g.id;
            if (!seen.has(key)) merged.push(g);
        });
        return merged;
    }
    // ... toutes vos autres méthodes Steam etc.

    ensureRescanButton() {
        try {
            if (!document.getElementById('rescanMenuBtn')) {
                const gamesSection = document.getElementById('games');
                if (!gamesSection) return;
                const btn = document.createElement('button');
                btn.id = 'rescanMenuBtn';
                btn.className = 'rescan-menu';
                btn.title = 'Rescanner les jeux';
                btn.textContent = '↻';
                btn.style.display = 'none';
                gamesSection.appendChild(btn);
            }
        } catch (_) { /* ignore */ }
    }

    ensureSortButton() {
        try {
            if (!document.getElementById('sortMenuBtn')) {
                const gamesSection = document.getElementById('games');
                if (!gamesSection) return;
                const btn = document.createElement('button');
                btn.id = 'sortMenuBtn';
                btn.className = 'rescan-menu sort-menu';
                btn.title = 'Changer le tri';
                btn.textContent = '';
                btn.style.display = 'none';
                btn.style.right = '80px';
                gamesSection.appendChild(btn);
                this.sortBtn = btn;
                this.updateSortButtonAppearance();
            }
        } catch (_) { /* ignore */ }
    }

    // ✅ SETTINGS EVENTS
    bindSettingsEvents() {
        // Contrôles pour l'ajout de dossiers à scanner
        this.scanFolderInput = document.getElementById('scanFolderPath');
        this.addScanFolderBtn = document.getElementById('addScanFolderBtn');
        this.addedScanFoldersList = document.getElementById('addedScanFolders');
        this.browseScanFolderBtn = document.querySelector('.browse-btn[data-target="scanFolderPath"]');

        // Bouton test notification
        this.testNotificationBtn = document.getElementById('testNotificationBtn');
        if (this.testNotificationBtn) {
            // Correction : un seul listener, suppression des doublons
            this.testNotificationBtn.onclick = null;
            if (this._testNotifListener) {
                this.testNotificationBtn.removeEventListener('click', this._testNotifListener);
            }
            this._testNotifListener = (e) => {
                e.preventDefault();
                this.triggerTestNotification();
            };
            this.testNotificationBtn.addEventListener('click', this._testNotifListener);
        }
        // Ajout d'un avertissement permanent pour les notifications en plein écran
        const notifFeedback = document.getElementById('testNotificationFeedback');
        if (notifFeedback) {
            notifFeedback.innerHTML =
                "<span style='color:var(--text-secondary)'>⚠️ Les notifications personnalisées peuvent ne pas s'afficher au-dessus d'un jeu en plein écran. Pour maximiser la compatibilité, lancez Pretty Achievements en tant qu'administrateur et privilégiez le mode fenêtré sans bordure dans vos jeux.</span>";
        }

        // Pré-écoute du son de notification
        const soundSelect = document.getElementById('notificationSound');
        // Mapping des valeurs du select vers les vrais noms de fichiers
        const soundFileMap = {
            'steam': 'steam',
            'steam-deck': 'steamdeck',
            'steamdeck': 'steamdeck',
            'xbox': 'xbox',
            'xbox-rare': 'xboxrare',
            'xboxrare': 'xboxrare',
            'ps4': 'ps4',
            'ps5': 'ps5',
            'ps5platinum': 'ps5platinum',
            'win8': 'win8',
            'win10': 'win10',
            'win11': 'win11',
        };
        if (soundSelect) {
            // Charger la valeur sauvegardée au démarrage
            const savedSound = localStorage.getItem('notificationSound');
            if (savedSound && soundSelect.value !== savedSound) {
                soundSelect.value = savedSound;
            }
            if (this._notifAudio) {
                try { this._notifAudio.pause(); this._notifAudio = null; } catch(_){}
            }
            soundSelect.addEventListener('change', (e) => {
                const val = e.target.value;
                // Sauvegarder la sélection à chaque changement
                localStorage.setItem('notificationSound', val);
                if (this._notifAudio) {
                    this._notifAudio.pause();
                    this._notifAudio.currentTime = 0;
                }
                if (val && val !== 'none') {
                    // Normalisation du nom pour supporter tous les formats
                    let fileKey = soundFileMap[val];
                    if (!fileKey) {
                        fileKey = val.toLowerCase().replace(/[^a-z0-9]/g, '');
                    }
                    const audio = new Audio(`../notifications/sounds/${fileKey}.mp3`);
                    audio.volume = 0.7;
                    audio.play().catch(()=>{});
                    this._notifAudio = audio;
                }
            });
        }

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

        // Gestion affichage/masquage clé API Steam
        const apiKeyInput = document.getElementById('steamApiKey');
        const toggleApiKeyBtn = document.getElementById('toggleApiKeyVisibility');
        const apiKeyEye = document.getElementById('apiKeyEye');
        if (apiKeyInput && toggleApiKeyBtn && apiKeyEye) {
            toggleApiKeyBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (apiKeyInput.type === 'password') {
                    apiKeyInput.type = 'text';
                    apiKeyEye.textContent = '🙈';
                } else {
                    apiKeyInput.type = 'password';
                    apiKeyEye.textContent = '👁️';
                }
            });
        }
        // Ajout : sauvegarde automatique de la clé API Steam à chaque modification
        if (apiKeyInput) {
            apiKeyInput.addEventListener('blur', () => {
                const saveBtn = document.getElementById('saveSettingsBtn');
                if (saveBtn && !saveBtn.disabled) {
                    saveBtn.click();
                }
            });
        }
    }

    // ✅ ENREGISTREMENT DES PARAMÈTRES
    bindSaveSettings() {
        const btn = document.getElementById('saveSettingsBtn');
        if (!btn) return;
        const setIdle = () => {
            btn.style.background = 'var(--primary-color)';
            btn.textContent = 'Enregistrer';
            btn.disabled = false;
            btn.style.opacity = '';
        };
        const setSuccess = () => {
            btn.style.background = '#28a745';
            btn.textContent = 'Enregistré ✔';
        };
        const setError = () => {
            btn.style.background = '#dc3545';
            btn.textContent = 'Erreur ✖';
        };
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            btn.disabled = true;
            btn.style.opacity = '0.9';
            const payload = this.collectSettingsPayload();
            try {
                const res = await window.electronAPI?.invoke?.('config/save', payload);
                // Synchronise la clé Steam API décryptée dans le vrai config.json racine
                await window.electronAPI?.invoke?.('config/syncSteamApiKeyFromElectronConfig');
                if (res && res.ok) {
                    setSuccess();
                } else {
                    setError();
                }
            } catch (_) {
                setError();
            } finally {
                setTimeout(() => setIdle(), 1500);
            }
        });
    }

    collectSettingsPayload() {
        const getVal = (id, fallback = '') => (document.getElementById(id)?.value ?? fallback);
        const getBool = (id) => !!document.getElementById(id)?.checked;
        const getNum = (id, fallback = 0) => {
            const v = Number(document.getElementById(id)?.value);
            return Number.isFinite(v) ? v : fallback;
        };
        // Chiffrement clé API Steam
        const apiKey = getVal('steamApiKey', '');
        const encryptedApiKey = apiKey ? window.encryptApiKey(apiKey) : '';
        const payload = {
            general: {
                autoStart: getBool('autoStart'),
                notifications: getBool('notifications'),
                minimizeToTray: getBool('minimizeToTray'),
                refreshEveryMinutes: getNum('refreshEveryMinutes', 15),
                steamApiKey: encryptedApiKey
            },
            images: {
                enableSteamImages: getBool('enableSteamImages'),
                steamImageQuality: getVal('steamImageQuality', 'medium'),
                imageCacheDuration: getNum('imageCacheDuration', 7)
            },
            detection: {
                folders: Array.from(document.querySelectorAll('#addedScanFolders .folder-path strong')).map(el => el.textContent)
            },
            cache: {
                autoRefreshCache: getBool('autoRefreshCache'),
                cacheDuration: getNum('cacheDuration', 24)
            }
        };
        return payload;
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

    // Attend que les cartes de jeux soient présentes et aient eu le temps de s'afficher
    async waitForGameCardsVisible(maxWait = 1500) {
        const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        return new Promise((resolve) => {
            const check = () => {
                const grid = document.getElementById('gamesGrid');
                const first = grid && grid.querySelector('.game-card');
                if (first) {
                    // Laisser un frame + petite marge pour éviter un flash entre loader et fade-in
                    if (typeof requestAnimationFrame === 'function') {
                        requestAnimationFrame(() => setTimeout(resolve, 150));
                    } else {
                        setTimeout(resolve, 150);
                    }
                    return;
                }
                const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                if (now - start > maxWait) return resolve();
                setTimeout(check, 50);
            };
            check();
        });
    }

    async loadConfigOnStartup() {
        try {
            const cfg = await window.electronAPI?.invoke?.('config/load');
            if (!cfg || typeof cfg !== 'object') return;
            const setBool = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
            const setVal = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined && el.value === '') el.value = String(v); };
            // general
            setBool('autoStart', cfg?.general?.autoStart);
            setBool('notifications', cfg?.general?.notifications);
            setBool('minimizeToTray', cfg?.general?.minimizeToTray);
            // Déchiffrement clé API Steam (ne remplit que si input vide)
            if (cfg?.general?.steamApiKey) {
                setVal('steamApiKey', window.decryptApiKey(cfg.general.steamApiKey));
            } else {
                setVal('steamApiKey', '');
            }
            // images
            setBool('enableSteamImages', cfg?.images?.enableSteamImages);
            setVal('steamImageQuality', cfg?.images?.steamImageQuality);
            setVal('imageCacheDuration', cfg?.images?.imageCacheDuration);
            // general extra
            setVal('refreshEveryMinutes', cfg?.general?.refreshEveryMinutes);
            // cache
            setBool('autoRefreshCache', cfg?.cache?.autoRefreshCache);
            setVal('cacheDuration', cfg?.cache?.cacheDuration);
            // detection folders
            if (Array.isArray(cfg?.detection?.folders)) {
                this.scanFolders = [...cfg.detection.folders];
                this.renderScanFolders();
            }
        } catch (_) { /* ignore */ }
    }

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

    // Applique un délai d'animation progressif sur les cartes de jeux du grid principal
    applyStaggerAnimation(baseDelayMs = 40, maxDelayMs = 2000) {
        try {
            const grid = document.getElementById('gamesGrid');
            if (!grid) return;
            const cards = Array.from(grid.querySelectorAll('.game-card'));
            cards.forEach((card, idx) => {
                const delay = Math.min((idx + 1) * baseDelayMs, maxDelayMs);
                card.style.animationDelay = `${delay}ms`;
            });
        } catch (_) { /* ignore */ }
    }

    // Version générique permettant de cibler n'importe quel conteneur de cartes (ex: sidebar)
    applyStaggerAnimationIn(containerEl, baseDelayMs = 40, maxDelayMs = 2000) {
        try {
            if (!containerEl) return;
            const cards = Array.from(containerEl.querySelectorAll('.game-card'));
            cards.forEach((card, idx) => {
                const delay = Math.min((idx + 1) * baseDelayMs, maxDelayMs);
                card.style.animationDelay = `${delay}ms`;
            });
        } catch (_) { /* ignore */ }
    }

    // Crée dynamiquement la section Notifications dans les réglages avec un bouton de test
    ensureNotificationSettings() {
        try {
            if (document.getElementById('notificationsGroup')) return;
            const container = document.querySelector('#settings .settings-container');
            if (!container) return;
            const group = document.createElement('div');
            group.className = 'settings-group';
            group.id = 'notificationsGroup';
            group.innerHTML = `
                <h3>Notifications</h3>
                <div class="setting-item">
                    <label style="color:var(--text-primary);font-weight:500;margin-bottom:6px;">Position de la notification</label>
                    <div class="notify-position-grid" id="notifyPositionGrid">
                        <button class="notify-cell" data-position="top-left" title="Haut gauche"></button>
                        <button class="notify-cell" data-position="top-center" title="Haut centre"></button>
                        <button class="notify-cell" data-position="top-right" title="Haut droite"></button>
                        <div class="notify-cell disabled" aria-disabled="true"></div>
                        <div class="notify-cell disabled" aria-disabled="true"></div>
                        <div class="notify-cell disabled" aria-disabled="true"></div>
                        <button class="notify-cell" data-position="bottom-left" title="Bas gauche"></button>
                        <button class="notify-cell" data-position="bottom-center" title="Bas centre"></button>
                        <button class="notify-cell" data-position="bottom-right" title="Bas droite"></button>
                    </div>
                </div>
                <div class="setting-item">
                    <button class="browse-btn" id="testNotificationBtn">Tester la notification</button>
                </div>
                <div id="testNotificationFeedback" style="margin-top:8px;color:var(--text-secondary);font-size:0.9rem;"></div>
            `;
            container.appendChild(group);
            this.initNotifyPositionGrid();
        } catch (_) { /* ignore */ }
    }

    // Initialise les boutons de position de notification
    initNotifyPositionGrid() {
        const notifyGrid = document.getElementById('notifyPositionGrid');
        if (!notifyGrid) return;
        // Ajoute le listener à chaque bouton
        notifyGrid.querySelectorAll('.notify-cell[data-position]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const pos = btn.getAttribute('data-position');
                if (!pos) return;
                // Sauvegarde dans localStorage
                localStorage.setItem('notifyPosition', pos);
                // Met à jour l'apparence
                notifyGrid.querySelectorAll('.notify-cell').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
        // Affiche la position sélectionnée au chargement
        const saved = localStorage.getItem('notifyPosition') || 'bottom-right';
        const btn = notifyGrid.querySelector(`.notify-cell[data-position="${saved}"]`);
        if (btn) btn.classList.add('active');
    }

    // Déclenche une notification de test (Toast HTML/CSS custom)
    triggerTestNotification() {
        // Transmet la position sélectionnée
        const pos = localStorage.getItem('notifyPosition') || 'bottom-right';
        const message = 'Ceci est une notification de test !';
        const duration = 3500;

        // Joue le son sélectionné
        const soundSelect = document.getElementById('notificationSound');
        const soundFileMap = {
            'steam': 'steam',
            'steam-deck': 'steamdeck',
            'steamdeck': 'steamdeck',
            'xbox': 'xbox',
            'xbox-rare': 'xboxrare',
            'xboxrare': 'xboxrare',
            'ps4': 'ps4',
            'ps5': 'ps5',
            'ps5platinum': 'ps5platinum',
            'win8': 'win8',
            'win10': 'win10',
            'win11': 'win11',
        };
        if (soundSelect) {
            const val = soundSelect.value;
            if (val && val !== 'none') {
                let fileKey = soundFileMap[val];
                if (!fileKey) {
                    fileKey = val.toLowerCase().replace(/[^a-z0-9]/g, '');
                }
                const audio = new Audio(`../notifications/sounds/${fileKey}.mp3`);
                audio.volume = 0.7;
                audio.play().catch(()=>{});
                this._notifAudio = audio;
            }
        }

        if (window.electronAPI?.send) {
            window.electronAPI.send('show-custom-notification', { message, duration, position: pos });
        } else if (typeof window.showNotification === 'function') {
            window.showNotification(message, duration, pos);
        } else {
            const feedback = document.getElementById('testNotificationFeedback');
            if (feedback) {
                feedback.textContent = 'Erreur: Notifications non supportées.';
                setTimeout(() => {
                    feedback.textContent = '';
                }, 3000);
            }
        }
    }
}

// Affiche les infos debug de notification dans la console du renderer
if (window.electronAPI?.on) {
    window.electronAPI.on('notification/debug', (data) => {
        console.log('[DEBUG][Notification renderer]', data);
    });
}

// Ajout chiffrement/déchiffrement simple (AES via Web Crypto ou fallback base64)
window.encryptApiKey = function(apiKey) {
    try {
        // Clé statique simple (à améliorer pour plus de sécurité)
        const key = 'prettyachievements2024';
        if (window.crypto && window.crypto.subtle) {
            // Web Crypto API (AES-GCM)
            // Pour la simplicité, fallback base64 si indisponible
            // (ici, on ne fait qu'un encodage base64 pour la démo)
            return btoa(unescape(encodeURIComponent(apiKey + ':' + key)));
        } else {
            return btoa(apiKey + ':' + key);
        }
    } catch(_) { return ''; }
};
window.decryptApiKey = function(enc) {
    try {
        const key = 'prettyachievements2024';
        let decoded = '';
        if (window.atob) {
            decoded = decodeURIComponent(escape(atob(enc)));
        } else {
            decoded = atob(enc);
        }
        if (decoded.endsWith(':' + key)) {
            return decoded.slice(0, -key.length - 1);
        }
        return '';
    } catch(_) { return ''; }
};
