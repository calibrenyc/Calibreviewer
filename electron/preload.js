const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
	getAppMeta: () => ipcRenderer.invoke('desktop:get-app-meta'),
	setUpdateRepo: (repo) => ipcRenderer.invoke('desktop:set-update-repo', repo),
	pickUpdateFolder: () => ipcRenderer.invoke('desktop:pick-update-folder'),
	checkLocalUpdate: () => ipcRenderer.invoke('desktop:check-local-update'),
	checkGithubUpdate: () => ipcRenderer.invoke('desktop:check-github-update')
});
