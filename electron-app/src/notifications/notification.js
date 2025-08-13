// notification.js
// Système de notification supprimé. Ce fichier ne fait plus rien.
window.showNotification = function(message, duration = 3000, position) {
    // Envoie l'IPC au main process pour afficher la notification dans une fenêtre dédiée
    if (window.electronAPI && window.electronAPI.send) {
        window.electronAPI.send('show-custom-notification', {
            message,
            duration,
            position
        });
    }
};

// Ajout : écoute l'IPC 'notification/show' pour afficher la notification dans la fenêtre dédiée
if (window.electronAPI && window.electronAPI.on) {
    window.electronAPI.on('notification/show', (data) => {
        let root = document.getElementById('notification-root');
        if (!root) {
            root = document.getElementById('notification-container');
            if (!root) return;
        }
        root.innerHTML = '';
        root.style.position = 'relative';
        root.style.top = '';
        root.style.left = '';
        root.style.right = '';
        root.style.bottom = '';
        root.style.transform = '';
        const notif = document.createElement('div');
        notif.className = 'pa-notification';
        notif.innerHTML = `<div class='pa-notification-title'>Notification</div><div class='pa-notification-message'>${data.message || ''}</div>`;
        notif.style.position = 'absolute';
        notif.style.margin = '0';
        notif.style.left = '';
        notif.style.right = '';
        notif.style.top = '';
        notif.style.bottom = '';
        notif.style.transform = '';
        // Positionnement brut selon la position reçue
        switch (data.position) {
            case 'top-left':
                notif.style.top = '32px';
                notif.style.left = '32px';
                break;
            case 'top-center':
                notif.style.top = '32px';
                notif.style.left = '50%';
                notif.style.transform = 'translateX(-50%)';
                break;
            case 'top-right':
                notif.style.top = '32px';
                notif.style.right = '32px';
                break;
            case 'bottom-left':
                notif.style.bottom = '32px';
                notif.style.left = '32px';
                break;
            case 'bottom-center':
                notif.style.bottom = '32px';
                notif.style.left = '50%';
                notif.style.transform = 'translateX(-50%)';
                break;
            case 'bottom-right':
                notif.style.bottom = '32px';
                notif.style.right = '32px';
                break;
            default:
                notif.style.top = '50%';
                notif.style.left = '50%';
                notif.style.transform = 'translate(-50%, -50%)';
        }
        root.appendChild(notif);
        setTimeout(() => {
            notif.style.opacity = '0';
        }, 3000);
    });
}
