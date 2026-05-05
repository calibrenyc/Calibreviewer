(function () {
    const keyInput = document.getElementById('assist-key');
    const connectBtn = document.getElementById('assist-connect');
    const refreshBtn = document.getElementById('assist-refresh');
    const autoToggle = document.getElementById('assist-auto');
    const statusEl = document.getElementById('assist-status');
    const clientsEl = document.getElementById('assist-clients');

    const exportBtn = document.getElementById('assist-export');
    const importBtn = document.getElementById('assist-import-btn');
    const importFile = document.getElementById('assist-import-file');
    const mergeToggle = document.getElementById('assist-merge');
    const settingsToggle = document.getElementById('assist-settings');
    const migrateStatusEl = document.getElementById('assist-migrate-status');

    const KEY_STORAGE = 'assistConsoleKey';
    let pollTimer = null;

    keyInput.value = localStorage.getItem(KEY_STORAGE) || '';

    function setStatus(message, isError) {
        statusEl.textContent = message;
        statusEl.style.color = isError ? 'var(--color-error)' : '';
    }

    function setMigrateStatus(message, isError) {
        migrateStatusEl.textContent = message;
        migrateStatusEl.style.color = isError ? 'var(--color-error)' : '';
    }

    function getAssistKey() {
        return String(keyInput.value || '').trim();
    }

    async function assistRequest(path, options) {
        const key = getAssistKey();
        if (!key) {
            throw new Error('Assist key is required');
        }

        const requestOptions = {
            method: options?.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-Assist-Key': key
            }
        };

        if (options?.body) {
            requestOptions.body = JSON.stringify(options.body);
        }

        const response = await fetch(path, requestOptions);
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(payload?.error || `Request failed (${response.status})`);
        }

        return payload;
    }

    function renderClients(clients) {
        if (!Array.isArray(clients) || clients.length === 0) {
            clientsEl.innerHTML = '<p class="assist-muted">No active client snapshots.</p>';
            return;
        }

        clientsEl.innerHTML = clients.map((client) => {
            const playbackMode = client?.playback?.mode || 'idle';
            const liveChannel = client?.playback?.live?.channelName;
            const vodTitle = client?.playback?.vod?.title;
            const playbackLabel = playbackMode === 'live'
                ? (liveChannel ? `Live: ${liveChannel}` : 'Live playback')
                : (playbackMode === 'vod'
                    ? (vodTitle ? `VOD: ${vodTitle}` : 'VOD playback')
                    : 'Idle');

            return `
                <div class="assist-client">
                    <div class="assist-client-head">
                        <strong>${client.sessionName || client.username || 'Unknown User'}</strong>
                        <span class="assist-muted">${client.lastSeenAgoSeconds}s ago</span>
                    </div>
                    <div class="assist-meta">
                        <span>Page: ${client.page || 'unknown'}</span>
                        <span>${playbackLabel}</span>
                        <span>Viewport: ${client?.clientInfo?.viewport || 'n/a'}</span>
                        <span>Role: ${client.role || 'n/a'}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    async function refreshClients() {
        try {
            const payload = await assistRequest('/api/assist/clients');
            setStatus(`Connected. ${payload.count} client${payload.count === 1 ? '' : 's'} loaded.`);
            renderClients(payload.clients || []);
        } catch (err) {
            setStatus(err.message || 'Failed to load clients.', true);
            clientsEl.innerHTML = '<p class="assist-muted">Unable to load client diagnostics.</p>';
        }
    }

    async function validateAndConnect() {
        try {
            await assistRequest('/api/assist/status');
            localStorage.setItem(KEY_STORAGE, getAssistKey());
            setStatus('Assist key accepted.');
            await refreshClients();
            startAutoRefresh();
        } catch (err) {
            setStatus(err.message || 'Invalid assist key.', true);
        }
    }

    function startAutoRefresh() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }

        if (!autoToggle.checked) return;

        pollTimer = setInterval(() => {
            refreshClients();
        }, 10000);
    }

    async function exportContentPack() {
        exportBtn.disabled = true;
        exportBtn.textContent = 'Exporting...';

        try {
            const payload = await assistRequest('/api/assist/content-pack/export');
            const fileName = `calibreviewer-content-pack-${new Date().toISOString().slice(0, 10)}.json`;
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = fileName;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
            setMigrateStatus(`Exported ${fileName}`);
        } catch (err) {
            setMigrateStatus(err.message || 'Export failed.', true);
        } finally {
            exportBtn.disabled = false;
            exportBtn.textContent = 'Export Content Pack';
        }
    }

    async function importContentPack(file) {
        if (!file) return;

        try {
            setMigrateStatus('Importing content pack...');
            const text = await file.text();
            const pack = JSON.parse(text);

            const result = await assistRequest('/api/assist/content-pack/import', {
                method: 'POST',
                body: {
                    pack,
                    mode: mergeToggle.checked ? 'merge' : 'replace',
                    includeSettings: settingsToggle.checked
                }
            });

            setMigrateStatus(`Import complete. Sources: ${result?.imported?.sources || 0}, Hidden: ${result?.imported?.hiddenItems || 0}, Favorites: ${result?.imported?.favorites || 0}`);
        } catch (err) {
            setMigrateStatus(err.message || 'Import failed.', true);
        } finally {
            importFile.value = '';
        }
    }

    connectBtn.addEventListener('click', validateAndConnect);
    refreshBtn.addEventListener('click', refreshClients);
    autoToggle.addEventListener('change', startAutoRefresh);
    exportBtn.addEventListener('click', exportContentPack);
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', () => importContentPack(importFile.files?.[0]));

    if (keyInput.value) {
        validateAndConnect();
    }
})();
