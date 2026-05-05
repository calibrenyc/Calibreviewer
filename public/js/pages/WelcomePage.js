/**
 * Welcome Page Controller
 */

class WelcomePage {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('page-welcome');
        this.initialized = false;
    }

    async init() {
        if (!this.container || this.initialized) return;
        this.initialized = true;

        const userName = this.app?.currentUser?.username || 'there';

        this.container.innerHTML = `
            <section class="welcome-hero">
                <div class="welcome-layer welcome-layer-a"></div>
                <div class="welcome-layer welcome-layer-b"></div>
                <div class="welcome-content">
                    <p class="welcome-kicker">CalibreViewer Premium</p>
                    <h1 class="welcome-title">Welcome, ${this.escapeHtml(userName)}</h1>
                    <p class="welcome-subtitle">Your library, your live channels, your control panel. Ready when you are.</p>
                    <div class="welcome-actions">
                        <button class="btn btn-primary" id="welcome-go-live">Start Live TV</button>
                        <button class="btn btn-secondary" id="welcome-go-movies">Browse Movies</button>
                        <button class="btn btn-ghost" id="welcome-go-settings">Open Settings</button>
                    </div>
                </div>
            </section>
            <section class="welcome-grid">
                <article class="welcome-card">
                    <h3>Client Insight</h3>
                    <p>Open Manage Content to view active client snapshots for diagnostics.</p>
                </article>
                <article class="welcome-card">
                    <h3>Portable Content</h3>
                    <p>Export your full content pack and import it on another user in seconds.</p>
                </article>
                <article class="welcome-card">
                    <h3>Faster Support</h3>
                    <p>Use diagnostics to see what each user is viewing and where they are in the app.</p>
                </article>
            </section>
        `;

        this.container.querySelector('#welcome-go-live')?.addEventListener('click', () => this.app.navigateTo('live'));
        this.container.querySelector('#welcome-go-movies')?.addEventListener('click', () => this.app.navigateTo('movies'));
        this.container.querySelector('#welcome-go-settings')?.addEventListener('click', () => this.app.navigateTo('settings'));
    }

    escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async show() {
        await this.init();
    }

    hide() {
        // no-op
    }
}

window.WelcomePage = WelcomePage;
