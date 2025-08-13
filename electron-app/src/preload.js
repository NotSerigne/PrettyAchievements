// pretty-achievements/electron-app/src/preload.js
const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // invoke (promesse)
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

    // send (fire-and-forget)
    send: (channel, ...args) => {
        ipcRenderer.send(channel, ...args);
    },

    // écoute simple (callback)
    on: (channel, listener) => {
        const wrapped = (event, ...args) => listener(...args);
        ipcRenderer.on(channel, wrapped);
        return () => ipcRenderer.removeListener(channel, wrapped);
    },

    // ouvrir une URL externe en sécurité
    openExternal: (url) => shell.openExternal(url)
});

console.log('[preload] Chargé dans la fenêtre:', window.location.pathname);
