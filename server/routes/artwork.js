/**
 * Artwork Route
 * Fetches high-quality backdrop/poster art from TMDB and caches results for 7 days.
 * GET /api/artwork/search?title=…&year=…&type=movie|series
 */

const express = require('express');
const router = express.Router();
const { settings } = require('../db');
const { getDb } = require('../db/sqlite');

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p/original';

function cacheKey(title, year, type) {
    return `${type}:${title.toLowerCase().trim()}:${(year || '').trim()}`;
}

function readCache(key) {
    try {
        const db = getDb();
        const row = db.prepare('SELECT * FROM artwork_cache WHERE cache_key = ?').get(key);
        if (!row) return null;
        if (Date.now() - row.fetched_at > CACHE_TTL_MS) {
            db.prepare('DELETE FROM artwork_cache WHERE cache_key = ?').run(key);
            return null;
        }
        return row;
    } catch {
        return null;
    }
}

function writeCache(key, backdropUrl, posterUrl) {
    try {
        const db = getDb();
        db.prepare(`
            INSERT OR REPLACE INTO artwork_cache (cache_key, backdrop_url, poster_url, fetched_at)
            VALUES (?, ?, ?, ?)
        `).run(key, backdropUrl || null, posterUrl || null, Date.now());
    } catch {
        // ignore cache write errors
    }
}

async function searchTMDB(title, year, type, apiKey) {
    const endpoint = type === 'series' ? 'search/tv' : 'search/movie';
    const yearParam = year ? (type === 'series' ? `&first_air_date_year=${year}` : `&year=${year}`) : '';
    const url = `${TMDB_BASE}/${endpoint}?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(title)}${yearParam}&language=en-US&page=1&include_adult=false`;

    const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) throw new Error(`TMDB responded ${response.status}`);

    const data = await response.json();
    const result = data.results?.[0];
    if (!result) return null;

    const backdropPath = result.backdrop_path;
    const posterPath = result.poster_path;

    return {
        backdropUrl: backdropPath ? `${TMDB_IMG_BASE}${backdropPath}` : null,
        posterUrl: posterPath ? `${TMDB_IMG_BASE}${posterPath}` : null
    };
}

/**
 * GET /api/artwork/search
 * Query params: title, year (optional), type ('movie' | 'series')
 */
router.get('/search', async (req, res) => {
    const { title, year, type } = req.query;

    if (!title || !type || (type !== 'movie' && type !== 'series')) {
        return res.status(400).json({ error: 'title and type (movie|series) are required' });
    }

    const key = cacheKey(title, year, type);

    // Return cached result if fresh
    const cached = readCache(key);
    if (cached) {
        return res.json({ backdropUrl: cached.backdrop_url, posterUrl: cached.poster_url, cached: true });
    }

    // Need TMDB api key from settings
    let apiKey = '';
    try {
        const s = await settings.get();
        apiKey = (s.tmdbApiKey || '').trim();
    } catch {
        // ignore
    }

    if (!apiKey) {
        return res.json({ backdropUrl: null, posterUrl: null, cached: false, noKey: true });
    }

    try {
        const result = await searchTMDB(title, year, type, apiKey);
        const backdropUrl = result?.backdropUrl || null;
        const posterUrl = result?.posterUrl || null;
        writeCache(key, backdropUrl, posterUrl);
        return res.json({ backdropUrl, posterUrl, cached: false });
    } catch (err) {
        console.error('[Artwork] TMDB search failed:', err.message);
        // Cache a null result for 1 hour to avoid hammering on failures
        writeCache(key, null, null);
        return res.json({ backdropUrl: null, posterUrl: null, cached: false, error: err.message });
    }
});

/**
 * DELETE /api/artwork/cache  — purge entire artwork cache (admin)
 */
router.delete('/cache', async (req, res) => {
    try {
        const db = getDb();
        const info = db.prepare('DELETE FROM artwork_cache').run();
        res.json({ ok: true, deleted: info.changes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
