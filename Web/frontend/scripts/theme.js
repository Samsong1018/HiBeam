// Theme: load this in <head> WITHOUT defer so the saved theme is applied
// before the page paints (no light-mode flash on dark-mode users).
// "system" (or nothing saved) follows the OS setting via CSS.
// A board can also carry its own theme (dashboard.theme = 'kiroween');
// DashTheme.board() applies that for the page without touching the saved choice.
(function () {
  const KEY = 'theme';
  const THEMES = ['light', 'dark', 'kiroween'];
  const root = document.documentElement;

  function read() {
    try {
      const stored = localStorage.getItem(KEY);
      return THEMES.includes(stored) ? stored : 'system';
    } catch (err) {
      return 'system';
    }
  }

  function apply(theme) {
    if (THEMES.includes(theme)) {
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

  // board theme wins while set; null/'' hands control back to the user's choice
  function board(theme) {
    apply(THEMES.includes(theme) ? theme : read());
  }

  apply(read());
  window.DashTheme = { get: read, set: set, board: board };
})();
