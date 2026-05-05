const { app, BrowserWindow, shell, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_NAME = 'CalibreViewer';
const APP_ID = 'com.calibreviewer.desktop';

// In development (running `electron electron/main.js`) the default app name is "Electron".
// Set identity early so userData and Windows AppUserModelId are correct.
try {
    app.setName(APP_NAME);
    app.setAppUserModelId(APP_ID);
} catch {
    // ignore
}

let serverHandle;
let quitting = false;
let ipcRegistered = false;
let splashWindow;

const UPDATE_CONFIG_FILE = 'local-update.json';
const DEFAULT_GITHUB_REPO = 'calibrenyc/Calibreviewer';

function parseVersion(version) {
    if (!version) return null;

    const clean = String(version).trim().replace(/^v/i, '').split('-')[0];
    const raw = clean.split('.').map(p => Number.parseInt(p, 10));
    if (!raw.length || raw.some(Number.isNaN)) return null;

    while (raw.length < 3) raw.push(0);
    return raw.slice(0, 3);
}

function compareVersions(a, b) {
    for (let i = 0; i < 3; i += 1) {
        const diff = (a[i] || 0) - (b[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

function extractVersionFromName(fileName) {
    if (!fileName) return null;

    const match = fileName.match(/(\d+\.\d+\.\d+(?:\.\d+)?)/);
    if (!match) return null;

    const parts = match[1].split('.').slice(0, 3);
    return parts.join('.');
}

function getUpdateConfigPath() {
    return path.join(app.getPath('userData'), UPDATE_CONFIG_FILE);
}

function readUpdateConfig() {
    try {
        const configPath = getUpdateConfigPath();
        if (!fs.existsSync(configPath)) return {};
        return JSON.parse(fs.readFileSync(configPath, 'utf8')) || {};
    } catch {
        return {};
    }
}

function writeUpdateConfig(partial) {
    const next = { ...readUpdateConfig(), ...(partial || {}) };
    const configPath = getUpdateConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf8');
    return next;
}

function getDefaultUpdateFolder() {
    return path.join(app.getPath('downloads'), 'CalibreViewerUpdates');
}

function getLocalUpdateFolder() {
    try {
        const config = readUpdateConfig();
        if (config?.folderPath && fs.existsSync(config.folderPath)) {
            return config.folderPath;
        }
    } catch {
        // ignore and fall back to default
    }

    return getDefaultUpdateFolder();
}

function saveLocalUpdateFolder(folderPath) {
    writeUpdateConfig({ folderPath });
}

function normalizeGithubRepoInput(value) {
    if (typeof value !== 'string') return '';

    let raw = value.trim();
    if (!raw) return '';

    // Accept full URLs like https://github.com/owner/repo(.git)
    if (/^https?:\/\//i.test(raw)) {
        try {
            const parsed = new URL(raw);
            if (/github\.com$/i.test(parsed.hostname)) {
                raw = parsed.pathname;
            }
        } catch {
            return '';
        }
    }

    raw = raw
        .replace(/^github\.com\//i, '')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '')
        .replace(/\.git$/i, '');

    const parts = raw.split('/').filter(Boolean);
    if (parts.length < 2) return '';

    const owner = parts[0];
    const repo = parts[1];
    const normalized = `${owner}/${repo}`;

    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
        return '';
    }

    return normalized;
}

function getGithubRepo() {
    const config = readUpdateConfig();
    const configuredRepo = normalizeGithubRepoInput(config.githubRepo || '');
    return configuredRepo || DEFAULT_GITHUB_REPO;
}

function normalizeVersionString(value) {
    if (!value) return null;
    const raw = String(value).trim().replace(/^v/i, '').split('-')[0];
    const parsed = parseVersion(raw);
    if (!parsed) return null;
    return parsed.join('.');
}

async function fetchGithubPackageVersion(repo, headers) {
    const branches = ['main', 'master'];

    for (const branch of branches) {
        const url = `https://api.github.com/repos/${repo}/contents/package.json?ref=${branch}`;
        const response = await fetch(url, { headers });
        if (!response.ok) continue;

        const payload = await response.json();
        const encoded = payload?.content;
        if (!encoded) continue;

        try {
            const content = Buffer.from(String(encoded).replace(/\n/g, ''), 'base64').toString('utf8');
            const pkg = JSON.parse(content);
            const version = normalizeVersionString(pkg?.version);
            if (!version) continue;

            return {
                version,
                branch,
                url: `https://github.com/${repo}/blob/${branch}/package.json`
            };
        } catch {
            // ignore malformed package file and continue
        }
    }

    return null;
}

async function fetchGithubUpdateInfo(repo) {
    const headers = {
        'User-Agent': `${APP_NAME}/${app.getVersion()}`,
        'Accept': 'application/vnd.github+json'
    };

    const latestReleaseUrl = `https://api.github.com/repos/${repo}/releases/latest`;
    const latestResponse = await fetch(latestReleaseUrl, { headers });

    if (latestResponse.ok) {
        const payload = await latestResponse.json();
        const latestVersion = normalizeVersionString(payload.tag_name || payload.name);
        if (latestVersion) {
            const windowsAsset = Array.isArray(payload.assets)
                ? payload.assets.find(asset => /\.(exe|msi)$/i.test(asset?.name || ''))
                : null;

            return {
                source: 'release',
                latestVersion,
                latestTag: payload.tag_name || `v${latestVersion}`,
                latestFile: windowsAsset?.name || null,
                downloadUrl: windowsAsset?.browser_download_url || payload.html_url || null,
                releaseUrl: payload.html_url || null
            };
        }
    }

    let tagsError = null;
    const tagsUrl = `https://api.github.com/repos/${repo}/tags?per_page=20`;
    const tagsResponse = await fetch(tagsUrl, { headers });

    if (tagsResponse.ok) {
        const tags = await tagsResponse.json();
        const versions = (Array.isArray(tags) ? tags : [])
            .map(tag => {
                const name = tag?.name || '';
                const normalized = normalizeVersionString(name);
                const parsed = parseVersion(normalized);
                if (!normalized || !parsed) return null;
                return {
                    latestVersion: normalized,
                    latestTag: name,
                    parsed,
                    releaseUrl: `https://github.com/${repo}/releases/tag/${encodeURIComponent(name)}`
                };
            })
            .filter(Boolean)
            .sort((a, b) => compareVersions(b.parsed, a.parsed));

        if (versions.length) {
            return {
                source: 'tag',
                ...versions[0],
                latestFile: null,
                downloadUrl: versions[0].releaseUrl
            };
        }

        tagsError = 'No valid semantic version tags found';
    } else {
        tagsError = `GitHub API error (${tagsResponse.status})`;
    }

    const pkgFallback = await fetchGithubPackageVersion(repo, headers);
    if (pkgFallback) {
        return {
            source: 'package-json',
            latestVersion: pkgFallback.version,
            latestTag: `${pkgFallback.branch}/package.json`,
            latestFile: 'package.json',
            downloadUrl: pkgFallback.url,
            releaseUrl: pkgFallback.url
        };
    }

    throw new Error(tagsError || 'No tags or package.json version found in repository');
}

function findLatestLocalUpdate(folderPath) {
    if (!folderPath || !fs.existsSync(folderPath)) {
        return { found: false, candidates: 0, latestVersion: null, latestFile: null };
    }

    const files = fs.readdirSync(folderPath, { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .filter(name => /\.(exe|msi|zip)$/i.test(name));

    const candidates = files
        .map(name => {
            const version = extractVersionFromName(name);
            const parsed = parseVersion(version);
            if (!parsed) return null;
            return { name, version, parsed };
        })
        .filter(Boolean)
        .sort((a, b) => compareVersions(b.parsed, a.parsed));

    if (!candidates.length) {
        return { found: false, candidates: 0, latestVersion: null, latestFile: null };
    }

    return {
        found: true,
        candidates: candidates.length,
        latestVersion: candidates[0].version,
        latestFile: candidates[0].name
    };
}

function registerDesktopIpc() {
    if (ipcRegistered) return;
    ipcRegistered = true;

    ipcMain.handle('desktop:get-app-meta', async () => {
        return {
            appName: APP_NAME,
            appVersion: app.getVersion(),
            updateFolder: getLocalUpdateFolder(),
            updateRepo: getGithubRepo()
        };
    });

    ipcMain.handle('desktop:set-update-repo', async (_event, repo) => {
        const normalized = normalizeGithubRepoInput(repo);
        if (!normalized) {
            return {
                ok: false,
                repo: getGithubRepo(),
                message: 'Invalid repository format. Use owner/repo or a GitHub URL.'
            };
        }

        writeUpdateConfig({ githubRepo: normalized });
        return {
            ok: true,
            repo: normalized,
            message: `Update repository set to ${normalized}`
        };
    });

    ipcMain.handle('desktop:pick-update-folder', async () => {
        const result = await dialog.showOpenDialog({
            title: 'Select local update folder',
            properties: ['openDirectory', 'createDirectory']
        });

        if (result.canceled || !result.filePaths?.length) {
            return {
                canceled: true,
                folderPath: getLocalUpdateFolder()
            };
        }

        const folderPath = result.filePaths[0];
        saveLocalUpdateFolder(folderPath);

        return {
            canceled: false,
            folderPath
        };
    });

    ipcMain.handle('desktop:check-local-update', async () => {
        const currentVersion = app.getVersion();
        const currentParsed = parseVersion(currentVersion);
        const checkedFolder = getLocalUpdateFolder();
        const latest = findLatestLocalUpdate(checkedFolder);

        if (!latest.found) {
            return {
                checkedFolder,
                currentVersion,
                updateAvailable: false,
                filesScanned: latest.candidates,
                message: 'No update files found in the selected folder.'
            };
        }

        const latestParsed = parseVersion(latest.latestVersion);
        const updateAvailable = !!(latestParsed && currentParsed && compareVersions(latestParsed, currentParsed) > 0);

        return {
            checkedFolder,
            currentVersion,
            latestVersion: latest.latestVersion,
            latestFile: latest.latestFile,
            filesScanned: latest.candidates,
            updateAvailable,
            message: updateAvailable
                ? `Update available: v${latest.latestVersion} (${latest.latestFile})`
                : `You are up to date. Latest local file is v${latest.latestVersion}.`
        };
    });

    ipcMain.handle('desktop:check-github-update', async () => {
        const repo = getGithubRepo();
        const currentVersion = app.getVersion();
        const currentParsed = parseVersion(currentVersion);

        try {
            const remote = await fetchGithubUpdateInfo(repo);
            const latestParsed = parseVersion(remote.latestVersion);
            const updateAvailable = !!(latestParsed && currentParsed && compareVersions(latestParsed, currentParsed) > 0);

            return {
                source: remote.source,
                repo,
                currentVersion,
                latestVersion: remote.latestVersion,
                latestTag: remote.latestTag,
                latestFile: remote.latestFile,
                downloadUrl: remote.downloadUrl,
                releaseUrl: remote.releaseUrl,
                updateAvailable,
                message: updateAvailable
                    ? `Update available: v${remote.latestVersion}${remote.latestFile ? ` (${remote.latestFile})` : ''}`
                    : `You are up to date (v${currentVersion}). Latest on GitHub is v${remote.latestVersion}.`
            };
        } catch (error) {
            const statusMessage = String(error?.message || 'Unknown error').includes('(404)')
                ? 'Repository not found or private. Verify the update repository setting.'
                : (error?.message || 'Unknown error');

            return {
                repo,
                currentVersion,
                updateAvailable: false,
                error: true,
                message: `Failed to check GitHub updates: ${statusMessage}`
            };
        }
    });

    ipcMain.handle('desktop:open-external-url', async (_event, url) => {
        try {
            if (typeof url !== 'string' || !url.trim()) {
                return { ok: false, message: 'Missing URL.' };
            }

            const parsed = new URL(url);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                return { ok: false, message: 'Only http/https URLs are allowed.' };
            }

            await shell.openExternal(parsed.toString());
            return { ok: true };
        } catch (error) {
            return {
                ok: false,
                message: `Failed to open URL: ${error?.message || 'Unknown error'}`
            };
        }
    });
}

function configureUserDataPath() {
    // Pick a stable per-user folder for app data.
    // Also supports migration from older app names.
    try {
        const appData = app.getPath('appData');

        const desiredUserData = path.join(appData, APP_NAME);
        const oldCandidates = [
            path.join(appData, 'nodecast-tv'),
            path.join(appData, 'NodeCast TV')
        ];

        for (const candidate of oldCandidates) {
            const hasOldData =
                fs.existsSync(path.join(candidate, 'data')) ||
                fs.existsSync(path.join(candidate, 'transcode-cache'));

            if (hasOldData) {
                app.setPath('userData', candidate);
                return;
            }
        }

        app.setPath('userData', desiredUserData);
    } catch {
        // ignore
    }
}

function setWritablePathsEnv() {
    // In packaged apps, the installation folder/app.asar is not writable.
    // Use Electron's per-user data directory for DB/cache/transcode temp files.
    const userData = app.getPath('userData');

    process.env.NODECAST_DATA_DIR = process.env.NODECAST_DATA_DIR || path.join(userData, 'data');
    process.env.NODECAST_TRANSCODE_CACHE_DIR = process.env.NODECAST_TRANSCODE_CACHE_DIR || path.join(userData, 'transcode-cache');
}

function createSplashWindow() {
        if (splashWindow && !splashWindow.isDestroyed()) {
                return splashWindow;
        }

        splashWindow = new BrowserWindow({
                width: 420,
                height: 300,
                frame: false,
                resizable: false,
                movable: true,
                minimizable: false,
                maximizable: false,
                fullscreenable: false,
                show: true,
                center: true,
                alwaysOnTop: true,
                autoHideMenuBar: true,
                backgroundColor: '#0a0a0f',
                webPreferences: {
                        contextIsolation: true,
                        nodeIntegration: false,
                        sandbox: true
                }
        });

        splashWindow.setMenuBarVisibility(false);

        const splashHtml = `<!doctype html>
<html>
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
        :root { color-scheme: dark; }
        body {
            margin: 0;
            height: 100vh;
            display: grid;
            place-items: center;
            background: radial-gradient(circle at 20% 20%, #1a1a25, #0a0a0f 60%);
            font-family: Inter, Segoe UI, sans-serif;
            color: #f1f1f5;
        }
        .wrap { text-align: center; }
        .logo {
            font-size: 24px;
            font-weight: 600;
            letter-spacing: 0.2px;
            margin-bottom: 14px;
        }
        .spinner {
            width: 32px;
            height: 32px;
            margin: 0 auto 12px;
            border: 3px solid rgba(99, 102, 241, 0.28);
            border-top-color: #6366f1;
            border-radius: 50%;
            animation: spin .8s linear infinite;
        }
        .hint {
            font-size: 13px;
            color: #a1a1aa;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div class="wrap">
        <div class="logo">CalibreViewer</div>
        <div class="spinner"></div>
        <div class="hint">Starting up...</div>
    </div>
</body>
</html>`;

        splashWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(splashHtml)}`);
        splashWindow.on('closed', () => {
                splashWindow = undefined;
        });

        return splashWindow;
}

function closeSplashWindow() {
        if (!splashWindow || splashWindow.isDestroyed()) return;
        splashWindow.close();
        splashWindow = undefined;
}

async function createMainWindow(port) {
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 680,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: '#0a0a0f',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // Remove classic "File/Edit/View..." menu bar for a cleaner app-like feel.
    win.setMenuBarVisibility(false);

    // Open external links in the user's default browser
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => {
        const isLocal = url.startsWith(`http://127.0.0.1:${port}`) || url.startsWith(`http://localhost:${port}`);
        if (!isLocal) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });

    if (process.env.NODE_ENV === 'development') {
        win.webContents.openDevTools({ mode: 'detach' });
    }

    // Show only after the renderer is ready to reduce initial flicker/blank frames.
    win.once('ready-to-show', () => {
        win.show();
        closeSplashWindow();
    });

    await win.loadURL(`http://127.0.0.1:${port}`);

    return win;
}

async function start() {
    configureUserDataPath();
    setWritablePathsEnv();
    registerDesktopIpc();
    createSplashWindow();

    try {
        const { startServer } = require('../server/index');
        serverHandle = await startServer({ port: 0, registerSignalHandlers: false });

        await createMainWindow(serverHandle.port);
    } catch (err) {
        closeSplashWindow();
        dialog.showErrorBox('Startup Error', `CalibreViewer failed to start.\n\n${err?.message || err}`);
        app.quit();
    }
}

async function stopServer() {
    if (!serverHandle) return;

    try {
        await serverHandle.shutdownPlugins?.();
    } catch {
        // ignore
    }

    await new Promise((resolve) => {
        try {
            serverHandle.server.close(() => resolve());
        } catch {
            resolve();
        }
    });

    serverHandle = undefined;
}

app.whenReady().then(start);

app.whenReady().then(() => {
    // Removes top-level desktop menu globally (Windows/Linux).
    Menu.setApplicationMenu(null);
});

app.on('before-quit', async (event) => {
    if (quitting) return;

    quitting = true;
    event.preventDefault();

    await stopServer();
    app.quit();
});

app.on('window-all-closed', () => {
    // On macOS, apps typically stay running with no windows.
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', async () => {
    // Re-create window on macOS when clicking dock icon.
    if (BrowserWindow.getAllWindows().length === 0) {
        if (!serverHandle) {
            await start();
        } else {
            await createMainWindow(serverHandle.port);
        }
    }
});
