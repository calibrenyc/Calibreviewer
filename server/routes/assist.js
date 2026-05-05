const express = require('express');
const router = express.Router();
const { loadDb, saveDb, getDefaultSettings } = require('../db');
const diagnosticsStore = require('../services/diagnosticsStore');

function readAssistKey(req) {
    return String(
        req.headers['x-assist-key']
        || req.query?.key
        || req.body?.assistKey
        || ''
    ).trim();
}

function requireAssistKey(req, res, next) {
    const expected = String(process.env.ASSIST_CONSOLE_KEY || '').trim();
    if (!expected) {
        return res.status(503).json({ error: 'Assist Console is disabled. ASSIST_CONSOLE_KEY is not set.' });
    }

    const provided = readAssistKey(req);
    if (!provided || provided !== expected) {
        return res.status(403).json({ error: 'Invalid assist key.' });
    }

    return next();
}

function dedupeBy(list, keyFn) {
    const map = new Map();
    for (const item of Array.isArray(list) ? list : []) {
        const key = keyFn(item);
        if (!key) continue;
        map.set(key, item);
    }
    return [...map.values()];
}

router.get('/status', requireAssistKey, (req, res) => {
    res.json({ ok: true });
});

router.get('/clients', requireAssistKey, (req, res) => {
    const clients = diagnosticsStore.listClientSnapshots();
    res.json({
        clients,
        count: clients.length,
        staleAfterSeconds: Math.floor(diagnosticsStore.CLIENT_STALE_MS / 1000)
    });
});

router.get('/content-pack/export', requireAssistKey, async (req, res) => {
    try {
        const db = await loadDb();
        const payload = {
            kind: 'calibreviewer-content-pack',
            version: 1,
            exportedAt: new Date().toISOString(),
            data: {
                sources: db.sources || [],
                hiddenItems: db.hiddenItems || [],
                favorites: db.favorites || [],
                settings: db.settings || getDefaultSettings()
            }
        };

        res.json(payload);
    } catch (err) {
        console.error('Error exporting content pack via assist:', err);
        res.status(500).json({ error: err.message || 'Failed to export content pack' });
    }
});

router.post('/content-pack/import', requireAssistKey, async (req, res) => {
    try {
        const incoming = req.body || {};
        const pack = incoming?.kind === 'calibreviewer-content-pack' ? incoming : incoming?.pack;
        const mode = String(incoming?.mode || 'replace').toLowerCase();
        const includeSettings = incoming?.includeSettings !== false;

        if (!pack || pack.kind !== 'calibreviewer-content-pack' || !pack.data) {
            return res.status(400).json({ error: 'Invalid content pack payload' });
        }

        const current = await loadDb();
        const importedData = pack.data || {};
        const importedSources = Array.isArray(importedData.sources) ? importedData.sources : [];
        const importedHiddenItems = Array.isArray(importedData.hiddenItems) ? importedData.hiddenItems : [];
        const importedFavorites = Array.isArray(importedData.favorites) ? importedData.favorites : [];
        const importedSettings = importedData.settings && typeof importedData.settings === 'object'
            ? importedData.settings
            : null;

        if (mode === 'merge') {
            current.sources = dedupeBy(
                [...(current.sources || []), ...importedSources],
                (item) => `${item?.type || ''}|${item?.url || ''}|${item?.username || ''}|${item?.name || ''}`
            );
            current.hiddenItems = dedupeBy(
                [...(current.hiddenItems || []), ...importedHiddenItems],
                (item) => `${item?.source_id || ''}|${item?.item_type || ''}|${item?.item_id || ''}`
            );
            current.favorites = dedupeBy(
                [...(current.favorites || []), ...importedFavorites],
                (item) => `${item?.source_id || ''}|${item?.item_type || ''}|${item?.item_id || ''}`
            );
            if (includeSettings && importedSettings) {
                current.settings = { ...(current.settings || {}), ...importedSettings };
            }
        } else {
            current.sources = importedSources;
            current.hiddenItems = importedHiddenItems;
            current.favorites = importedFavorites;
            if (includeSettings && importedSettings) {
                current.settings = { ...getDefaultSettings(), ...importedSettings };
            }
        }

        const maxExistingId = [
            ...(current.sources || []).map(item => Number(item?.id) || 0),
            ...(current.hiddenItems || []).map(item => Number(item?.id) || 0),
            ...(current.favorites || []).map(item => Number(item?.id) || 0),
            Number(current.nextId) || 0
        ].reduce((max, value) => Math.max(max, value), 0);

        current.nextId = maxExistingId + 1;

        await saveDb(current);

        res.json({
            ok: true,
            mode,
            imported: {
                sources: current.sources.length,
                hiddenItems: current.hiddenItems.length,
                favorites: current.favorites.length,
                settingsApplied: includeSettings && !!importedSettings
            }
        });
    } catch (err) {
        console.error('Error importing content pack via assist:', err);
        res.status(500).json({ error: err.message || 'Failed to import content pack' });
    }
});

module.exports = router;
