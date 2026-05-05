const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { loadDb, saveDb, getDefaultSettings } = require('../db');
const diagnosticsStore = require('../services/diagnosticsStore');
const auth = require('../auth');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const assistSessions = new Map();

function compactAssistSessions() {
    const now = Date.now();
    for (const [token, session] of assistSessions.entries()) {
        if (!session?.expiresAt || session.expiresAt <= now) {
            assistSessions.delete(token);
        }
    }
}

function createAssistSession(user) {
    compactAssistSessions();
    const token = crypto.randomBytes(32).toString('hex');
    assistSessions.set(token, {
        userId: user.id,
        username: user.username,
        role: user.role,
        expiresAt: Date.now() + SESSION_TTL_MS
    });
    return token;
}

function readAssistSessionToken(req) {
    return String(req.headers['x-assist-session'] || req.query?.session || '').trim();
}

function requireAssistSession(req, res, next) {
    compactAssistSessions();
    const token = readAssistSessionToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Assist session required.' });
    }

    const session = assistSessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
        assistSessions.delete(token);
        return res.status(401).json({ error: 'Assist session expired. Log in again.' });
    }

    req.assistSession = session;
    req.assistSessionToken = token;
    return next();
}

function getAssistPasswordHash(data) {
    return data?.settings?.assistPasswordHash || '';
}

async function verifyAssistPassword(data, providedPassword) {
    const hash = getAssistPasswordHash(data);
    if (!hash) {
        return { configured: false, valid: true };
    }

    if (!providedPassword) {
        return { configured: true, valid: false };
    }

    const valid = await auth.verifyPassword(providedPassword, hash);
    return { configured: true, valid };
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

router.post('/login', async (req, res) => {
    try {
        const username = String(req.body?.username || '').trim();
        const password = String(req.body?.password || '');
        const assistPassword = String(req.body?.assistPassword || '');

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required.' });
        }

        const data = await loadDb();
        const user = (data.users || []).find((u) => u.username === username);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        const passwordValid = await auth.verifyPassword(password, user.passwordHash);
        if (!passwordValid) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'Assist Console requires an admin account.' });
        }

        const assistCheck = await verifyAssistPassword(data, assistPassword);
        if (!assistCheck.valid) {
            return res.status(401).json({
                error: assistCheck.configured
                    ? 'Invalid assist password.'
                    : 'Assist password is not set yet. Set it after login.'
            });
        }

        const sessionToken = createAssistSession(user);

        return res.json({
            ok: true,
            sessionToken,
            sessionExpiresInSeconds: Math.floor(SESSION_TTL_MS / 1000),
            assistPasswordConfigured: assistCheck.configured,
            user: {
                id: user.id,
                username: user.username,
                role: user.role
            }
        });
    } catch (err) {
        console.error('Assist login failed:', err);
        return res.status(500).json({ error: err.message || 'Assist login failed.' });
    }
});

router.post('/password', requireAssistSession, async (req, res) => {
    try {
        const nextPassword = String(req.body?.password || '');
        if (nextPassword.length < 6) {
            return res.status(400).json({ error: 'Assist password must be at least 6 characters.' });
        }

        const data = await loadDb();
        const passwordHash = await auth.hashPassword(nextPassword);
        data.settings = {
            ...(data.settings || {}),
            assistPasswordHash: passwordHash
        };

        await saveDb(data);
        return res.json({ ok: true, message: 'Assist password updated.' });
    } catch (err) {
        console.error('Failed to update assist password:', err);
        return res.status(500).json({ error: err.message || 'Failed to update assist password.' });
    }
});

router.post('/logout', requireAssistSession, (req, res) => {
    assistSessions.delete(req.assistSessionToken);
    return res.json({ ok: true });
});

router.get('/status', requireAssistSession, (req, res) => {
    res.json({
        ok: true,
        user: {
            userId: req.assistSession.userId,
            username: req.assistSession.username,
            role: req.assistSession.role
        }
    });
});

router.get('/clients', requireAssistSession, (req, res) => {
    const clients = diagnosticsStore.listClientSnapshots();
    res.json({
        clients,
        count: clients.length,
        staleAfterSeconds: Math.floor(diagnosticsStore.CLIENT_STALE_MS / 1000),
        users: [...new Set(clients.map((client) => client.sessionName || client.username).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    });
});

    router.get('/content-pack/export', requireAssistSession, async (req, res) => {
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

router.post('/content-pack/import', requireAssistSession, async (req, res) => {
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
