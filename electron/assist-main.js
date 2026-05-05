const { app, BrowserWindow, dialog, Menu } = require('electron');
const path = require('path');

const APP_NAME = 'CalibreViewer Assist';
const DEFAULT_ASSIST_PORT = Number(process.env.CALIBREVIEWER_ASSIST_PORT || 38500);

let serverHandle;
let assistWindow;
let quitting = false;

function createAssistWindow(port) {
    assistWindow = new BrowserWindow({
        width: 1320,
        height: 860,
        minWidth: 1100,
        minHeight: 700,
        autoHideMenuBar: true,
        backgroundColor: '#090a12',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    Menu.setApplicationMenu(null);
    assistWindow.setMenuBarVisibility(false);

    assistWindow.loadURL(`http://127.0.0.1:${port}/assist.html`);
}

async function start() {
    try {
        const { startServer } = require('../server/index');
        serverHandle = await startServer({ port: DEFAULT_ASSIST_PORT, registerSignalHandlers: false });
        createAssistWindow(serverHandle.port);
    } catch (err) {
        dialog.showErrorBox('Assist Startup Error', `${APP_NAME} failed to start.\n\n${err?.message || err}`);
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

app.whenReady().then(() => {
    app.setName(APP_NAME);
    start();
});

app.on('before-quit', async (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    await stopServer();
    app.quit();
});

app.on('window-all-closed', () => {
    app.quit();
});
