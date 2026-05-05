const express = require('express');
const router = express.Router();
const { settings, getDefaultSettings, loadDb, saveDb } = require('../db');
const syncService = require('../services/syncService');
const auth = require('../auth');

const clientSnapshots = new Map();
const CLIENT_STALE_MS = 2 * 60 * 1000;

function compactClientSnapshots() {
    const now = Date.now();
    for (const [clientId, entry] of clientSnapshots.entries()) {
        if (!entry?.lastSeenAt || (now - entry.lastSeenAt) > CLIENT_STALE_MS) {
            clientSnapshots.delete(clientId);
        }
    }
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

/**
 * Get all settings
 * GET /api/settings
 */
router.get('/', async (req, res) => {
    try {
        const currentSettings = await settings.get();
        res.json(currentSettings);
    } catch (err) {
        console.error('Error getting settings:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Update settings (partial update)
 * PUT /api/settings
 */
router.put('/', async (req, res) => {
    try {
        const updates = req.body;
        const updatedSettings = await settings.update(updates);

        // If sync interval changed, restart the server-side sync timer
        if (updates.epgRefreshInterval !== undefined) {
            syncService.restartSyncTimer().catch(console.error);
        }

        res.json(updatedSettings);
    } catch (err) {
        console.error('Error updating settings:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Reset settings to defaults
 * DELETE /api/settings
 */
router.delete('/', async (req, res) => {
    try {
        const defaultSettings = await settings.reset();
        res.json(defaultSettings);
    } catch (err) {
        console.error('Error resetting settings:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Get default settings (for reference)
 * GET /api/settings/defaults
 */
router.get('/defaults', (req, res) => {
    res.json(getDefaultSettings());
});

/**
 * Get sync status (last sync time)
 * GET /api/settings/sync-status
 */
router.get('/sync-status', (req, res) => {
    const lastSyncTime = syncService.getLastSyncTime();
    res.json({
        lastSyncTime: lastSyncTime ? lastSyncTime.toISOString() : null
    });
});

/**
 * Get hardware capabilities (GPU acceleration support)
 * GET /api/settings/hw-info
 */
router.get('/hw-info', async (req, res) => {
    try {
        const hwDetect = require('../services/hwDetect');
        let capabilities = hwDetect.getCapabilities();

        // If not yet detected, run detection now
        if (!capabilities) {
            capabilities = await hwDetect.detect();
        }

        res.json(capabilities);
    } catch (err) {
        console.error('Error getting hardware info:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Refresh hardware detection (re-probe GPUs)
 * POST /api/settings/hw-info/refresh
 */
router.post('/hw-info/refresh', async (req, res) => {
    try {
        const hwDetect = require('../services/hwDetect');
        const capabilities = await hwDetect.refresh();
        res.json(capabilities);
    } catch (err) {
        console.error('Error refreshing hardware info:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Receive active client heartbeat/state
 * POST /api/settings/diagnostics/heartbeat
 */
router.post('/diagnostics/heartbeat', auth.requireAuth, async (req, res) => {
    try {
        const user = req.user || {};
        const payload = req.body || {};
        const clientId = String(payload.clientId || '').trim();

        if (!clientId) {
            return res.status(400).json({ error: 'clientId is required' });
        }

        const now = Date.now();
        clientSnapshots.set(clientId, {
            clientId,
            username: user.username || null,
            role: user.role || null,
            sessionName: String(payload.sessionName || '').trim() || null,
            page: String(payload.page || '').trim() || 'unknown',
            playback: payload.playback && typeof payload.playback === 'object' ? payload.playback : {},
            appVersion: String(payload.appVersion || '').trim() || null,
            clientInfo: payload.clientInfo && typeof payload.clientInfo === 'object' ? payload.clientInfo : {},
            diagnostics: payload.diagnostics && typeof payload.diagnostics === 'object' ? payload.diagnostics : {},
            lastSeenAt: now
        });

        compactClientSnapshots();
        res.json({ ok: true, serverTime: new Date(now).toISOString() });
    } catch (err) {
        console.error('Error receiving diagnostics heartbeat:', err);
        res.status(500).json({ error: err.message || 'Failed to process heartbeat' });
    }
});

/**
 * List currently active client snapshots (admin only)
 * GET /api/settings/diagnostics/clients
 */
router.get('/diagnostics/clients', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    try {
        compactClientSnapshots();
        const now = Date.now();
        const clients = [...clientSnapshots.values()]
            .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0))
            .map((entry) => ({
                ...entry,
                lastSeenAgoSeconds: Math.max(0, Math.floor((now - entry.lastSeenAt) / 1000)),
                active: (now - entry.lastSeenAt) <= CLIENT_STALE_MS
            }));

        res.json({
            clients,
            count: clients.length,
            staleAfterSeconds: Math.floor(CLIENT_STALE_MS / 1000)
        });
    } catch (err) {
        console.error('Error listing diagnostics clients:', err);
        res.status(500).json({ error: err.message || 'Failed to load diagnostics clients' });
    }
});

/**
 * Export content pack for migration to another user/device
 * GET /api/settings/content-pack/export
 */
router.get('/content-pack/export', auth.requireAuth, auth.requireAdmin, async (req, res) => {
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
        console.error('Error exporting content pack:', err);
        res.status(500).json({ error: err.message || 'Failed to export content pack' });
    }
});

/**
 * Import content pack and apply to current instance
 * POST /api/settings/content-pack/import
 */
router.post('/content-pack/import', auth.requireAuth, auth.requireAdmin, async (req, res) => {
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
        console.error('Error importing content pack:', err);
        res.status(500).json({ error: err.message || 'Failed to import content pack' });
    }
});

module.exports = router;

