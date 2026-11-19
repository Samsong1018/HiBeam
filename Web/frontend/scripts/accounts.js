// ============================================================
// ACCOUNT PAGE
// All calls go to the real backend.
// ============================================================

const api = {
  async request(pMethod, pPath, pBody)
  {
    const tmpOpts = {
      method: pMethod,
      credentials: "same-origin"
    };
    if (pBody !== undefined)
    {
      tmpOpts.headers = { "Content-Type": "application/json" };
      tmpOpts.body = JSON.stringify(pBody);
    }
    const tmpRes = await fetch(pPath, tmpOpts);
    const tmpJson = await tmpRes.json().catch(() => ({}));
    if (!tmpRes.ok || tmpJson.success === false)
    {
      throw new Error(tmpJson.error || `Request failed (${tmpRes.status})`);
    }
    return tmpJson;
  },

  async uploadAvatar(pFile)
  {
    const tmpRes = await fetch("/api/account/avatar", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": pFile.type },
      body: pFile
    });
    const tmpJson = await tmpRes.json().catch(() => ({}));
    if (!tmpRes.ok || tmpJson.success === false)
    {
      throw new Error(tmpJson.error || `Upload failed (${tmpRes.status})`);
    }
    return tmpJson;
  }
};

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
const toastEl = document.getElementById('toast');
let toastTimer;

function toast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle('is-error', isError);
  toastEl.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 3200);
}

function setLoading(button, isLoading) {
  button.disabled = isLoading;
  button.classList.toggle('is-loading', isLoading);
}

function setFieldError(input, message) {
  const errorEl = document.querySelector(`[data-error-for="${input.id}"]`);
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  if (errorEl) errorEl.textContent = message || '';
}

function clearErrors(form) {
  form.querySelectorAll('input').forEach((input) => setFieldError(input, ''));
}

// Runs validate(); if it returns {inputId: message}, shows them and stops.
// Otherwise sends the request with a loading button and a toast either way.
async function handleSubmit(form, { validate, send, success }) {
  clearErrors(form);
  const errors = validate ? validate() : {};
  const ids = Object.keys(errors);
  if (ids.length) {
    ids.forEach((id) => setFieldError(document.getElementById(id), errors[id]));
    document.getElementById(ids[0]).focus();
    return;
  }

  const button = form.querySelector('[type="submit"]');
  setLoading(button, true);
  try {
    await send();
    toast(typeof success === 'function' ? success() : success);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Something went wrong. Try again.', true);
  } finally {
    setLoading(button, false);
  }
}

function initialsFor(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || '?';
}

// ------------------------------------------------------------
// 01 Profile
// ------------------------------------------------------------
const profileForm = document.getElementById('profile-form');
const displayNameInput = document.getElementById('display-name');
const usernameInput = document.getElementById('username');

profileForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const displayName = displayNameInput.value.trim();
  const username = usernameInput.value.trim().toLowerCase();

  handleSubmit(profileForm, {
    validate: () => {
      const errors = {};
      if (!displayName) errors['display-name'] = 'Display name is required.';
      if (!USERNAME_RE.test(username)) errors.username = 'Use 3–24 lowercase letters, numbers or underscores.';
      return errors;
    },
    send: async () => {
      await api.request('PATCH', '/api/account/profile', { displayName, username });
      document.querySelector('[data-display-name]').textContent = displayName;
      document.querySelector('[data-username]').textContent = `@${username}`;
      document.querySelectorAll('[data-avatar-initials]').forEach((el) => { el.textContent = initialsFor(displayName); });
    },
    success: 'Profile saved',
  });
});

// Avatar upload — previewed locally, uploaded on pick
const avatarInput = document.getElementById('avatar-input');
const avatarError = document.getElementById('avatar-error');
let avatarUrl = null;

function showAvatar(url) {
  if (avatarUrl) URL.revokeObjectURL(avatarUrl);
  avatarUrl = url;
  document.querySelectorAll('[data-avatar]').forEach((avatar) => {
    const img = avatar.querySelector('[data-avatar-img]');
    const initials = avatar.querySelector('[data-avatar-initials]');
    img.hidden = !url;
    initials.hidden = Boolean(url);
    if (url) img.src = url;
    else img.removeAttribute('src');
  });
}

avatarInput.addEventListener('change', async () => {
  const file = avatarInput.files[0];
  avatarInput.value = '';
  avatarError.textContent = '';
  if (!file) return;
  if (!AVATAR_TYPES.includes(file.type)) {
    avatarError.textContent = 'That file type isn\'t supported. Use PNG, JPG or WebP.';
    return;
  }
  if (file.size > MAX_AVATAR_BYTES) {
    avatarError.textContent = 'That image is over 2 MB.';
    return;
  }
  showAvatar(URL.createObjectURL(file));
  try {
    await api.uploadAvatar(file);
    toast('Photo updated');
  } catch (err) {
    showAvatar(null);
    toast('Couldn\'t upload photo', true);
  }
});

document.getElementById('avatar-remove').addEventListener('click', () => {
  showAvatar(null);
  api.request('DELETE', '/api/account/avatar').then(() => toast('Photo removed'));
});

// ------------------------------------------------------------
// 02 Security
// ------------------------------------------------------------
document.querySelectorAll('[data-toggle-password]').forEach((button) => {
  const input = document.getElementById(button.dataset.togglePassword);
  button.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.textContent = show ? 'Hide' : 'Show';
    button.setAttribute('aria-pressed', String(show));
    button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
});

const newPasswordInput = document.getElementById('new-password');
const strengthEl = document.querySelector('.strength');
const strengthLabel = document.getElementById('strength-label');
const STRENGTH_LABELS = ['At least 10 characters.', 'Weak', 'Okay', 'Good', 'Strong'];

function scorePassword(value) {
  if (!value) return 0;
  let score = value.length >= 10 ? 1 : 0;
  if (value.length >= 14) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
  return Math.max(1, Math.min(score, 4));
}

newPasswordInput.addEventListener('input', () => {
  const score = scorePassword(newPasswordInput.value);
  strengthEl.dataset.strength = String(score);
  strengthLabel.textContent = STRENGTH_LABELS[score];
});

const passwordForm = document.getElementById('password-form');
passwordForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const current = document.getElementById('current-password').value;
  const next = newPasswordInput.value;
  const confirm = document.getElementById('confirm-password').value;

  handleSubmit(passwordForm, {
    validate: () => {
      const errors = {};
      if (!current) errors['current-password'] = 'Enter your current password.';
      if (next.length < 10) errors['new-password'] = 'Use at least 10 characters.';
      else if (next === current) errors['new-password'] = 'Pick something different from your current password.';
      if (confirm !== next) errors['confirm-password'] = 'Passwords don\'t match.';
      return errors;
    },
    send: async () => {
      await api.request('POST', '/api/account/password', { currentPassword: current, newPassword: next });
      passwordForm.reset();
      strengthEl.dataset.strength = '0';
      strengthLabel.textContent = STRENGTH_LABELS[0];
    },
    success: 'Password updated',
  });
});

const emailForm = document.getElementById('email-form');
emailForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const newEmail = document.getElementById('new-email').value.trim();
  const password = document.getElementById('email-password').value;
  const currentEmail = document.getElementById('current-email').value;

  handleSubmit(emailForm, {
    validate: () => {
      const errors = {};
      if (!EMAIL_RE.test(newEmail)) errors['new-email'] = 'Enter a valid email address.';
      else if (newEmail.toLowerCase() === currentEmail.toLowerCase()) errors['new-email'] = 'That\'s already your email.';
      if (!password) errors['email-password'] = 'Enter your password to confirm.';
      return errors;
    },
    send: async () => {
      await api.request('POST', '/api/account/email', { newEmail, password });
      emailForm.reset();
    },
    success: () => `Confirmation sent to ${newEmail}`,
  });
});

// ------------------------------------------------------------
// 03 Connected sources
// Only the last 4 characters of a key are ever kept client-side.
// ------------------------------------------------------------
let sources = []; // filled by LoadAccount()

const sourceList = document.getElementById('source-list');
const sourceEmpty = document.getElementById('source-empty');
const sourceCount = document.querySelector('[data-source-count]');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderSourceItem(source) {
  const item = el('li', 'source-item');
  item.dataset.id = source.id;

  const icon = el('span', 'source-icon', source.type.slice(0, 2).toUpperCase());
  icon.setAttribute('aria-hidden', 'true');

  const info = el('div');
  info.append(
    el('p', 'source-name', source.name),
    el('p', 'source-meta', `${source.type} · key ••••${source.last4} · ${source.synced}`),
  );

  const status = el('span', `status-pill ${source.status === 'ok' ? 'is-ok' : 'is-error'}`, source.status === 'ok' ? 'Connected' : 'Error');

  const remove = el('button', 'source-remove', 'Remove');
  remove.type = 'button';
  remove.setAttribute('aria-label', `Remove ${source.name}`);
  remove.addEventListener('click', () => removeSource(source));

  item.append(icon, info, status, remove);
  return item;
}

function renderSources() {
  sourceList.replaceChildren(...sources.map(renderSourceItem));
  sourceEmpty.hidden = sources.length > 0;
  sourceCount.textContent = String(sources.length);
}

async function removeSource(source) {
  if (!window.confirm(`Remove "${source.name}"? Dashboards using it will stop updating.`)) return;
  const previous = sources;
  sources = sources.filter((s) => s.id !== source.id);
  renderSources();
  try {
    await api.request('DELETE', `/api/sources/${encodeURIComponent(source.id)}`);
    toast(`Removed ${source.name}`);
  } catch (err) {
    sources = previous;
    renderSources();
    toast('Couldn\'t remove that source', true);
  }
}

const sourceDialog = document.getElementById('source-dialog');
const sourceForm = document.getElementById('source-form');

document.getElementById('add-source-btn').addEventListener('click', () => {
  sourceForm.reset();
  clearErrors(sourceForm);
  sourceDialog.showModal();
});

sourceForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = document.getElementById('source-name').value.trim();
  const type = document.getElementById('source-type').value;
  const keyInput = document.getElementById('source-key');
  const key = keyInput.value.trim();

  handleSubmit(sourceForm, {
    validate: () => {
      const errors = {};
      if (!name) errors['source-name'] = 'Give this source a name.';
      if (key.length < 8) errors['source-key'] = 'That key looks too short.';
      return errors;
    },
    send: async () => {
      const res = await api.request('POST', '/api/sources', { name, type, key });
      keyInput.value = '';
      const id = (res.data && res.data.id) || `s${Date.now()}`;
      sources = [...sources, { id, name, type, last4: key.slice(-4), status: 'ok', synced: 'Just now' }];
      renderSources();
      sourceDialog.close();
    },
    success: () => `Connected ${name}`,
  });
});

// ------------------------------------------------------------
// 04 Preferences
// ------------------------------------------------------------
const preferencesForm = document.getElementById('preferences-form');
const themeRadios = preferencesForm.querySelectorAll('input[name="theme"]');

if (window.DashTheme) {
  const savedTheme = window.DashTheme.get();
  themeRadios.forEach((radio) => { radio.checked = radio.value === savedTheme; });
}

// Theme previews instantly — it's a device setting, so it saves locally.
themeRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    if (window.DashTheme) window.DashTheme.set(radio.value);
  });
});

preferencesForm.addEventListener('submit', (event) => {
  event.preventDefault();
  handleSubmit(preferencesForm, {
    send: () => api.request('PATCH', '/api/account/preferences', {
      defaultChart: document.getElementById('default-chart').value,
      refreshRate: Number(document.getElementById('refresh-rate').value),
    }),
    success: 'Preferences saved',
  });
});

// ------------------------------------------------------------
// 05 Danger zone
// ------------------------------------------------------------
document.getElementById('signout-all-btn').addEventListener('click', async (event) => {
  if (!window.confirm('Sign out of every device, including this one?')) return;
  const button = event.currentTarget;
  setLoading(button, true);
  try {
    await api.request('POST', '/api/account/sessions/revoke-all');
    window.location.href = 'login.html';
  } catch (err) {
    setLoading(button, false);
    toast('Couldn\'t sign out other devices', true);
  }
});

const deleteDialog = document.getElementById('delete-dialog');
const deleteForm = document.getElementById('delete-form');
const deleteInput = document.getElementById('delete-confirm');
const deleteButton = document.getElementById('delete-confirm-btn');

document.getElementById('delete-account-btn').addEventListener('click', () => {
  deleteForm.reset();
  deleteButton.disabled = true;
  deleteDialog.showModal();
});

deleteInput.addEventListener('input', () => {
  deleteButton.disabled = deleteInput.value !== 'DELETE';
});

deleteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (deleteInput.value !== 'DELETE') return;
  setLoading(deleteButton, true);
  try {
    await api.request('DELETE', '/api/account');
    window.location.href = 'login.html';
  } catch (err) {
    setLoading(deleteButton, false);
    toast('Couldn\'t delete your account', true);
  }
});

// Cancel buttons + click-outside to close any dialog
document.querySelectorAll('dialog.modal').forEach((dialog) => {
  dialog.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => dialog.close());
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
});

// ------------------------------------------------------------
// Section nav: highlight whichever panel is on screen
// ------------------------------------------------------------
const tocLinks = document.querySelectorAll('.account-toc a');

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        tocLinks.forEach((link) => {
          link.classList.toggle('is-active', link.getAttribute('href') === `#${entry.target.id}`);
        });
      });
    },
    { rootMargin: '-30% 0px -60% 0px' },
  );
  document.querySelectorAll('.account-sections > .panel').forEach((panel) => observer.observe(panel));
}

renderSources();

// ------------------------------------------------------------
// Page init — load real user profile + sources from the backend
// ------------------------------------------------------------
async function LoadAccount()
{
  try
  {
    const tmpRes = await fetch('/api/account', { credentials: 'same-origin' });
    if (tmpRes.status === 401)
    {
      window.location.href = 'login.html';
      return;
    }
    if (!tmpRes.ok) return;
    const tmpJson = await tmpRes.json();
    const tmpProfile = tmpJson.data || tmpJson;

    // Populate display name, username, email
    if (tmpProfile.displayName)
    {
      displayNameInput.value = tmpProfile.displayName;
      document.querySelectorAll('[data-display-name]').forEach((tmpEl) => { tmpEl.textContent = tmpProfile.displayName; });
      document.querySelectorAll('[data-avatar-initials]').forEach((tmpEl) => { tmpEl.textContent = initialsFor(tmpProfile.displayName); });
    }
    if (tmpProfile.username)
    {
      usernameInput.value = tmpProfile.username;
      document.querySelectorAll('[data-username]').forEach((tmpEl) => { tmpEl.textContent = `@${tmpProfile.username}`; });
    }
    if (tmpProfile.email)
    {
      const tmpCurrentEmailEl = document.getElementById('current-email');
      if (tmpCurrentEmailEl) tmpCurrentEmailEl.value = tmpProfile.email;
      document.querySelectorAll('[data-email]').forEach((tmpEl) => { tmpEl.textContent = tmpProfile.email; });
    }
    if (tmpProfile.avatarUrl)
    {
      showAvatar(tmpProfile.avatarUrl);
    }

    // Populate preferences
    if (tmpProfile.preferences)
    {
      const tmpPrefs = tmpProfile.preferences;
      if (tmpPrefs.defaultChart)
      {
        const tmpChartEl = document.getElementById('default-chart');
        if (tmpChartEl) tmpChartEl.value = tmpPrefs.defaultChart;
      }
      if (tmpPrefs.refreshRate !== undefined)
      {
        const tmpRateEl = document.getElementById('refresh-rate');
        if (tmpRateEl) tmpRateEl.value = String(tmpPrefs.refreshRate);
      }
    }
  }
  catch (tmpErr)
  {
    console.error('Could not load account:', tmpErr);
  }

  // Load real sources
  try
  {
    const tmpSrcRes = await fetch('/api/sources', { credentials: 'same-origin' });
    if (tmpSrcRes.ok)
    {
      const tmpSrcJson = await tmpSrcRes.json();
      const tmpRaw = Array.isArray(tmpSrcJson.data) ? tmpSrcJson.data : [];
      sources = tmpRaw.map((pSrc) => ({
        id: pSrc.id,
        name: pSrc.name,
        type: pSrc.type,
        last4: pSrc.keyLast4 || '????',
        status: pSrc.status || 'ok',
        synced: pSrc.lastSyncAt ? new Date(pSrc.lastSyncAt).toLocaleString() : 'Never synced'
      }));
      renderSources();
    }
  }
  catch (tmpErr)
  {
    console.error('Could not load sources:', tmpErr);
  }
}

LoadAccount();

// ------------------------------------------------------------
// Sign-out buttons in the nav
// ------------------------------------------------------------
document.querySelectorAll('.nav-signout').forEach((pBtn) =>
{
  pBtn.addEventListener('click', async () =>
  {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); }
    catch (tmpErr) { /* best-effort */ }
    window.location.href = 'login.html';
  });
});
