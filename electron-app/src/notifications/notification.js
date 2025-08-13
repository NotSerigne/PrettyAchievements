// notification.js
// Nouveau système de notification moderne
window.showNotification = function(message, duration = 3000, position = 'bottom-right') {
    console.log('[DEBUG][notification.js] showNotification', { message, duration, position });
    let root = document.getElementById('notification-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'notification-root';
        document.body.appendChild(root);
    }
    root.innerHTML = '';
    const notif = document.createElement('div');
    notif.className = 'pa-notification';
    notif.innerHTML = `<div class='pa-notification-title'>Notification</div><div class='pa-notification-message'>${message || ''}</div>`;
    notif.style.position = 'absolute';
    notif.style.margin = '0';
    // Positionnement dynamique selon le coin choisi
    let animation = '';
    switch (position) {
        case 'top-left':
            notif.style.top = '32px';
            notif.style.left = '32px';
            animation = 'pa-slide-down, pa-slide-right';
            break;
        case 'top-right':
            notif.style.top = '32px';
            notif.style.right = '32px';
            animation = 'pa-slide-down, pa-slide-left';
            break;
        case 'top-center':
            notif.style.top = '32px';
            notif.style.left = '50%';
            notif.style.transform = 'translateX(-50%)';
            animation = 'pa-slide-down';
            break;
        case 'bottom-left':
            notif.style.bottom = '32px';
            notif.style.left = '32px';
            animation = 'pa-slide-down, pa-slide-right';
            break;
        case 'bottom-right':
        default:
            notif.style.bottom = '32px';
            notif.style.right = '32px';
            animation = 'pa-slide-down, pa-slide-left';
            break;
        case 'bottom-center':
            notif.style.bottom = '32px';
            notif.style.left = '50%';
            notif.style.transform = 'translateX(-50%)';
            animation = 'pa-slide-down';
            break;
    }
    notif.style.animation = `${animation} 0.4s cubic-bezier(.4,2,.3,1) forwards`;
    root.appendChild(notif);
    setTimeout(() => {
        notif.style.opacity = '0';
        setTimeout(() => {
            if (notif.parentNode) notif.parentNode.removeChild(notif);
        }, 400);
    }, duration);
};

// Pour compatibilité : écoute l'IPC 'notification/show' si Electron
if (window.electronAPI && window.electronAPI.on) {
    window.electronAPI.on('notification/show', (data) => {
        console.log('[DEBUG][notification.js] notification/show event', data);
        window.showNotification(data.message, data.duration, data.position);
    });
}

// Ajout : support natif pour la fenêtre notification Electron
try {
    const { ipcRenderer } = require('electron');
    ipcRenderer.on('notification/show', (_event, data) => {
        window.showNotification(data.message, data.duration, data.position);
    });
} catch (_) {}
