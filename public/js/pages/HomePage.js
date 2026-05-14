/**
 * Home Dashboard Page
 * Features "Continue Watching" and "Recently Added" content
 */
class HomePage {
    constructor(app) {
        this.app = app;
        this.container = null; // Will be set in renderLayout
        this.isLoading = false;
    }

    async init() {
        // Initialization if needed
    }

    async show() {
        this.renderLayout();
        await Promise.all([
            this.renderHeroBanner(),
            this.loadDashboardData()
        ]);
    }

    hide() {
        // Cleanup if needed
        this._destroyHero();
        if (this.container) {
            this.container.innerHTML = '';
        }
    }

    renderLayout() {
        const pageHome = document.getElementById('page-home');
        if (!pageHome) return;

        pageHome.innerHTML = `
            <div class="hero-banner" id="hero-banner">
                <button class="hero-arrow hero-arrow-prev" aria-label="Previous">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
                </button>
                <button class="hero-arrow hero-arrow-next" aria-label="Next">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                </button>
                <div class="hero-dots" id="hero-dots"></div>
            </div>
            <div class="dashboard-content" id="home-content">
                <section class="dashboard-section" id="favorite-channels-section">
                    <div class="section-header">
                        <h2>Your Favorites</h2>
                    </div>
                    <div class="scroll-wrapper">
                        <button class="scroll-arrow scroll-left" aria-label="Scroll left">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
                        </button>
                        <div class="horizontal-scroll channel-tiles" id="favorite-channels-list">
                            <div class="loading-state">
                                <div class="loading"></div>
                                <span>Loading your favorites...</span>
                            </div>
                        </div>
                        <button class="scroll-arrow scroll-right" aria-label="Scroll right">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                        </button>
                    </div>
                </section>

                <section class="dashboard-section" id="recent-movies-section">
                    <div class="section-header">
                        <h2>New Movies Added</h2>
                    </div>
                    <div class="scroll-wrapper">
                        <button class="scroll-arrow scroll-left" aria-label="Scroll left">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
                        </button>
                        <div class="horizontal-scroll" id="recent-movies-list">
                            <div class="loading-state">
                                <div class="loading"></div>
                                <span>Loading new movies...</span>
                            </div>
                        </div>
                        <button class="scroll-arrow scroll-right" aria-label="Scroll right">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                        </button>
                    </div>
                </section>

                <section class="dashboard-section" id="continue-watching-section">
                    <div class="section-header">
                        <h2>Continue Watching</h2>
                    </div>
                    <div class="scroll-wrapper">
                        <button class="scroll-arrow scroll-left" aria-label="Scroll left">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
                        </button>
                        <div class="horizontal-scroll" id="continue-watching-list">
                            <div class="loading-state">
                                <div class="loading"></div>
                                <span>Loading continue watching...</span>
                            </div>
                        </div>
                        <button class="scroll-arrow scroll-right" aria-label="Scroll right">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                        </button>
                    </div>
                </section>
            </div>
        `;
        this.container = document.getElementById('home-content');

        // Attach scroll arrow handlers
        this.initScrollArrows();
    }

    initScrollArrows() {
        this.container.querySelectorAll('.scroll-wrapper').forEach(wrapper => {
            const scrollContainer = wrapper.querySelector('.horizontal-scroll');
            const leftBtn = wrapper.querySelector('.scroll-left');
            const rightBtn = wrapper.querySelector('.scroll-right');

            if (!scrollContainer || !leftBtn || !rightBtn) return;

            const scrollAmount = 300; // pixels to scroll per click

            leftBtn.addEventListener('click', () => {
                scrollContainer.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
            });

            rightBtn.addEventListener('click', () => {
                scrollContainer.scrollBy({ left: scrollAmount, behavior: 'smooth' });
            });

            // Update arrow visibility based on scroll position
            const updateArrows = () => {
                const { scrollLeft, scrollWidth, clientWidth } = scrollContainer;
                leftBtn.classList.toggle('hidden', scrollLeft <= 0);
                rightBtn.classList.toggle('hidden', scrollLeft + clientWidth >= scrollWidth - 5);
            };

            // Store reference for later updates
            wrapper._updateArrows = updateArrows;

            scrollContainer.addEventListener('scroll', updateArrows);
            // Initial check after content loads
            setTimeout(updateArrows, 100);
        });
    }

    /**
     * Re-check scroll arrow visibility for all sections
     * Call this after dynamically loading content
     */
    updateScrollArrows() {
        this.container?.querySelectorAll('.scroll-wrapper').forEach(wrapper => {
            if (wrapper._updateArrows) {
                wrapper._updateArrows();
            }
        });
    }

    _destroyHero() {
        if (this._heroTimer) { clearInterval(this._heroTimer); this._heroTimer = null; }
        this._heroItems = null;
        this._heroIndex = 0;
    }

    async renderHeroBanner() {
        this._destroyHero();
        const banner = document.getElementById('hero-banner');
        if (!banner) return;

        let items = [];
        try {
            const [movies, series] = await Promise.all([
                window.API.request('GET', '/channels/recent?type=movie&limit=6').catch(() => []),
                window.API.request('GET', '/channels/recent?type=series&limit=6').catch(() => [])
            ]);
            // Interleave: movie, series, movie, series...
            const m = Array.isArray(movies) ? movies : [];
            const s = Array.isArray(series) ? series : [];
            const maxLen = Math.max(m.length, s.length);
            for (let i = 0; i < maxLen; i++) {
                if (m[i]) items.push({ ...m[i], _heroType: 'movie' });
                if (s[i]) items.push({ ...s[i], _heroType: 'series' });
            }
            items = items.slice(0, 10);
        } catch (e) {
            console.warn('[Hero] Failed to load hero items', e);
        }

        if (!items.length) {
            banner.style.display = 'none';
            return;
        }

        this._heroItems = items;
        this._heroIndex = 0;

        // Build slides
        items.forEach((item, idx) => {
            const data = item.data || {};
            const poster = item.stream_icon || data.poster || data.cover || '';
            const bgUrl = poster.startsWith('http') ? `/api/proxy/image?url=${encodeURIComponent(poster)}` : poster;
            const title = item.name || data.title || 'Unknown';
            const plot = data.plot || data.description || '';
            const year = data.releaseDate || data.year || '';
            const rating = data.rating || data.rating_5based ? `★ ${parseFloat(data.rating_5based || data.rating || 0).toFixed(1)}` : '';
            const typeLabel = item._heroType === 'movie' ? 'MOVIE' : 'SERIES';

            const slide = document.createElement('div');
            slide.className = 'hero-slide' + (idx === 0 ? ' active' : '');
            slide.dataset.idx = idx;
            slide.innerHTML = `
                <div class="hero-slide-bg" style="background-image: url('${bgUrl}')"></div>
                <div class="hero-content">
                    <div class="hero-badge">${typeLabel}</div>
                    <div class="hero-title">${title}</div>
                    ${(year || rating) ? `<div class="hero-meta">${year ? `<span>${year}</span>` : ''}${rating ? `<span>${rating}</span>` : ''}</div>` : ''}
                    ${plot ? `<div class="hero-plot">${plot}</div>` : ''}
                    <div class="hero-actions">
                        <button class="hero-btn hero-btn-play" data-idx="${idx}">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                            Play
                        </button>
                        <button class="hero-btn hero-btn-info" data-idx="${idx}">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                            More Info
                        </button>
                    </div>
                </div>
            `;
            banner.insertBefore(slide, banner.querySelector('.hero-arrow-prev'));
        });

        // Build dots
        const dotsEl = document.getElementById('hero-dots');
        if (dotsEl) {
            dotsEl.innerHTML = items.map((_, idx) =>
                `<button class="hero-dot${idx === 0 ? ' active' : ''}" data-idx="${idx}" aria-label="Slide ${idx + 1}"></button>`
            ).join('');
            dotsEl.querySelectorAll('.hero-dot').forEach(dot => {
                dot.addEventListener('click', () => this._heroGoTo(parseInt(dot.dataset.idx)));
            });
        }

        // Arrow controls
        banner.querySelector('.hero-arrow-prev')?.addEventListener('click', () => {
            this._heroGoTo((this._heroIndex - 1 + this._heroItems.length) % this._heroItems.length);
        });
        banner.querySelector('.hero-arrow-next')?.addEventListener('click', () => {
            this._heroGoTo((this._heroIndex + 1) % this._heroItems.length);
        });

        // Play / info buttons
        banner.addEventListener('click', e => {
            const playBtn = e.target.closest('.hero-btn-play');
            const infoBtn = e.target.closest('.hero-btn-info');
            if (!playBtn && !infoBtn) return;
            const idx = parseInt((playBtn || infoBtn).dataset.idx);
            const item = this._heroItems[idx];
            if (!item) return;
            if (playBtn) { this.playItem(item); }
            else { this._heroShowInfo(item); }
        });

        // Auto-advance
        this._heroTimer = setInterval(() => {
            if (document.hidden) return;
            this._heroGoTo((this._heroIndex + 1) % this._heroItems.length);
        }, 7000);
    }

    _heroGoTo(idx) {
        if (!this._heroItems) return;
        const banner = document.getElementById('hero-banner');
        if (!banner) return;

        banner.querySelectorAll('.hero-slide').forEach(s => s.classList.remove('active'));
        banner.querySelectorAll('.hero-dot').forEach(d => d.classList.toggle('active', parseInt(d.dataset.idx) === idx));

        const target = banner.querySelector(`.hero-slide[data-idx="${idx}"]`);
        if (target) target.classList.add('active');
        this._heroIndex = idx;
    }

    _heroShowInfo(item) {
        const type = item._heroType;
        if (type === 'series') {
            this.navigateToSeries(item);
        } else {
            // For movies just play — a detail view isn't wired yet
            this.playItem(item);
        }
    }




    async loadDashboardData() {
        if (this.isLoading) return;
        this.isLoading = true;

        try {
            // 0. Load Favorite Channels (first section)
            await this.renderFavoriteChannels();

            // 1. Load Recently Added Movies
            await this.renderRecentMovies();

            // 2. Load Watch History (series progress naturally appears here)
            const history = await window.API.request('GET', '/history?limit=12');
            if (history && Array.isArray(history)) {
                this.renderHistory(history);
            } else {
                this.renderHistory([]);
            }

        } catch (err) {
            console.error('[Dashboard] Error loading data:', err);
        } finally {
            this.isLoading = false;
        }
    }

    async renderFavoriteChannels() {
        const list = document.getElementById('favorite-channels-list');
        const section = document.getElementById('favorite-channels-section');
        if (!list || !section) return;

        try {
            // Fetch favorite channels for current user
            const favorites = await window.API.request('GET', '/favorites?itemType=channel');

            if (!favorites || favorites.length === 0) {
                list.innerHTML = '<div class="empty-state hint">Add channels to favorites from Live TV</div>';
                return;
            }

            // Ensure channel list is loaded to resolve channel details
            const channelList = this.app.channelList;
            if (!channelList.channels || channelList.channels.length === 0) {
                await channelList.loadSources();
                await channelList.loadChannels();
            }

            // Match favorites to channel data
            const channels = [];
            for (const fav of favorites) {
                // Find channel in loaded channel list
                const channel = channelList.channels.find(ch =>
                    String(ch.sourceId) === String(fav.source_id) &&
                    (String(ch.id) === String(fav.item_id) || String(ch.streamId) === String(fav.item_id))
                );
                if (channel) {
                    channels.push({ ...channel, favoriteId: fav.id });
                }
            }

            if (channels.length === 0) {
                list.innerHTML = '<div class="empty-state hint">Add channels to favorites from Live TV</div>';
                return;
            }

            // Render channel tiles
            list.innerHTML = channels.map(ch => this.createChannelTile(ch)).join('');

            // Attach click handlers
            list.querySelectorAll('.channel-tile').forEach(tile => {
                tile.addEventListener('click', () => {
                    const channelId = tile.dataset.channelId;
                    const sourceId = tile.dataset.sourceId;
                    this.playChannel(channelId, sourceId);
                });
            });

            // Update scroll arrows after content renders
            this.updateScrollArrows();

        } catch (err) {
            console.error('[Dashboard] Error loading favorite channels:', err);
            list.innerHTML = '<div class="empty-state hint">Error loading favorites</div>';
        }
    }

    createChannelTile(channel) {
        const logo = channel.tvgLogo || '/img/placeholder.png';
        const logoUrl = logo.startsWith('http') ? `/api/proxy/image?url=${encodeURIComponent(logo)}` : logo;
        const name = channel.name || 'Unknown';

        return `
            <div class="channel-tile" data-channel-id="${channel.id}" data-source-id="${channel.sourceId}">
                <div class="tile-logo">
                    <img src="${logoUrl}" alt="${name}" loading="lazy" onerror="this.onerror=null;this.src='/img/placeholder.png'">
                </div>
                <div class="tile-name" title="${name}">${name}</div>
            </div>
        `;
    }

    playChannel(channelId, sourceId) {
        // Navigate to Live TV and select the channel
        this.app.navigateTo('live');

        // Small delay to ensure page is ready
        setTimeout(() => {
            const channelList = this.app.channelList;
            if (channelList) {
                // Find and select the channel
                const channel = channelList.channels.find(ch =>
                    String(ch.id) === String(channelId) && String(ch.sourceId) === String(sourceId)
                );
                if (channel) {
                    channelList.selectChannel({
                        channelId: channel.id,
                        sourceId: channel.sourceId,
                        sourceType: channel.sourceType,
                        streamId: channel.streamId || '',
                        url: channel.url || ''
                    });
                }
            }
        }, 100);
    }

    renderHistory(items) {
        const list = document.getElementById('continue-watching-list');
        const section = document.getElementById('continue-watching-section');

        if (!list || !section) return;

        if (items.length === 0) {
            section.classList.remove('hidden');
            list.innerHTML = '<div class="empty-state hint">Start a movie or series to keep watching from where you left off</div>';
            return;
        }

        section.classList.remove('hidden');
        const prioritized = [...items].sort((a, b) => {
            const aType = String(a.item_type || a.type || '').toLowerCase();
            const bType = String(b.item_type || b.type || '').toLowerCase();
            const aSeriesScore = (aType === 'series' || aType === 'episode') ? 1 : 0;
            const bSeriesScore = (bType === 'series' || bType === 'episode') ? 1 : 0;
            return bSeriesScore - aSeriesScore;
        });

        list.innerHTML = prioritized.map(item => this.createCard(item)).join('');

        // Attach click listeners
        list.querySelectorAll('.dashboard-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.dataset.id;
                    const item = prioritized.find(i => i.item_id === id);
                if (item) {
                    const type = item.item_type || item.type;

                    // IF it's a series, checking details is better than blind resume
                    // BUT for "Continue Watching", we ideally want to resume

                    // Prioritize playing directly for resume tiles
                    this.playItem(item, true); // true for resume
                }
            });
        });

        // Update scroll arrows after content renders
        this.updateScrollArrows();
    }

    navigateToSeries(item) {
        if (!this.app.pages.series) return;

        // Prepare the series object as expected by SeriesPage.showSeriesDetails
        const series = {
            series_id: item.item_id,
            sourceId: item.source_id,
            name: item.name || (item.data ? item.data.title : 'Series'),
            cover: item.stream_icon || (item.data ? item.data.poster : null),
            plot: item.data ? item.data.description : '',
            year: item.data ? item.data.year : ''
        };

        // Switch page
        this.app.navigateTo('series');

        // Show details (delay slightly to ensure page is visible)
        setTimeout(() => {
            this.app.pages.series.showSeriesDetails(series);
        }, 100);
    }

    async renderRecentMovies() {
        const list = document.getElementById('recent-movies-list');
        if (!list) return;

        try {
            const movies = await window.API.request('GET', '/channels/recent?type=movie&limit=12');
            if (!movies || movies.length === 0) {
                list.innerHTML = '<div class="empty-state hint">No recently added movies found</div>';
                return;
            }

            list.innerHTML = movies.map(item => this.createRecentCard(item)).join('');

            // Attach listeners
            list.querySelectorAll('.dashboard-card').forEach(card => {
                card.addEventListener('click', () => {
                    const id = card.dataset.id;
                    const item = movies.find(m => m.item_id === id);
                    if (item) this.playItem(item);
                });
            });

            // Update scroll arrows after content renders
            this.updateScrollArrows();
        } catch (err) {
            console.error('[Dashboard] Error loading recent movies:', err);
        }
    }

    createCard(item) {
        const { data, progress, duration, item_id } = item;
        const type = item.item_type || item.type;
        const percent = Math.min(100, Math.round((progress / duration) * 100));

        // Proxy the poster if it's an external URL
        const poster = data.poster || '/img/poster-placeholder.jpg';
        const posterUrl = poster.startsWith('http') ? `/api/proxy/image?url=${encodeURIComponent(poster)}` : poster;

        return `
            <div class="dashboard-card" data-id="${item_id}" data-type="${type}">
                <div class="card-image">
                    <img src="${posterUrl}" alt="${data.title || item.name}" loading="lazy" onerror="this.onerror=null;this.src='/img/poster-placeholder.jpg'">
                    <div class="progress-bar-container">
                        <div class="progress-bar" style="width: ${percent}%"></div>
                    </div>
                    <div class="play-icon-overlay">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                </div>
                <div class="card-info">
                    <div class="card-title" title="${item.name || data.title}">${item.name || data.title || 'Unknown Title'}</div>
                    <div class="card-subtitle">${data.subtitle || (type === 'movie' ? 'Movie' : 'Series')}</div>
                </div>
            </div>
        `;
    }

    createRecentCard(item) {
        const { data, item_id } = item;
        const type = item.type || item.item_type;
        const poster = item.stream_icon || data.poster || '/img/poster-placeholder.jpg';
        const posterUrl = poster.startsWith('http') ? `/api/proxy/image?url=${encodeURIComponent(poster)}` : poster;

        return `
            <div class="dashboard-card" data-id="${item_id}" data-type="${type}">
                <div class="card-image">
                    <img src="${posterUrl}" alt="${item.name}" loading="lazy" onerror="this.onerror=null;this.src='/img/poster-placeholder.jpg'">
                    <div class="play-icon-overlay">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                </div>
                <div class="card-info">
                    <div class="card-title" title="${item.name || (data && data.title)}">${item.name || (data && data.title) || 'Unknown Title'}</div>
                    <div class="card-subtitle">${(data && data.subtitle) || (type === 'movie' ? 'Movie' : 'Series')}</div>
                </div>
            </div>
        `;
    }

    async playItem(item, isResume = false) {
        if (!this.app.pages.watch) return;

        try {
            const type = item.item_type || item.type;
            const streamType = type === 'movie' ? 'movie' : 'series';
            const sourceId = item.source_id || (item.data && item.data.sourceId);
            const streamId = item.item_id;
            const container = item.container_extension || (item.data && item.data.containerExtension) || 'mp4';

            const result = await window.API.request('GET', `/proxy/xtream/${sourceId}/stream/${streamId}/${streamType}?container=${container}`);

            if (result && result.url) {
                const content = {
                    id: item.item_id,
                    type: type,
                    title: item.name || item.data.title,
                    subtitle: item.data.subtitle || (type === 'movie' ? 'Movie' : 'Series'),
                    poster: item.stream_icon || item.data.poster,
                    sourceId: sourceId,
                    resumeTime: isResume ? item.progress : 0,
                    containerExtension: container
                };

                // For episodes, try to restore series data for next episode functionality
                if (type === 'episode' && item.data) {
                    content.seriesId = item.data.seriesId || null;
                    content.currentSeason = item.data.currentSeason || null;
                    content.currentEpisode = item.data.currentEpisode || null;

                    // Fetch seriesInfo if we have a seriesId
                    if (content.seriesId && sourceId) {
                        try {
                            const seriesInfo = await window.API.request('GET', `/proxy/xtream/${sourceId}/series_info?series_id=${content.seriesId}`);
                            if (seriesInfo) {
                                content.seriesInfo = seriesInfo;
                            }
                        } catch (e) {
                            console.warn('[Dashboard] Could not fetch seriesInfo for next episode:', e);
                        }
                    }
                }

                // Switch to watch page
                this.app.navigateTo('watch');

                this.app.pages.watch.play(content, result.url);
            }
        } catch (err) {
            console.error('[Dashboard] Playback failed:', err);
        }
    }
}

window.HomePage = HomePage;
