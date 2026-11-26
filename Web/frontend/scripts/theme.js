// Theme: load this in <head> WITHOUT defer so the saved theme is applied
// before the page paints (no light-mode flash on dark-mode users).
// "system" (or nothing saved) follows the OS setting via CSS.
// A board can also carry its own theme (dashboard.theme = 'kiroween');
// DashTheme.board() applies that for the page without touching the saved choice.
// The board's theme is only known after its fetch, so on /view/:id and /edit/:id
// we remember the last theme each board used and apply it before first paint.
// On a board we've never seen, the page stays hidden (data-theme-pending) until
// board() runs or a short failsafe fires, instead of flashing the wrong theme.
(function () {
  const KEY = 'theme';
  const BOARD_KEY = 'boardTheme:';
  const THEMES = ['light', 'dark', 'kiroween'];
  const PENDING_FAILSAFE_MS = 1500;
  const root = document.documentElement;
  const boardMatch = /^\/(?:view|edit)\/([^/?#]+)/.exec(window.location.pathname);
  const boardId = boardMatch ? boardMatch[1] : null;

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

  function readBoard() {
    if (!boardId) return null;
    try {
      return localStorage.getItem(BOARD_KEY + boardId);
    } catch (err) {
      return null;
    }
  }

  function rememberBoard(theme) {
    if (!boardId) return;
    try {
      if (THEMES.includes(theme)) localStorage.setItem(BOARD_KEY + boardId, theme);
      else localStorage.setItem(BOARD_KEY + boardId, 'none');
    } catch (err) {
      // storage blocked — we just get the first-visit behaviour next time too
    }
  }

  function reveal() {
    root.removeAttribute('data-theme-pending');
  }

  // board theme wins while set; null/'' hands control back to the user's choice
  function board(theme) {
    apply(THEMES.includes(theme) ? theme : read());
    rememberBoard(theme);
    reveal();
  }

  const knownBoard = readBoard();
  if (THEMES.includes(knownBoard)) {
    apply(knownBoard);
  } else {
    apply(read());
    if (boardId && knownBoard !== 'none') {
      root.setAttribute('data-theme-pending', '');
      setTimeout(reveal, PENDING_FAILSAFE_MS);
    }
  }
  window.DashTheme = { get: read, set: set, board: board };
})();
