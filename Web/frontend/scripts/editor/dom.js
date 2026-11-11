// ============================================================
// DOM HELPERS
// Everything user-provided goes in through textContent / attributes,
// never innerHTML, so dashboard titles and source names can't inject markup.
// ============================================================

// h('button', { class: 'btn', onclick: fn }, 'Label')
// - props set as attributes, except event handlers (on*), `dataset`,
//   and DOM properties with non-string values (checked, disabled, value)
// - `value` is applied after children so <select> options exist first
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  let deferredValue;

  Object.entries(props || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === false) return;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'value') deferredValue = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (typeof value !== 'string' && key in el) el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  });

  children.flat(Infinity).forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    el.append(child instanceof Node ? child : String(child));
  });

  if (deferredValue !== undefined) el.value = deferredValue;
  return el;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

// ------------------------------------------------------------
// Toast (same markup/behaviour as the account page)
// ------------------------------------------------------------
let toastTimer;

export function toast(message, isError = false) {
  const toastEl = document.getElementById('toast');
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.toggle('is-error', isError);
  toastEl.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 3200);
}

export function setLoading(button, isLoading) {
  button.disabled = isLoading;
  button.classList.toggle('is-loading', isLoading);
}

// ------------------------------------------------------------
// Misc
// ------------------------------------------------------------
export function uid(prefix = 'w') {
  const random = globalThis.crypto?.randomUUID
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${random}`;
}

export function isTypingTarget(target) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

export function relativeTime(date) {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
