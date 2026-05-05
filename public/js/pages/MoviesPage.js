/**
 * Movies Page Controller
 * Handles VOD movie browsing and playback
 */

class MoviesPage {
    constructor(app) {
        this.app = app;
        this.cacheKey = 'calibreviewer.moviesPageCache';
        this.cacheMaxAgeMs = 10 * 60 * 60 * 1000;
        this.container = document.getElementById('movies-grid');
        this.sourceSelect = document.getElementById('movies-source-select');
        this.categorySelect = document.getElementById('movies-category-select');
        this.searchInput = document.getElementById('movies-search');

        this.movies = [];
        this.categories = [];
        this.sources = [];
        this.currentBatch = 0;
        this.batchSize = 24;
        this.filteredMovies = [];
        this.isLoading = false;
        this.observer = null;
        this.favoriteIds = new Set(); // Track favorite movie IDs
        this.showFavoritesOnly = false;
        this.hiddenCategoryIds = new Set();
        this.cacheTimestamp = null;

        this.restorePersistedState();
        this.init();
    }

    restorePersistedState() {
        try {
            const raw = localStorage.getItem(this.cacheKey);
            if (!raw) return false;

            const cached = JSON.parse(raw);
            if (!Array.isArray(cached?.movies) || !Array.isArray(cached?.sources) || !Array.isArray(cached?.categories)) {
                return false;
            }

            this.cacheTimestamp = Number.isFinite(cached?.timestamp) ? cached.timestamp : null;
            this.movies = cached.movies;
            this.sources = cached.sources;
            this.categories = cached.categories;
            this.hiddenCategoryIds = new Set(Array.isArray(cached.hiddenCategoryIds) ? cached.hiddenCategoryIds : []);
            this.showFavoritesOnly = cached.showFavoritesOnly === true;
            this.cachedSourceValue = typeof cached.selectedSource === 'string' ? cached.selectedSource : '';
            this.cachedCategoryValue = typeof cached.selectedCategory === 'string' ? cached.selectedCategory : '';
            return this.movies.length > 0 || this.categories.length > 0 || this.sources.length > 0;
        } catch {
            return false;
        }
    }

    persistState() {
        try {
            this.cacheTimestamp = Date.now();
            localStorage.setItem(this.cacheKey, JSON.stringify({
                timestamp: this.cacheTimestamp,
                sources: this.sources || [],
                categories: this.categories || [],
                movies: this.movies || [],
                hiddenCategoryIds: [...this.hiddenCategoryIds],
                selectedSource: this.sourceSelect?.value || '',
                selectedCategory: this.categorySelect?.value || '',
                showFavoritesOnly: this.showFavoritesOnly === true
            }));
        } catch {
            // ignore local cache quota issues
        }
    }

    isCacheStale() {
        if (!this.cacheTimestamp) return true;
        return (Date.now() - this.cacheTimestamp) > this.cacheMaxAgeMs;
    }

    populateSourceOptions() {
        this.sourceSelect.innerHTML = '<option value="">All Sources</option>';
        this.sources.forEach(s => {
            const option = document.createElement('option');
            option.value = s.id;
            option.textContent = s.name;
            this.sourceSelect.appendChild(option);
        });

        if (this.cachedSourceValue && this.sourceSelect.querySelector(`option[value="${this.cachedSourceValue}"]`)) {
            this.sourceSelect.value = this.cachedSourceValue;
        }
    }

    populateCategoryOptions() {
        this.categorySelect.innerHTML = '<option value="">All Categories</option>';
        this.categories.forEach(c => {
            const option = document.createElement('option');
            option.value = `${c.sourceId}:${c.category_id}`;
            option.textContent = c.category_name;
            this.categorySelect.appendChild(option);
        });

        if (this.cachedCategoryValue && this.categorySelect.querySelector(`option[value="${this.cachedCategoryValue}"]`)) {
            this.categorySelect.value = this.cachedCategoryValue;
        }
    }

    init() {
        // Source change handler
        this.sourceSelect?.addEventListener('change', async () => {
            this.cachedSourceValue = this.sourceSelect.value;
            this.cachedCategoryValue = '';
            await this.loadCategories();
            await this.loadMovies();
        });

        // Category change handler
        this.categorySelect?.addEventListener('change', () => {
            this.cachedCategoryValue = this.categorySelect.value;
            this.loadMovies();
        });

        // Search with debounce
        let searchTimeout;
        this.searchInput?.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => this.filterAndRender(), 300);
        });

        // Set up IntersectionObserver for lazy loading
        this.observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !this.isLoading) {
                this.renderNextBatch();
            }
        }, { rootMargin: '200px' });

        // Favorites filter toggle
        const favBtn = document.getElementById('movies-favorites-btn');
        favBtn?.addEventListener('click', () => {
            this.showFavoritesOnly = !this.showFavoritesOnly;
            favBtn.classList.toggle('active', this.showFavoritesOnly);
            this.persistState();
            this.filterAndRender();
        });

        if (this.sources.length > 0) {
            this.populateSourceOptions();
        }
        if (this.categories.length > 0) {
            this.populateCategoryOptions();
        }
        if (favBtn) {
            favBtn.classList.toggle('active', this.showFavoritesOnly);
        }
    }

    async show() {
        const hasCachedCatalog = this.sources.length > 0 || this.categories.length > 0 || this.movies.length > 0;
        if (hasCachedCatalog) {
            this.populateSourceOptions();
            this.populateCategoryOptions();
            await this.loadFavorites({ background: true });
            if (this.movies.length > 0) {
                this.filterAndRender();
            }
            if (this.isCacheStale()) {
                (async () => {
                    await this.loadSources({ background: true });
                    await this.loadCategories({ background: true });
                    await this.loadMovies({ background: true, preserveExisting: true });
                })().catch(err => {
                    console.warn('[Movies] Background refresh failed:', err?.message || err);
                });
            }
            return;
        }

        // Load sources if not loaded
        if (this.sources.length === 0) {
            await this.loadSources();
        }

        // Load favorites
        await this.loadFavorites();

        // Load movies if empty
        if (this.movies.length === 0) {
            await this.loadCategories();
            await this.loadMovies();
        }
    }

    hide() {
        // Page is hidden
    }

    async loadFavorites(requestOptions = {}) {
        try {
            const favs = await API.favorites.getAll(null, 'movie', requestOptions);
            this.favoriteIds = new Set(favs.map(f => `${f.source_id}:${f.item_id}`));
        } catch (err) {
            console.error('Error loading favorites:', err);
        }
    }


    async loadSources(requestOptions = {}) {
        try {
            const allSources = await API.sources.getAll(requestOptions);
            this.sources = allSources.filter(s => s.type === 'xtream' && s.enabled);
            this.populateSourceOptions();
            this.persistState();
        } catch (err) {
            console.error('Error loading sources:', err);
        }
    }

    async loadCategories(requestOptions = {}) {
        try {
            this.categories = [];
            this.hiddenCategoryIds = new Set(); // Track hidden categories
            this.categorySelect.innerHTML = '<option value="">All Categories</option>';

            const sourceId = this.sourceSelect.value;
            const sourcesToLoad = sourceId
                ? this.sources.filter(s => s.id === parseInt(sourceId))
                : this.sources;

            // Fetch hidden items for each source
            for (const source of sourcesToLoad) {
                try {
                    const hiddenItems = await API.channels.getHidden(source.id, requestOptions);
                    hiddenItems.forEach(h => {
                        if (h.item_type === 'vod_category') {
                            this.hiddenCategoryIds.add(`${source.id}:${h.item_id}`);
                        }
                    });
                } catch (err) {
                    console.warn(`Failed to load hidden items from source ${source.id}`);
                }
            }

            for (const source of sourcesToLoad) {
                try {
                    const cats = await API.proxy.xtream.vodCategories(source.id, requestOptions);
                    if (cats && Array.isArray(cats)) {
                        cats.forEach(c => {
                            // Skip hidden categories
                            if (!this.hiddenCategoryIds.has(`${source.id}:${c.category_id}`)) {
                                this.categories.push({ ...c, sourceId: source.id });
                            }
                        });
                    }
                } catch (err) {
                    console.warn(`Failed to load categories from source ${source.id}:`, err.message);
                }
            }

            this.populateCategoryOptions();
            this.persistState();
        } catch (err) {
            console.error('Error loading categories:', err);
        }
    }

    async loadMovies(options = {}) {
        this.isLoading = true;
        if (!options.preserveExisting) {
            this.container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
        }

        try {
            this.movies = [];

            const sourceId = this.sourceSelect.value;
            const categoryValue = this.categorySelect.value;

            const sourcesToLoad = sourceId
                ? this.sources.filter(s => s.id === parseInt(sourceId))
                : this.sources;

            for (const source of sourcesToLoad) {
                try {
                    // Parse category if selected
                    let catId = null;
                    if (categoryValue) {
                        const [catSourceId, categoryId] = categoryValue.split(':');
                        if (parseInt(catSourceId) === source.id) {
                            catId = categoryId;
                        } else if (sourceId) {
                            continue; // Skip this source if category is from different source
                        }
                    }

                    const movies = await API.proxy.xtream.vodStreams(source.id, catId, options);
                    console.log(`[Movies] Source ${source.id}, Category ${catId || 'ALL'}: Got ${movies?.length || 0} movies`);
                    if (movies && Array.isArray(movies)) {
                        movies.forEach(m => {
                            // Skip movies from hidden categories
                            if (this.hiddenCategoryIds && this.hiddenCategoryIds.has(`${source.id}:${m.category_id}`)) {
                                return;
                            }
                            this.movies.push({
                                ...m,
                                sourceId: source.id,
                                id: `${source.id}:${m.stream_id}`
                            });
                        });
                    }
                } catch (err) {
                    console.warn(`Failed to load movies from source ${source.id}:`, err.message);
                }
            }

            console.log(`[Movies] Total loaded: ${this.movies.length} movies`);
            this.persistState();
            this.filterAndRender();
        } catch (err) {
            console.error('Error loading movies:', err);
            this.container.innerHTML = '<div class="empty-state"><p>Error loading movies</p></div>';
        } finally {
            this.isLoading = false;
        }
    }

    filterAndRender() {
        const searchTerm = this.searchInput?.value?.toLowerCase() || '';

        this.filteredMovies = this.movies.filter(m => {
            // Filter by favorites if enabled
            if (this.showFavoritesOnly) {
                const favKey = `${m.sourceId}:${m.stream_id}`;
                if (!this.favoriteIds.has(favKey)) return false;
            }
            if (searchTerm && !m.name?.toLowerCase().includes(searchTerm)) {
                return false;
            }
            return true;
        });

        console.log(`[Movies] Displaying ${this.filteredMovies.length} of ${this.movies.length} movies`);

        this.currentBatch = 0;
        this.container.innerHTML = '';

        if (this.filteredMovies.length === 0) {
            this.container.innerHTML = '<div class="empty-state"><p>No movies found</p></div>';
            return;
        }

        // Create loader element
        const loader = document.createElement('div');
        loader.className = 'movies-loader';
        loader.innerHTML = '<div class="loading-spinner"></div>';
        this.container.appendChild(loader);

        // Render initial batches (more to fill viewport)
        for (let i = 0; i < 5; i++) {
            this.renderNextBatch();
        }

        // Start observing loader
        this.observer.observe(loader);
    }

    renderNextBatch() {
        const start = this.currentBatch * this.batchSize;
        const end = start + this.batchSize;
        const batch = this.filteredMovies.slice(start, end);

        console.log(`[Movies] Rendering batch ${this.currentBatch}: ${batch.length} cards (${start}-${end})`);

        if (batch.length === 0) {
            const loader = this.container.querySelector('.movies-loader');
            if (loader) loader.style.display = 'none';
            return;
        }

        const fragment = document.createDocumentFragment();

        batch.forEach(movie => {
            const card = document.createElement('div');
            card.className = 'movie-card';
            card.dataset.movieId = movie.stream_id;
            card.dataset.sourceId = movie.sourceId;

            const poster = movie.stream_icon || movie.cover || '/img/placeholder.png';
            const year = movie.year || movie.releaseDate?.substring(0, 4) || '';
            const rating = movie.rating ? `${Icons.star} ${movie.rating}` : '';

            const isFav = this.favoriteIds.has(`${movie.sourceId}:${movie.stream_id}`);

            card.innerHTML = `
                <div class="movie-poster">
                    <img src="${poster}" alt="${movie.name}" 
                         onerror="this.onerror=null;this.src='/img/placeholder.png'" loading="lazy">
                    <div class="movie-play-overlay">
                        <span class="play-icon">${Icons.play}</span>
                    </div>
                    <button class="favorite-btn ${isFav ? 'active' : ''}" title="${isFav ? 'Remove from Favorites' : 'Add to Favorites'}">
                        <span class="fav-icon">${isFav ? Icons.favorite : Icons.favoriteOutline}</span>
                    </button>
                </div>
                <div class="movie-info">
                    <div class="movie-title">${movie.name}</div>
                    <div class="movie-meta">
                        ${year ? `<span>${year}</span>` : ''}
                        ${rating ? `<span>${rating}</span>` : ''}
                    </div>
                </div>
            `;

            // Card click plays movie, but not if clicking favorite button
            card.addEventListener('click', (e) => {
                if (e.target.closest('.favorite-btn')) {
                    const btn = e.target.closest('.favorite-btn');
                    this.toggleFavorite(movie, btn);
                    e.stopPropagation();
                } else {
                    this.playMovie(movie);
                }
            });
            fragment.appendChild(card);
        });

        // Insert before loader
        const loader = this.container.querySelector('.movies-loader');
        if (loader) {
            this.container.insertBefore(fragment, loader);
        } else {
            this.container.appendChild(fragment);
        }

        this.currentBatch++;

        // Hide loader if done
        if (end >= this.filteredMovies.length && loader) {
            loader.style.display = 'none';
        }
    }

    async playMovie(movie) {
        try {
            // Get stream URL for movie using the actual container extension from API
            // Xtream API returns container_extension (e.g., 'mp4', 'mkv', 'avi')
            const container = movie.container_extension || 'mp4';
            const result = await API.proxy.xtream.getStreamUrl(movie.sourceId, movie.stream_id, 'movie', container);

            if (result && result.url) {
                // Play in dedicated Watch page
                if (this.app.pages.watch) {
                    this.app.pages.watch.play({
                        type: 'movie',
                        id: movie.stream_id,
                        title: movie.name,
                        poster: movie.stream_icon || movie.cover,
                        description: movie.plot || '',
                        year: movie.year || movie.releaseDate?.substring(0, 4),
                        rating: movie.rating,
                        sourceId: movie.sourceId,
                        categoryId: movie.category_id,
                        containerExtension: container
                    }, result.url);
                }
            }
        } catch (err) {
            console.error('Error playing movie:', err);
        }
    }
    async toggleFavorite(movie, btn) {
        const favKey = `${movie.sourceId}:${movie.stream_id}`;
        const isFav = this.favoriteIds.has(favKey);
        const iconSpan = btn.querySelector('.fav-icon');

        try {
            // Optimistic update
            if (isFav) {
                this.favoriteIds.delete(favKey);
                btn.classList.remove('active');
                btn.title = 'Add to Favorites';
                if (iconSpan) iconSpan.innerHTML = Icons.favoriteOutline;
                await API.favorites.remove(movie.sourceId, movie.stream_id, 'movie');
            } else {
                this.favoriteIds.add(favKey);
                btn.classList.add('active');
                btn.title = 'Remove from Favorites';
                if (iconSpan) iconSpan.innerHTML = Icons.favorite;
                await API.favorites.add(movie.sourceId, movie.stream_id, 'movie');
            }
        } catch (err) {
            console.error('Error toggling favorite:', err);
            // Revert on error
            if (isFav) {
                this.favoriteIds.add(favKey);
                btn.classList.add('active');
                if (iconSpan) iconSpan.innerHTML = Icons.favorite;
            } else {
                this.favoriteIds.delete(favKey);
                btn.classList.remove('active');
                if (iconSpan) iconSpan.innerHTML = Icons.favoriteOutline;
            }
        }
    }
}

window.MoviesPage = MoviesPage;
