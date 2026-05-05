(function () {
    const usernameInput = document.getElementById('assist-username');
    const passwordInput = document.getElementById('assist-password');
    const accessPasswordInput = document.getElementById('assist-access-password');
    const connectBtn = document.getElementById('assist-connect');
    const logoutBtn = document.getElementById('assist-logout');
    const refreshBtn = document.getElementById('assist-refresh');
    const userFilterSelect = document.getElementById('assist-user-filter');
    const autoToggle = document.getElementById('assist-auto');
    const statusEl = document.getElementById('assist-status');
    const clientsEl = document.getElementById('assist-clients');

    const newPasswordInput = document.getElementById('assist-new-password');
    const savePasswordBtn = document.getElementById('assist-save-password');
    const passwordStatusEl = document.getElementById('assist-password-status');

    const exportBtn = document.getElementById('assist-export');
    const importBtn = document.getElementById('assist-import-btn');
    const importFile = document.getElementById('assist-import-file');
    const mergeToggle = document.getElementById('assist-merge');
    const settingsToggle = document.getElementById('assist-settings');
    const migrateStatusEl = document.getElementById('assist-migrate-status');

    const USER_STORAGE = 'assistConsoleUser';
    const SESSION_STORAGE = 'assistConsoleSessionToken';
    let pollTimer = null;
    let sessionToken = localStorage.getItem(SESSION_STORAGE) || '';
    let cachedClients = [];

    usernameInput.value = localStorage.getItem(USER_STORAGE) || '';

    function setStatus(message, isError) {
        statusEl.textContent = message;
        statusEl.style.color = isError ? 'var(--color-error)' : '';
    }

    function setPasswordStatus(message, isError) {
        passwordStatusEl.textContent = message;
        passwordStatusEl.style.color = isError ? 'var(--color-error)' : '';
    }

    function setMigrateStatus(message, isError) {
        migrateStatusEl.textContent = message;
        migrateStatusEl.style.color = isError ? 'var(--color-error)' : '';
    }

    async function assistRequest(path, options) {
        if (!sessionToken) {
            throw new Error('Not logged in.');
        }

        const requestOptions = {
            method: options?.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-Assist-Session': sessionToken
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

    function applyUserFilter(clients) {
        const selected = String(userFilterSelect.value || '').trim();
        if (!selected) return clients;
        return clients.filter((client) => (client.sessionName || client.username || '') === selected);
    }

    function refreshUserFilterOptions(clients, users) {
        const current = userFilterSelect.value;
        const names = Array.isArray(users) && users.length
            ? users
            : [...new Set((clients || []).map((client) => client.sessionName || client.username).filter(Boolean))].sort((a, b) => a.localeCompare(b));

        userFilterSelect.innerHTML = '<option value="">All users</option>' + names.map((name) => `<option value="${name}">${name}</option>`).join('');

        if (current && names.includes(current)) {
            userFilterSelect.value = current;
        }
    }

    function renderClients(clients) {
        const filtered = applyUserFilter(clients);
        if (!Array.isArray(filtered) || filtered.length === 0) {
            clientsEl.innerHTML = '<p class="assist-muted">No active client snapshots.</p>';
            return;
        }

        clientsEl.innerHTML = filtered.map((client) => {
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
            cachedClients = payload.clients || [];
            refreshUserFilterOptions(cachedClients, payload.users);
            setStatus(`Connected. ${payload.count} client${payload.count === 1 ? '' : 's'} loaded.`);
            renderClients(cachedClients);
        } catch (err) {
            setStatus(err.message || 'Failed to load clients.', true);
            clientsEl.innerHTML = '<p class="assist-muted">Unable to load client diagnostics.</p>';
        }
    }

    async function loginAssist() {
        const username = String(usernameInput.value || '').trim();
        const password = String(passwordInput.value || '');
        const assistPassword = String(accessPasswordInput.value || '');

        if (!username || !password) {
            setStatus('Username and password are required.', true);
            return;
        }

        connectBtn.disabled = true;
        connectBtn.textContent = 'Logging in...';

        try {
            const response = await fetch('/api/assist/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password, assistPassword })
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload?.error || 'Login failed.');
            }

            sessionToken = payload.sessionToken;
            localStorage.setItem(SESSION_STORAGE, sessionToken);
            localStorage.setItem(USER_STORAGE, username);
            setStatus(`Logged in as ${payload?.user?.username || username}.`);

            if (payload.assistPasswordConfigured) {
                setPasswordStatus('Assist password configured.');
            } else {
                setPasswordStatus('Assist password not set yet. Set one now.');
            }

            await refreshClients();
            startAutoRefresh();
        } catch (err) {
            setStatus(err.message || 'Login failed.', true);
        } finally {
            connectBtn.disabled = false;
            connectBtn.textContent = 'Login';
        }
    }

    async function logoutAssist() {
        try {
            if (sessionToken) {
                await assistRequest('/api/assist/logout', { method: 'POST' });
            }
        } catch {
            // ignore
        }

        sessionToken = '';
        localStorage.removeItem(SESSION_STORAGE);
        cachedClients = [];
        setStatus('Logged out.');
        clientsEl.innerHTML = '<p class="assist-muted">Login to load client diagnostics.</p>';
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
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

    async function saveAssistPassword() {
        const password = String(newPasswordInput.value || '');
        if (password.length < 6) {
            setPasswordStatus('Password must be at least 6 characters.', true);
            return;
        }

        savePasswordBtn.disabled = true;
        savePasswordBtn.textContent = 'Saving...';

        try {
            await assistRequest('/api/assist/password', {
                method: 'POST',
                body: { password }
            });

            newPasswordInput.value = '';
            setPasswordStatus('Assist password updated.');
        } catch (err) {
            setPasswordStatus(err.message || 'Failed to save assist password.', true);
        } finally {
            savePasswordBtn.disabled = false;
            savePasswordBtn.textContent = 'Save Password';
        }
    }

    connectBtn.addEventListener('click', loginAssist);
    logoutBtn.addEventListener('click', logoutAssist);
    refreshBtn.addEventListener('click', refreshClients);
    userFilterSelect.addEventListener('change', () => renderClients(cachedClients));
    autoToggle.addEventListener('change', startAutoRefresh);
    exportBtn.addEventListener('click', exportContentPack);
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', () => importContentPack(importFile.files?.[0]));
    savePasswordBtn.addEventListener('click', saveAssistPassword);

    if (sessionToken) {
        setStatus('Restoring session...');
        refreshClients().catch(() => {
            logoutAssist();
        });
        startAutoRefresh();
    }
})();
