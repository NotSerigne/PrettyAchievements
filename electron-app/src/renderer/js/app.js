class PrettyAchievementsUI {
    constructor() {
        this.sidebarOpen = false; // ✅ Track sidebar state

        this.initializeElements();
        this.initializeDemoData();
        this.bindEvents(); // ✅ Doit inclure les events burger
        this.bindSteamEvents();
        this.loadDashboard();
        this.loadSettingsFromLocalStorage();
        this.initSGDBClient();
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
                this.loadGames().then(() =>{} );
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
            // Trafficker tous les jeux
            this.loadGames().then(() =>{} );
            return;
        }

        // Filtrer les jeux
        const filteredGames = this.demoData.games.filter(game =>
            game.name.toLowerCase().includes(query.toLowerCase())
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
            const progress = Math.round((game.unlocked / game.achievements) * 100);
            const gameCard = document.createElement('div');
            gameCard.className = 'game-card';
            gameCard.onclick = () => this.showGameDetails(game);
            gameCard.innerHTML = this.createGameCardHTML(game, progress, null);
            gamesGrid.appendChild(gameCard);
        });
    }

    // ===== VOS MÉTHODES EXISTANTES (inchangées) =====
    bindSteamEvents() { /* ... votre code Steam ... */ }
    async loadGames() { /* ... votre code games ... */ }
    createGameCardHTML(game, progress, steamData) { /* ... votre code template ... */ }
    loadDashboard() { /* ... votre code dashboard ... */ }
    loadAchievements() { /* ... votre code achievements ... */ }
    loadStatistics() { /* ... votre code stats ... */ }
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
