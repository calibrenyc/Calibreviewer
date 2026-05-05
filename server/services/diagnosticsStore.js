const CLIENT_STALE_MS = 2 * 60 * 1000;
const clientSnapshots = new Map();

function compactClientSnapshots() {
    const now = Date.now();
    for (const [clientId, entry] of clientSnapshots.entries()) {
        if (!entry?.lastSeenAt || (now - entry.lastSeenAt) > CLIENT_STALE_MS) {
            clientSnapshots.delete(clientId);
        }
    }
}

function upsertClientSnapshot(clientId, payload) {
    const now = Date.now();

    clientSnapshots.set(clientId, {
        clientId,
        username: payload?.username || null,
        role: payload?.role || null,
        sessionName: payload?.sessionName || null,
        page: payload?.page || 'unknown',
        playback: payload?.playback || {},
        appVersion: payload?.appVersion || null,
        clientInfo: payload?.clientInfo || {},
        diagnostics: payload?.diagnostics || {},
        lastSeenAt: now
    });

    compactClientSnapshots();
    return now;
}

function listClientSnapshots() {
    compactClientSnapshots();
    const now = Date.now();

    return [...clientSnapshots.values()]
        .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0))
        .map((entry) => ({
            ...entry,
            lastSeenAgoSeconds: Math.max(0, Math.floor((now - entry.lastSeenAt) / 1000)),
            active: (now - entry.lastSeenAt) <= CLIENT_STALE_MS
        }));
}

module.exports = {
    CLIENT_STALE_MS,
    upsertClientSnapshot,
    listClientSnapshots
};
