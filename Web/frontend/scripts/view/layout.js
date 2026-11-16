// ============================================================
// VIEWER LAYOUT
// Pure helpers, no DOM: where each widget sits on the read-only board.
// Covered by tests/view-layout.test.mjs.
// ============================================================

// Top-to-bottom, then left-to-right. Used for DOM order so tabbing and the
// stacked phone layout read the dashboard the way you'd scan it.
export function readingOrder(widgets) {
  return [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);
}

// CSS grid lines are 1-based; widget positions are 0-based cells.
export function placement({ x, y, w, h }) {
  return {
    gridColumn: `${x + 1} / span ${w}`,
    gridRow: `${y + 1} / span ${h}`,
  };
}

// Square cells: one row is as tall as one column is wide.
export function cellSize(boardWidth, columns) {
  if (!(boardWidth > 0) || !(columns > 0)) return 0;
  return boardWidth / columns;
}

// "Updated …" label: relative while it's fresh, a date once it isn't.
export function updatedLabel(date, now = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (seconds < 45) return 'Updated just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const sameYear = date.getFullYear() === now.getFullYear();
  return `Updated ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })}`;
}
