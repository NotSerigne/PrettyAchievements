// Notifications module - central entry point
window.PANotifications = {
  async show({ title = 'Pretty Achievements', message = '', type = 'info', duration = 4000, position } = {}) {
    try {
      const pos = position || (localStorage.getItem('notifyPosition') || 'bottom-right');
      await window.electronAPI?.invoke?.('notify/custom', {
        title,
        message,
        type,
        duration,
        position: pos
      });
    } catch (_) {
      // Fallback: no-op (in-app system removed)
    }
  }
};
