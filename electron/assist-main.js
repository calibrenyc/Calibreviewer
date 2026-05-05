const { app, BrowserWindow, dialog, Menu } = require('electron');

const APP_NAME = 'CalibreViewer Assist';
const DEFAULT_TARGET_PORT = Number(process.env.CALIBREVIEWER_PORT || process.env.PORT || 38400);
const ASSIST_TARGET_URL = process.env.ASSIST_TARGET_URL || `http://127.0.0.1:${DEFAULT_TARGET_PORT}`;

let assistWindow;
let quitting = false;

function createAssistWindow() {
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

    assistWindow.webContents.on('did-fail-load', () => {
        dialog.showErrorBox(
            'Assist Connection Error',
            `${APP_NAME} could not connect to ${ASSIST_TARGET_URL}.\n\nStart CalibreViewer first, then relaunch Assist.`
        );
    });

    assistWindow.loadURL(`${ASSIST_TARGET_URL}/assist.html`);
}

app.whenReady().then(() => {
    app.setName(APP_NAME);
    createAssistWindow();
});

app.on('before-quit', async (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    app.quit();
});

app.on('window-all-closed', () => {
    app.quit();
});
