const express = require('express');
const router = express.Router();
const { settings, getDefaultSettings } = require('../db');
const syncService = require('../services/syncService');
const auth = require('../auth');
const diagnosticsStore = require('../services/diagnosticsStore');

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

        const now = diagnosticsStore.upsertClientSnapshot(clientId, {
            username: user.username || null,
            role: user.role || null,
            sessionName: String(payload.sessionName || '').trim() || null,
            page: String(payload.page || '').trim() || 'unknown',
            playback: payload.playback && typeof payload.playback === 'object' ? payload.playback : {},
            appVersion: String(payload.appVersion || '').trim() || null,
            clientInfo: payload.clientInfo && typeof payload.clientInfo === 'object' ? payload.clientInfo : {},
            diagnostics: payload.diagnostics && typeof payload.diagnostics === 'object' ? payload.diagnostics : {}
        });

        res.json({ ok: true, serverTime: new Date(now).toISOString() });
    } catch (err) {
        console.error('Error receiving diagnostics heartbeat:', err);
        res.status(500).json({ error: err.message || 'Failed to process heartbeat' });
    }
});

module.exports = router;

