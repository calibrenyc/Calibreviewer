const path = require('path');

function getDataDir() {
    // For Electron/packaged environments, set this to a writable path.
    // Example: %APPDATA%/<app>/data via Electron's app.getPath('userData')
    if (process.env.NODECAST_DATA_DIR) {
        return process.env.NODECAST_DATA_DIR;
    }

    // Default (dev/server usage): repo-local ./data
    return path.join(__dirname, '..', 'data');
}

function getCacheDir() {
    return path.join(getDataDir(), 'cache');
}

function getTranscodeCacheDir() {
    if (process.env.NODECAST_TRANSCODE_CACHE_DIR) {
        return process.env.NODECAST_TRANSCODE_CACHE_DIR;
    }

    // Default behavior preserved for existing setups.
    return path.join(process.cwd(), 'transcode-cache');
}

module.exports = {
    getDataDir,
    getCacheDir,
    getTranscodeCacheDir
};
