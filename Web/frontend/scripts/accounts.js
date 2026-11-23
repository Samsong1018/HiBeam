// ============================================================
// ACCOUNT PAGE
// All calls go to the real backend through the shared client in /backend/api.js.
// ============================================================

// Shared fetch client (/backend/api.js, loaded before this file). Methods return the
// envelope's data and throw KiroApi.ApiError (with .status) on failure.
// (api.js already declares a global `api` const, so this needs its own name.)
const accountApi = window.KiroApi.api;

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
      await accountApi.updateProfile({ displayName, username });
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
    await accountApi.putAvatar(file);
    toast('Photo updated');
  } catch (err) {
    showAvatar(null);
    toast('Couldn\'t upload photo', true);
  }
});

document.getElementById('avatar-remove').addEventListener('click', () => {
  showAvatar(null);
  accountApi.deleteAvatar()
    .then(() => toast('Photo removed'))
    .catch(() => toast('Couldn\'t remove photo. Refresh to see your current one.', true));
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
      await accountApi.changePassword({ currentPassword: current, newPassword: next });
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
      await accountApi.changeEmail({ newEmail, password });
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

  // backend statuses: ok | failed | untested (the default until a test runs)
  const pill = { ok: ['is-ok', 'Connected'], failed: ['is-error', 'Error'] }[source.status] || ['is-untested', 'Untested'];
  const status = el('span', `status-pill ${pill[0]}`, pill[1]);

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
    await accountApi.deleteSource(source.id);
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
      if (!/^https?:\/\/\S+$/i.test(key)) errors['source-key'] = 'Use a full http(s):// URL.';
      return errors;
    },
    send: async () => {
      const created = await accountApi.createSource({ name, type, key });
      keyInput.value = '';
      // no id means the save can't be trusted; fail loudly instead of listing a fake source
      if (!created || typeof created.id !== 'string') throw new Error('The server didn\'t confirm the new source. Refresh and check your sources.');
      sources = [...sources, { id: created.id, name, type, last4: key.slice(-4), status: 'untested', synced: 'Never synced' }];
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
    send: () => accountApi.updatePreferences({
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
    await accountApi.revokeAllSessions();
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
    await accountApi.deleteAccount();
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

// Sources render once LoadAccount() has them, so the count never flashes a fake 0.

// ------------------------------------------------------------
// Page init — load real user profile + sources from the backend
// ------------------------------------------------------------
function ParseDate(pIso)
{
  if (typeof pIso !== 'string') return null;
  const tmpDate = new Date(pIso);
  return Number.isNaN(tmpDate.getTime()) ? null : tmpDate;
}

function DayLabel(pDate)
{
  const tmpStart = (pD) => new Date(pD.getFullYear(), pD.getMonth(), pD.getDate()).getTime();
  const tmpDays = Math.round((tmpStart(new Date()) - tmpStart(pDate)) / 86400000);
  if (tmpDays <= 0) return 'Today';
  if (tmpDays === 1) return 'Yesterday';
  if (tmpDays < 7) return `${tmpDays} days ago`;
  return pDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function RenderAccountStats(pProfile)
{
  const tmpSet = (pSelector, pText) =>
    document.querySelectorAll(pSelector).forEach((tmpEl) => { tmpEl.textContent = pText; });

  const tmpCreated = ParseDate(pProfile.createdAt);
  tmpSet('[data-member-since]', tmpCreated
    ? `Member since ${tmpCreated.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
    : 'Member');

  if (Number.isFinite(pProfile.dashboardCount)) tmpSet('[data-dashboard-count]', String(pProfile.dashboardCount));

  const tmpLastLogin = ParseDate(pProfile.lastLoginAt);
  tmpSet('[data-last-login]', tmpLastLogin ? DayLabel(tmpLastLogin) : '—');
}

async function LoadAccount()
{
  const tmpHero = document.querySelector('.account-hero');
  try
  {
    const tmpProfile = await accountApi.getAccount();

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

    RenderAccountStats(tmpProfile);

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
    if (tmpErr && tmpErr.status === 401)
    {
      window.location.href = 'login.html';
      return;
    }
    console.error('Could not load account:', tmpErr);
    toast('Couldn\'t load your account. Refresh to try again.', true);
  }

  // Load real sources
  try
  {
    const tmpRaw = await accountApi.listSources();
    sources = (Array.isArray(tmpRaw) ? tmpRaw : []).map((pSrc) => ({
      id: pSrc.id,
      name: pSrc.name,
      type: pSrc.type,
      last4: pSrc.keyLast4 || '????',
      status: pSrc.status || 'untested',
      synced: pSrc.lastSyncAt ? new Date(pSrc.lastSyncAt).toLocaleString() : 'Never synced'
    }));
    renderSources();
  }
  catch (tmpErr)
  {
    console.error('Could not load sources:', tmpErr);
    sourceCount.textContent = '—';
  }

  if (tmpHero) tmpHero.removeAttribute('aria-busy');
}

LoadAccount();

// Nav Sign Out is wired by script.js, which loads on every page.
