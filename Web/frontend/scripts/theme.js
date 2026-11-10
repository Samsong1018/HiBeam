// Theme: load this in <head> WITHOUT defer so the saved theme is applied
// before the page paints (no light-mode flash on dark-mode users).
// "system" (or nothing saved) follows the OS setting via CSS.
(function () {
  const KEY = 'theme';
  const root = document.documentElement;

  function read() {
    try {
      const stored = localStorage.getItem(KEY);
      return stored === 'light' || stored === 'dark' ? stored : 'system';
    } catch (err) {
      return 'system';
    }
  }

  function apply(theme) {
    if (theme === 'light' || theme === 'dark') {
      root.setAttribute('data-theme', theme);
    } else {
      root.removeAttribute('data-theme');
    }
  }

  function set(theme) {
    apply(theme);
    try {
      if (theme === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch (err) {
      // storage blocked (private mode) — theme still applies for this page view
    }
  }

  apply(read());
  window.DashTheme = { get: read, set: set };
})();
