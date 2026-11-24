// ============================================================
// FIT ROWS
// Show only the rows that fit whole in a box, with a "+N more" button
// that switches the box to scrolling. Exports and screenshots then never
// cut a row in half. Used by the table and the uptime strip.
// ============================================================

/**
 * @param {HTMLElement} wrap  the box that clips (gets .is-expanded when opened)
 * @param {HTMLButtonElement} more  the "+N more" button after it
 * @param {{ rows?: string, head?: string, noun?: string }} [opts]
 *   rows: selector for the rows inside wrap, head: a sticky header to leave room for
 * @returns {() => void} cleanup
 */
export function fitRows(wrap, more, { rows: rowSelector = 'tbody tr', head = 'thead', noun = 'row' } = {}) {
  let expanded = false;
  const rowsOf = () => [...wrap.querySelectorAll(rowSelector)];
  const label = (n) => `+${n.toLocaleString()} more ${noun}${n === 1 ? '' : 's'}`;
  // how many rows fit whole in the wrap at its current height
  const countFitting = (rows) => {
    const room = wrap.clientHeight - ((head && wrap.querySelector(head)?.offsetHeight) || 0);
    let used = 0;
    let n = 0;
    for (const r of rows) {
      used += r.offsetHeight;
      if (used > room) break;
      n += 1;
    }
    return n;
  };
  const fit = () => {
    if (expanded) return;
    const rows = rowsOf();
    rows.forEach((r) => { r.hidden = false; });
    more.hidden = true;
    let shown = countFitting(rows);
    if (shown < rows.length) {
      more.textContent = label(0);
      more.hidden = false; // the footer takes space from the wrap, so measure again
      shown = Math.max(countFitting(rows), 1);
    }
    rows.forEach((r, i) => { r.hidden = i >= shown; });
    const hidden = rows.length - shown;
    more.hidden = hidden <= 0;
    more.textContent = label(hidden);
  };
  more.addEventListener('click', () => {
    expanded = true;
    rowsOf().forEach((r) => { r.hidden = false; });
    wrap.classList.add('is-expanded');
    more.hidden = true;
  });
  const observer = new ResizeObserver(() => requestAnimationFrame(fit));
  observer.observe(wrap);
  return () => observer.disconnect();
}
