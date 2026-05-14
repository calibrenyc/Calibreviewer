/**
 * CalibreViewer Application Entry Point
 */

const THEME_COLORS_STORAGE_KEY = 'themeColors';
const UI_MODE_STORAGE_KEY = 'uiMode';
const KEYBOARD_ONLY_MODE_STORAGE_KEY = 'keyboardOnlyMode';
const SAVED_LOGINS_KEY = 'savedLogins';
const KNOWN_USERS_KEY = 'knownLoginUsers';
const REMEMBER_ME_KEY = 'rememberLoginEnabled';
const LAST_LOGIN_USER_KEY = 'lastLoginUser';

const DEFAULT_THEME_COLORS = {
    '--color-bg-primary': '#0b0c10',
    '--color-bg-secondary': '#12141a',
    '--color-bg-tertiary': '#1a1d24',
    '--color-bg-hover': '#232833',
    '--color-bg-active': '#2d3441',
    '--color-accent': '#0a84ff',
    '--color-accent-hover': '#409cff',
    '--color-welcome-1': '#0a84ff',
    '--color-welcome-2': '#64d2ff',
    '--color-success': '#30d158',
    '--color-warning': '#ffd60a',
    '--color-error': '#ff453a',
    '--color-text-primary': '#f5f5f7',
    '--color-text-secondary': '#c7c7cc',
    '--color-text-muted': '#8e8e93',
    '--color-border': '#2c313d',
    '--color-border-light': '#3d4454'
};

function normalizeHexColor(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) return null;
    return normalized.toLowerCase();
}

function hexToRgb(hex) {
    const normalized = normalizeHexColor(hex);
    if (!normalized) return null;

    const value = normalized.slice(1);
    return {
        r: parseInt(value.slice(0, 2), 16),
        g: parseInt(value.slice(2, 4), 16),
        b: parseInt(value.slice(4, 6), 16)
    };
}

function applyThemeColors(themeColors = {}) {
    const root = document.documentElement;
    const merged = { ...DEFAULT_THEME_COLORS, ...(themeColors || {}) };

    Object.entries(merged).forEach(([cssVar, color]) => {
        const normalized = normalizeHexColor(color);
        if (normalized) {
            root.style.setProperty(cssVar, normalized);
        }
    });

    // Recalculate dependent variables so glow/dim/glass stay aligned with user-selected colors.
    const accent = hexToRgb(merged['--color-accent']);
    if (accent) {
        root.style.setProperty('--color-accent-dim', `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.2)`);
        root.style.setProperty('--shadow-glow', `0 0 20px rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.3)`);
    }

    const bgSecondary = hexToRgb(merged['--color-bg-secondary']);
    if (bgSecondary) {
        root.style.setProperty('--glass-bg', `rgba(${bgSecondary.r}, ${bgSecondary.g}, ${bgSecondary.b}, 0.8)`);
    }
}

function normalizeUiMode(value) {
    return value === 'tv' ? 'tv' : 'desktop';
}

function applyInterfaceMode(mode = 'desktop') {
    const normalized = normalizeUiMode(mode);
    document.body.classList.toggle('ui-mode-tv', normalized === 'tv');
    document.body.classList.toggle('ui-mode-desktop', normalized === 'desktop');
    localStorage.setItem(UI_MODE_STORAGE_KEY, normalized);
    window.dispatchEvent(new CustomEvent('ui-mode-changed', {
        detail: { mode: normalized }
    }));
    return normalized;
}

function normalizeKeyboardOnlyMode(value) {
    return value === true || value === 'true';
}

function applyKeyboardOnlyMode(enabled = false) {
    const normalized = normalizeKeyboardOnlyMode(enabled);
    document.body.classList.toggle('keyboard-only-mode', normalized);
    localStorage.setItem(KEYBOARD_ONLY_MODE_STORAGE_KEY, normalized ? 'true' : 'false');
    window.dispatchEvent(new CustomEvent('keyboard-only-mode-changed', {
        detail: { enabled: normalized }
    }));
    return normalized;
}

function rememberProfilesEnabled() {
    const saved = localStorage.getItem(REMEMBER_ME_KEY);
    return saved === null ? true : saved === 'true';
}

function safeReadJsonArray(key) {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function safeWriteJsonArray(key, value) {
    localStorage.setItem(key, JSON.stringify(Array.isArray(value) ? value : []));
}

function syncRememberedAuthProfile(user, token) {
    if (!user?.username || !rememberProfilesEnabled()) return;

    const now = new Date().toISOString();
    localStorage.setItem(LAST_LOGIN_USER_KEY, user.username);

    const knownUsers = safeReadJsonArray(KNOWN_USERS_KEY)
        .filter(entry => entry?.username && entry.username !== user.username);
    knownUsers.unshift({ username: user.username, lastUsedAt: now });
    safeWriteJsonArray(KNOWN_USERS_KEY, knownUsers.slice(0, 6));

    if (token) {
        const savedProfiles = safeReadJsonArray(SAVED_LOGINS_KEY)
            .filter(entry => entry?.username && entry.username !== user.username);
        savedProfiles.unshift({ username: user.username, token, lastUsedAt: now });
        safeWriteJsonArray(SAVED_LOGINS_KEY, savedProfiles.slice(0, 6));
    }
}

window.DEFAULT_THEME_COLORS = DEFAULT_THEME_COLORS;
window.THEME_COLORS_STORAGE_KEY = THEME_COLORS_STORAGE_KEY;
window.applyThemeColors = applyThemeColors;
window.applyInterfaceMode = applyInterfaceMode;
window.applyKeyboardOnlyMode = applyKeyboardOnlyMode;

function loadThemeFromLocalStorage() {
    try {
        const raw = localStorage.getItem(THEME_COLORS_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        applyThemeColors(parsed);
    } catch {
        // ignore malformed local theme cache
    }
}

function isBackgroundRequest(input, init) {
    const readHeader = (headers, name) => {
        if (!headers) return null;
        if (typeof Headers !== 'undefined' && headers instanceof Headers) {
            return headers.get(name);
        }
        if (Array.isArray(headers)) {
            const match = headers.find(([headerName]) => String(headerName).toLowerCase() === name.toLowerCase());
            return match ? match[1] : null;
        }
        if (typeof headers === 'object') {
            const key = Object.keys(headers).find(headerName => headerName.toLowerCase() === name.toLowerCase());
            return key ? headers[key] : null;
        }
        return null;
    };

    const headerValue = readHeader(typeof input === 'object' ? input?.headers : null, 'X-Background-Request')
        || readHeader(init?.headers, 'X-Background-Request');
    return String(headerValue || '').toLowerCase() === 'true';
}

function shouldTrackRequest(input, init) {
    try {
        const rawUrl = typeof input === 'string' ? input : input?.url;
        if (!rawUrl) return false;

        if (isBackgroundRequest(input, init)) {
            return false;
        }

        const url = new URL(rawUrl, window.location.origin);
        const path = url.pathname;

        // Track API work by default, but exclude high-frequency media stream routes
        // to avoid a permanently visible indicator during playback.
        if (!path.startsWith('/api/')) return false;

        const excludedPrefixes = [
            '/api/transcode',
            '/api/remux',
            '/api/subtitle',
            '/api/proxy/stream'
        ];

        if (excludedPrefixes.some(prefix => path.startsWith(prefix))) {
            return false;
        }

        if (path.includes('/proxy/xtream/') && path.includes('/stream/')) {
            return false;
        }

        return true;
    } catch {
        return false;
    }
}

function installGlobalActivityTracker() {
    const indicator = document.getElementById('global-activity-indicator');
    if (!indicator) return;

    let pendingCount = 0;
    let hideTimer = null;

    const show = () => {
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
        indicator.classList.add('active');
        indicator.setAttribute('aria-hidden', 'false');
    };

    const hide = () => {
        if (hideTimer) {
            clearTimeout(hideTimer);
        }
        // Small delay to reduce flicker for very short requests.
        hideTimer = setTimeout(() => {
            if (pendingCount === 0) {
                indicator.classList.remove('active');
                indicator.setAttribute('aria-hidden', 'true');
            }
        }, 180);
    };

    const begin = () => {
        pendingCount += 1;
        show();
    };

    const end = () => {
        pendingCount = Math.max(0, pendingCount - 1);
        if (pendingCount === 0) {
            hide();
        }
    };

    const originalFetch = window.fetch.bind(window);
    window.fetch = (...args) => {
        const track = shouldTrackRequest(args[0], args[1]);
        if (track) begin();

        return originalFetch(...args)
            .finally(() => {
                if (track) end();
            });
    };
}

class App {
    constructor() {
        this.currentPage = 'welcome';
        this.pages = {};
        this.currentUser = null;
        this.diagnosticsClientId = localStorage.getItem('diagnosticsClientId') || `client-${Math.random().toString(36).slice(2, 12)}`;
        this.diagnosticsSessionName = localStorage.getItem('diagnosticsSessionName') || '';
        this.diagnosticsTimer = null;
        this.keyboardOnlyMode = false;
        this.keyboardNavSectionIndex = 0;
        this.keyboardNavItemIndex = 0;
        this.keyboardNavSections = [];
        this.pageMenuToggle = null;
        this.pageMenu = null;
        this.pageMenuOverlay = null;
        this.handleKeyboardOnlyNavigation = this.handleKeyboardOnlyNavigation.bind(this);
        this.syncKeyboardOnlyModeFromEvent = this.syncKeyboardOnlyModeFromEvent.bind(this);

        localStorage.setItem('diagnosticsClientId', this.diagnosticsClientId);

        // Initialize components
        this.player = new VideoPlayer();
        this.channelList = new ChannelList();
        this.sourceManager = new SourceManager();
        this.epgGuide = new EpgGuide();

        // Initialize page controllers
        this.pages.welcome = new WelcomePage(this);
        this.pages.home = new HomePage(this);
        this.pages.live = new LivePage(this);
        this.pages.guide = new GuidePage(this);
        this.pages.movies = new MoviesPage(this);
        this.pages.series = new SeriesPage(this);
        this.pages.settings = new SettingsPage(this);
        this.pages.watch = new WatchPage(this);

        this.init();
    }

    async init() {
        // Check authentication first
        await this.checkAuth();

        if (this.currentUser?.username) {
            this.diagnosticsSessionName = this.currentUser.username;
            localStorage.setItem('diagnosticsSessionName', this.diagnosticsSessionName);
        }

        await this.loadAndApplyThemeFromServer();

        this.installKeyboardOnlyNavigation();

        this.initPageMenu();

        // Channel drawer toggle (mobile)
        const channelToggleBtn = document.getElementById('channel-toggle-btn');
        const channelSidebar = document.getElementById('channel-sidebar');
        const channelOverlay = document.getElementById('channel-sidebar-overlay');

        if (channelToggleBtn && channelSidebar && channelOverlay) {
            const toggleChannelDrawer = () => {
                channelSidebar.classList.toggle('active');
                channelOverlay.classList.toggle('active');
            };

            channelToggleBtn.addEventListener('click', toggleChannelDrawer);
            channelOverlay.addEventListener('click', toggleChannelDrawer);

            // Close drawer when a channel is selected
            channelSidebar.addEventListener('click', (e) => {
                if (e.target.closest('.channel-item')) {
                    // Small delay to let the channel selection happen
                    setTimeout(() => {
                        channelSidebar.classList.remove('active');
                        channelOverlay.classList.remove('active');
                    }, 300);
                }
            });
        }

        // Desktop sidebar collapse toggle
        const sidebarCollapseBtn = document.getElementById('sidebar-collapse-btn');
        const sidebarExpandBtn = document.getElementById('sidebar-expand-btn');
        const homeLayout = document.querySelector('.home-layout');

        const toggleSidebarCollapse = () => {
            channelSidebar?.classList.toggle('collapsed');
            homeLayout?.classList.toggle('sidebar-collapsed');

            // Persist preference
            const isCollapsed = channelSidebar?.classList.contains('collapsed');
            localStorage.setItem('sidebarCollapsed', isCollapsed ? 'true' : 'false');
        };

        sidebarCollapseBtn?.addEventListener('click', toggleSidebarCollapse);
        sidebarExpandBtn?.addEventListener('click', toggleSidebarCollapse);

        // Restore sidebar state from localStorage
        if (localStorage.getItem('sidebarCollapsed') === 'true') {
            channelSidebar?.classList.add('collapsed');
            homeLayout?.classList.add('sidebar-collapsed');
        }

        // Navigation handling
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.navigateTo(link.dataset.page);
                this.closePageMenu();
            });
        });

        // Now Playing indicator
        const nowPlayingBtn = document.getElementById('now-playing-indicator');
        if (nowPlayingBtn) {
            nowPlayingBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.navigateTo('watch');
            });
        }

        // Toggle groups button
        document.getElementById('toggle-groups').addEventListener('click', () => {
            this.channelList.toggleAllGroups();
        });

        // Search clear buttons (global handler for all)
        document.querySelectorAll('.search-clear').forEach(btn => {
            btn.addEventListener('click', () => {
                const wrapper = btn.closest('.search-wrapper');
                const input = wrapper?.querySelector('.search-input');
                if (input) {
                    input.value = '';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.focus();
                }
            });
        });

        // Handle browser back/forward buttons
        window.addEventListener('popstate', (e) => {
            const page = e.state?.page || 'home';
            this.navigateTo(page, false); // false = don't add to history
        });

        // Initialize home page first (it's needed for channel list)
        await this.pages.home.init();

        // Preload EPG data in background (non-blocking)
        // This ensures EPG info is available on Live TV page without visiting Guide first
        this.epgGuide.loadEpg(false, { background: true, preserveExisting: true }).catch(err => {
            console.warn('Background EPG load failed:', err.message);
        });

        // Navigate to the page from URL hash, or default to home
        const hash = window.location.hash.slice(1); // Remove #
        const initialPage = hash && this.pages[hash] ? hash : 'home';
        this.navigateTo(initialPage, true); // true = replace history (don't add)

        this.startDiagnosticsHeartbeat();

        console.log('CalibreViewer initialized');
    }

    installKeyboardOnlyNavigation() {
        this.keyboardOnlyMode = document.body.classList.contains('keyboard-only-mode');
        window.addEventListener('keyboard-only-mode-changed', this.syncKeyboardOnlyModeFromEvent);
        document.addEventListener('keydown', this.handleKeyboardOnlyNavigation, true);

        if (this.keyboardOnlyMode) {
            this.resetKeyboardFocus();
        }
    }

    syncKeyboardOnlyModeFromEvent(event) {
        this.keyboardOnlyMode = !!event?.detail?.enabled;
        if (this.keyboardOnlyMode) {
            this.resetKeyboardFocus();
        } else {
            this.clearKeyboardFocusStyles();
        }
    }

    isTypingTarget(target) {
        if (!target) return false;
        const tag = target.tagName;
        return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    }

    clearKeyboardFocusStyles() {
        document.querySelectorAll('.keyboard-nav-focus').forEach(el => el.classList.remove('keyboard-nav-focus'));
    }

    getFocusableElements(container) {
        if (!container) return [];

        return Array.from(container.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(el => {
            if (!el) return false;
            if (el.closest('.hidden')) return false;
            if (el.closest('.page') && !el.closest('.page').classList.contains('active')) return false;
            if (el.offsetParent === null && el !== document.activeElement) return false;
            return true;
        });
    }

    getKeyboardSections() {
        const activePage = document.querySelector('.page.active');
        const sectionSelectors = [
            '#navbar-menu',
            '.home-layout .sidebar-header',
            '.home-layout #channel-list',
            '.home-layout .player-section',
            '#page-guide .guide-controls',
            '#page-guide #epg-grid',
            '#page-movies .movies-controls',
            '#page-movies #movies-grid',
            '#page-series .series-controls',
            '#page-series #series-grid',
            '#page-settings .tabs',
            '#page-settings .tab-content.active',
            '#page-watch .watch-top-bar',
            '#page-watch .watch-bottom-bar',
            '#page-watch #watch-details'
        ];

        const sections = sectionSelectors
            .map(selector => document.querySelector(selector))
            .filter(Boolean)
            .filter(section => {
                const page = section.closest('.page');
                if (!page) return true;
                return page.classList.contains('active') || page === activePage;
            })
            .filter(section => this.getFocusableElements(section).length > 0);

        return sections;
    }

    focusKeyboardNavTarget(sectionIndex, itemIndex) {
        this.keyboardNavSections = this.getKeyboardSections();
        if (!this.keyboardNavSections.length) {
            this.clearKeyboardFocusStyles();
            return;
        }

        this.keyboardNavSectionIndex = Math.max(0, Math.min(sectionIndex, this.keyboardNavSections.length - 1));
        const section = this.keyboardNavSections[this.keyboardNavSectionIndex];
        const items = this.getFocusableElements(section);

        if (!items.length) return;

        this.keyboardNavItemIndex = Math.max(0, Math.min(itemIndex, items.length - 1));
        const target = items[this.keyboardNavItemIndex];
        if (!target) return;

        this.clearKeyboardFocusStyles();
        target.classList.add('keyboard-nav-focus');
        target.focus({ preventScroll: false });
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    moveKeyboardNavItem(delta) {
        const section = this.keyboardNavSections[this.keyboardNavSectionIndex];
        const items = this.getFocusableElements(section);
        if (!items.length) return;

        let nextIndex = this.keyboardNavItemIndex + delta;
        if (nextIndex < 0) nextIndex = items.length - 1;
        if (nextIndex >= items.length) nextIndex = 0;

        this.focusKeyboardNavTarget(this.keyboardNavSectionIndex, nextIndex);
    }

    moveKeyboardNavSection(delta) {
        const sections = this.getKeyboardSections();
        if (!sections.length) return;

        let nextSection = this.keyboardNavSectionIndex + delta;
        if (nextSection < 0) nextSection = sections.length - 1;
        if (nextSection >= sections.length) nextSection = 0;

        this.focusKeyboardNavTarget(nextSection, 0);
    }

    resetKeyboardFocus() {
        this.focusKeyboardNavTarget(0, 0);
    }

    handleKeyboardOnlyNavigation(event) {
        if (!this.keyboardOnlyMode) return;
        if (!document.hasFocus()) return;
        if (event.ctrlKey || event.altKey || event.metaKey) return;

        if (this.isTypingTarget(event.target) && event.key !== 'Escape') return;

        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.navigateTo('settings');
            this.resetKeyboardFocus();
            return;
        }

        if (event.key === 'Backspace') {
            event.preventDefault();
            event.stopImmediatePropagation();

            if (this.currentPage === 'watch') {
                this.pages.watch?.goBack?.();
                return;
            }

            if (this.currentPage === 'live') {
                this.player?.stop?.();
                this.navigateTo('home');
                this.resetKeyboardFocus();
                return;
            }

            history.back();
            return;
        }

        switch (event.key) {
            case 'Tab':
                event.preventDefault();
                event.stopImmediatePropagation();
                this.moveKeyboardNavSection(event.shiftKey ? -1 : 1);
                return;
            case 'ArrowLeft':
            case 'ArrowUp':
                event.preventDefault();
                event.stopImmediatePropagation();
                this.moveKeyboardNavItem(-1);
                return;
            case 'ArrowRight':
            case 'ArrowDown':
                event.preventDefault();
                event.stopImmediatePropagation();
                this.moveKeyboardNavItem(1);
                return;
            case 'Enter': {
                event.preventDefault();
                event.stopImmediatePropagation();
                const target = document.activeElement;
                if (target?.click) {
                    target.click();
                }
                return;
            }
            default:
                return;
        }
    }

    async loadAndApplyThemeFromServer() {
        try {
            const settings = await API.request('GET', '/settings', null, { background: true });
            if (settings?.themeColors) {
                applyThemeColors(settings.themeColors);
                localStorage.setItem(THEME_COLORS_STORAGE_KEY, JSON.stringify(settings.themeColors));
            }

            if (settings?.uiMode) {
                const normalizedMode = applyInterfaceMode(settings.uiMode);
                if (this.player?.settings) {
                    this.player.settings.uiMode = normalizedMode;
                }
            }

            if (typeof settings?.keyboardOnlyMode !== 'undefined') {
                const enabled = applyKeyboardOnlyMode(settings.keyboardOnlyMode === true);
                if (this.player?.settings) {
                    this.player.settings.keyboardOnlyMode = enabled;
                }
            }
        } catch (err) {
            console.warn('Failed to load theme settings from server:', err.message);
        }
    }

    async checkAuth() {
        // Support SSO/OIDC callback redirect pattern: /?token=<jwt>
        // Persist it to localStorage so the rest of the app can authenticate normally.
        try {
            const url = new URL(window.location.href);
            const tokenFromUrl = url.searchParams.get('token');
            if (tokenFromUrl) {
                localStorage.setItem('authToken', tokenFromUrl);
                url.searchParams.delete('token');
                window.history.replaceState(window.history.state, document.title, url.pathname + url.search + url.hash);
            }
        } catch (e) {
            console.warn('Failed to process SSO token from URL:', e);
        }

        const token = localStorage.getItem('authToken');

        if (!token) {
            // No token, redirect to login (replace to avoid back button issues)
            window.location.replace('/login.html');
            return;
        }

        try {
            // Verify token with server
            const response = await fetch('/api/auth/me', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Background-Request': 'true'
                }
            });

            if (!response.ok) {
                throw new Error('Invalid token');
            }

            this.currentUser = await response.json();
            syncRememberedAuthProfile(this.currentUser, token);

            // Hide settings for viewers
            if (this.currentUser.role === 'viewer') {
                const settingsLink = document.querySelector('.nav-link[data-page="settings"]');
                if (settingsLink) {
                    settingsLink.style.display = 'none';
                }
            }

            // Add logout button to navbar
            this.addLogoutButton();

        } catch (err) {
            console.error('Authentication error:', err);
            localStorage.removeItem('authToken');
            window.location.replace('/login.html');
        }
    }

    addLogoutButton() {
        const navbar = document.querySelector('.navbar-menu');
        if (!navbar || document.getElementById('logout-btn')) return;

        const logoutLink = document.createElement('a');
        logoutLink.href = '#';
        logoutLink.className = 'nav-link';
        logoutLink.id = 'logout-btn';
        logoutLink.innerHTML = `
            <span class="nav-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="icon">
                <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
            </svg></span>
            <span>Logout</span>
        `;

        logoutLink.addEventListener('click', async (e) => {
            e.preventDefault();

            const token = localStorage.getItem('authToken');
            if (token) {
                await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
            }

            localStorage.removeItem('authToken');
            this.stopDiagnosticsHeartbeat();
            window.location.replace('/login.html');
        });

        navbar.appendChild(logoutLink);
    }

    getPageDisplayName(pageName) {
        const names = {
            welcome: 'Welcome',
            home: 'Home',
            live: 'Live TV',
            guide: 'TV Guide',
            movies: 'Movies',
            series: 'Series',
            settings: 'Settings',
            watch: 'Now Playing'
        };

        return names[pageName] || 'Home';
    }

    initPageMenu() {
        this.pageMenuToggle = document.getElementById('page-menu-toggle');
        this.pageMenu = document.getElementById('navbar-menu');
        this.pageMenuOverlay = document.getElementById('nav-sidebar-overlay');

        if (!this.pageMenuToggle || !this.pageMenu || !this.pageMenuOverlay) return;

        this.pageMenuToggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.togglePageMenu();
        });

        // Delegated link handling keeps sidebar navigation reliable even if
        // individual listeners are missed during re-renders.
        this.pageMenu.addEventListener('click', (event) => {
            const link = event.target.closest('.nav-link[data-page]');
            if (!link) return;
            event.preventDefault();
            event.stopPropagation();
            this.navigateTo(link.dataset.page);
        });

        this.pageMenuOverlay.addEventListener('click', () => this.closePageMenu());

        document.addEventListener('click', (event) => {
            if (!this.pageMenu.classList.contains('active')) return;
            if (event.target.closest('#navbar-menu') || event.target.closest('#page-menu-toggle')) return;
            this.closePageMenu();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.pageMenu.classList.contains('active')) {
                this.closePageMenu();
            }
        });
    }

    togglePageMenu() {
        if (!this.pageMenu) return;
        if (this.pageMenu.classList.contains('active')) {
            this.closePageMenu();
            return;
        }
        this.openPageMenu();
    }

    openPageMenu() {
        if (!this.pageMenu || !this.pageMenuToggle || !this.pageMenuOverlay) return;
        this.pageMenu.classList.add('active');
        this.pageMenuOverlay.classList.add('active');
        this.pageMenuToggle.setAttribute('aria-expanded', 'true');
    }

    closePageMenu() {
        if (!this.pageMenu || !this.pageMenuToggle || !this.pageMenuOverlay) return;
        this.pageMenu.classList.remove('active');
        this.pageMenuOverlay.classList.remove('active');
        this.pageMenuToggle.setAttribute('aria-expanded', 'false');
    }

    navigateTo(pageName, replaceHistory = false) {
        // Don't navigate if already on this page
        if (this.currentPage === pageName && !replaceHistory) {
            return;
        }

        // Update browser history
        if (replaceHistory) {
            // Replace current history entry (used on initial load)
            history.replaceState({ page: pageName }, '', `#${pageName}`);
        } else {
            // Add new history entry
            history.pushState({ page: pageName }, '', `#${pageName}`);
        }

        // Update nav
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.toggle('active', link.dataset.page === pageName);
        });

        const currentPageLabel = document.getElementById('current-page-label');
        if (currentPageLabel) {
            currentPageLabel.textContent = this.getPageDisplayName(pageName);
        }

        // Update pages
        document.querySelectorAll('.page').forEach(page => {
            page.classList.toggle('active', page.id === `page-${pageName}`);
        });

        // Notify page controllers
        if (this.pages[this.currentPage]?.hide) {
            this.pages[this.currentPage].hide();
        }

        this.currentPage = pageName;

        if (this.pages[pageName]?.show) {
            this.pages[pageName].show();
        }

        this.closePageMenu();

        this.sendDiagnosticsHeartbeat({ immediate: true }).catch(() => {
            // ignore diagnostics heartbeat failures
        });

        if (this.keyboardOnlyMode) {
            requestAnimationFrame(() => this.resetKeyboardFocus());
        }
    }

    getPlaybackSnapshot() {
        const liveVideo = this.player?.video;
        const watchVideo = this.pages?.watch?.video;

        const liveActive = !!(liveVideo && this.currentPage === 'live' && this.player?.currentChannel);
        const watchActive = !!(watchVideo && this.currentPage === 'watch' && this.pages?.watch?.content);

        const liveState = liveVideo ? {
            paused: !!liveVideo.paused,
            muted: !!liveVideo.muted,
            volume: Number(liveVideo.volume ?? 0),
            readyState: Number(liveVideo.readyState ?? 0),
            currentTime: Number(liveVideo.currentTime ?? 0),
            channelName: this.player?.currentChannel?.name || null
        } : null;

        const watchState = watchVideo ? {
            paused: !!watchVideo.paused,
            muted: !!watchVideo.muted,
            volume: Number(watchVideo.volume ?? 0),
            readyState: Number(watchVideo.readyState ?? 0),
            currentTime: Number(watchVideo.currentTime ?? 0),
            title: this.pages?.watch?.content?.name || this.pages?.watch?.content?.title || null
        } : null;

        return {
            mode: watchActive ? 'vod' : (liveActive ? 'live' : 'idle'),
            live: liveState,
            vod: watchState
        };
    }

    async sendDiagnosticsHeartbeat({ immediate = false } = {}) {
        if (!this.currentUser) return;

        await API.diagnostics.heartbeat({
            clientId: this.diagnosticsClientId,
            sessionName: this.diagnosticsSessionName || this.currentUser.username,
            page: this.currentPage,
            appVersion: document.getElementById('version-badge')?.textContent?.replace(/^v/, '') || null,
            playback: this.getPlaybackSnapshot(),
            clientInfo: {
                userAgent: navigator.userAgent,
                platform: navigator.platform || null,
                language: navigator.language || null,
                viewport: `${window.innerWidth}x${window.innerHeight}`
            },
            diagnostics: {
                online: navigator.onLine,
                timestamp: new Date().toISOString(),
                immediate
            }
        }, { background: true });
    }

    startDiagnosticsHeartbeat() {
        this.stopDiagnosticsHeartbeat();

        this.sendDiagnosticsHeartbeat({ immediate: true }).catch(() => {
            // ignore diagnostics heartbeat failures
        });

        this.diagnosticsTimer = setInterval(() => {
            this.sendDiagnosticsHeartbeat().catch(() => {
                // ignore diagnostics heartbeat failures
            });
        }, 10000);
    }

    stopDiagnosticsHeartbeat() {
        if (this.diagnosticsTimer) {
            clearInterval(this.diagnosticsTimer);
            this.diagnosticsTimer = null;
        }
    }
}

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    loadThemeFromLocalStorage();
    applyInterfaceMode(localStorage.getItem(UI_MODE_STORAGE_KEY) || 'desktop');
    applyKeyboardOnlyMode(localStorage.getItem(KEYBOARD_ONLY_MODE_STORAGE_KEY) || 'false');
    installGlobalActivityTracker();
    window.app = new App();

    // Fetch and display version badge
    fetch('/api/version', {
        headers: {
            'X-Background-Request': 'true'
        }
    })
        .then(res => res.json())
        .then(data => {
            const badge = document.getElementById('version-badge');
            if (badge && data.version) badge.textContent = `v${data.version}`;
        })
        .catch(() => { });
});
