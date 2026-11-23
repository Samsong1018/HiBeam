// Login / sign up / forgot / reset page.
// Uses KiroApi.api.* when /backend/api.js is loaded; otherwise falls back to a
// small fetch client that follows the same { success, data, error } envelope.
(function () {
  'use strict';

  const HOME = 'home.html';

  // ---- rules mirrored from Web/backend/lib/validators.js ----
  const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
  const MAX_EMAIL = 254;
  const MAX_DISPLAY_NAME = 60;
  const MIN_PW_BYTES = 10;
  const MAX_PW_BYTES = 72;

  const encoder = new TextEncoder();
  const byteLen = (s) => encoder.encode(s).length;

  // ---------------------------------------------------------------
  // API
  // ---------------------------------------------------------------
  class AuthError extends Error {
    constructor(message, status, retryAfter) {
      super(message);
      this.status = status;
      this.retryAfter = retryAfter;
    }
  }

  async function request(method, path, body) {
    const init = { method, credentials: 'same-origin' };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(path, init);
    } catch (err) {
      throw new AuthError('Cannot reach the server', undefined);
    }
    const retryAfter = Number(res.headers.get('Retry-After')) || undefined;
    let env;
    try {
      env = JSON.parse(await res.text());
    } catch (err) {
      throw new AuthError('Invalid response from server', res.status, retryAfter);
    }
    if (!env || typeof env.success !== 'boolean') {
      throw new AuthError('Invalid response from server', res.status, retryAfter);
    }
    if (res.ok && env.success) return env.data;
    throw new AuthError(env.error || 'Something went wrong', res.status, retryAfter);
  }

  const fallback = {
    signup: (b) => request('POST', '/api/auth/signup', b),
    login: (b) => request('POST', '/api/auth/login', b),
    forgotPassword: (b) => request('POST', '/api/auth/forgot-password', b),
    resetPassword: (b) => request('POST', '/api/auth/reset-password', b),
    confirmEmail: (t) => request('GET', '/api/account/email/confirm?token=' + encodeURIComponent(t)),
  };

  function api() {
    return (window.KiroApi && window.KiroApi.api) || fallback;
  }

  // ---------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const views = Object.fromEntries($$('[data-view]').map((el) => [el.dataset.view, el]));
  const banner = $('[data-banner]');

  function showBanner(text, isError = false) {
    banner.textContent = text;
    banner.classList.toggle('is-error', isError);
    banner.hidden = !text;
  }

  function setFieldError(form, name, message) {
    const input = form.elements[name];
    const slot = $(`[data-error-for="${name}"]`, form);
    if (input) {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
    if (slot) slot.textContent = message || '';
    updateChart(form);
  }

  // ---------------------------------------------------------------
  // Entry chart: one bar per text field, height = character count.
  // The y-axis auto-scales to the longest entry (rounded up to a
  // multiple of 4 so the quarter gridlines land on whole numbers),
  // so bar heights stay proportional: 10 chars is twice 5 chars.
  // ---------------------------------------------------------------
  const BAR_FIELDS = {
    identifier: { label: 'user / email' },
    displayName: { label: 'name' },
    username: { label: 'username' },
    email: { label: 'email' },
    password: { label: 'password' },
    confirm: { label: 'confirm' },
  };
  const BAR_COLORS = 5; // --chart-c1 .. --chart-c5
  const MIN_SCALE = 8;  // axis never shrinks below this, so 1 char isn't a full bar
  const TICKS = 4;      // matches the quarter gridlines in login.css

  const plot = $('[data-chart-plot]');
  const badge = $('[data-chart-badge]');
  let chartForm = null;
  let bars = [];
  let tickLabels = [];

  function niceScale(maxLen) {
    return Math.ceil(Math.max(maxLen, MIN_SCALE) / TICKS) * TICKS;
  }

  function renderAxis() {
    const axis = document.createElement('div');
    axis.className = 'entry-axis';
    tickLabels = Array.from({ length: TICKS + 1 }, (_, i) => {
      const tick = document.createElement('span');
      tick.style.setProperty('--pos', String(i / TICKS));
      axis.append(tick);
      return tick;
    });
    return axis;
  }

  function renderChart(form) {
    chartForm = form;
    bars = $$('input[name]', form)
      .filter((input) => BAR_FIELDS[input.name])
      .map((input, i) => {
        const bar = document.createElement('div');
        bar.className = 'entry-bar';
        bar.style.setProperty('--bar-color', `var(--chart-c${(i % BAR_COLORS) + 1})`);

        const track = document.createElement('div');
        track.className = 'entry-bar-track';
        const fill = document.createElement('div');
        fill.className = 'entry-bar-fill';
        track.append(fill);

        const label = document.createElement('span');
        label.className = 'entry-bar-label';
        label.textContent = BAR_FIELDS[input.name].label;

        bar.append(track, label);
        return { input, bar };
      });
    plot.replaceChildren(renderAxis(), ...bars.map((b) => b.bar));
    updateChart(form);
  }

  function updateChart(form) {
    if (form !== chartForm) return;
    const scale = niceScale(Math.max(0, ...bars.map(({ input }) => input.value.length)));
    tickLabels.forEach((tick, i) => { tick.textContent = String((scale / TICKS) * i); });

    let filled = 0;
    bars.forEach(({ input, bar }) => {
      const len = input.value.length;
      bar.style.setProperty('--fill', String(len / scale));
      bar.classList.toggle('is-invalid', input.getAttribute('aria-invalid') === 'true');
      bar.classList.toggle('is-active', document.activeElement === input);
      if (len > 0) filled += 1;
    });
    badge.textContent = `${filled} / ${bars.length} filled`;
  }

  ['input', 'change', 'focusin', 'focusout'].forEach((type) => {
    document.addEventListener(type, (e) => {
      const form = e.target.form;
      if (form) updateChart(form);
    });
  });

  function clearErrors(form) {
    $$('[data-error-for]', form).forEach((slot) => setFieldError(form, slot.dataset.errorFor, ''));
    $('[data-form-error]', form).textContent = '';
  }

  function setFormError(form, message) {
    $('[data-form-error]', form).textContent = message || '';
  }

  function setLoading(form, on) {
    const btn = $('button[type="submit"]', form);
    btn.disabled = on;
    btn.classList.toggle('is-loading', on);
  }

  // ---------------------------------------------------------------
  // View switching
  // ---------------------------------------------------------------
  function showView(name, { focus = true } = {}) {
    if (!views[name]) return;
    Object.entries(views).forEach(([key, el]) => { el.hidden = key !== name; });
    renderChart(views[name]);

    document.title = {
      login: 'Log in · HiBeam',
      signup: 'Sign up · HiBeam',
      forgot: 'Forgot password · HiBeam',
      reset: 'New password · HiBeam',
    }[name];

    if (focus) {
      const first = $('input', views[name]);
      if (first) first.focus();
    }
  }

  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-view-target]');
    if (!target) return;
    showBanner('');
    showView(target.dataset.viewTarget);
  });

  // ---------------------------------------------------------------
  // Show/hide password
  // ---------------------------------------------------------------
  $$('[data-reveal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.previousElementSibling;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'hide' : 'show';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  });

  // ---------------------------------------------------------------
  // Client-side checks (server re-validates everything)
  // ---------------------------------------------------------------
  function checkNewPassword(pw) {
    if (!pw) return 'Password is required';
    const n = byteLen(pw);
    if (n < MIN_PW_BYTES) return `Password must be at least ${MIN_PW_BYTES} characters`;
    if (n > MAX_PW_BYTES) return `Password must be at most ${MAX_PW_BYTES} bytes`;
    return '';
  }

  function checkEmail(raw) {
    const v = raw.trim();
    if (!v) return 'Email is required';
    if (v.length > MAX_EMAIL) return `Email must be at most ${MAX_EMAIL} characters`;
    if (!EMAIL_RE.test(v)) return 'Enter a valid email';
    return '';
  }

  // Returns true when no errors.
  function applyChecks(form, checks) {
    let ok = true;
    let firstBad = null;
    Object.entries(checks).forEach(([name, message]) => {
      setFieldError(form, name, message);
      if (message) {
        ok = false;
        if (!firstBad) firstBad = form.elements[name];
      }
    });
    if (firstBad) firstBad.focus();
    return ok;
  }

  // ---------------------------------------------------------------
  // Server error → field / form message
  // ---------------------------------------------------------------
  const FIELD_LABELS = {
    username: 'Check your username',
    email: 'Check your email',
    displayName: 'Check your display name',
    password: 'Check your password',
    identifier: 'Check your username or email',
  };

  function showServerError(form, err) {
    const msg = err.message || 'Something went wrong';

    if (err.status === 429) {
      const mins = err.retryAfter ? Math.ceil(err.retryAfter / 60) : 15;
      setFormError(form, `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
      return;
    }

    // 400: "Invalid fields: username, email"
    const listed = /invalid fields?:\s*(.+)/i.exec(msg);
    if (err.status === 400 && listed) {
      const names = listed[1].split(',').map((s) => s.trim()).filter((n) => form.elements[n]);
      if (names.length) {
        names.forEach((n) => setFieldError(form, n, FIELD_LABELS[n] || 'Invalid value'));
        form.elements[names[0]].focus();
        return;
      }
    }

    // 409: duplicate username / email
    if (err.status === 409) {
      const field = /email/i.test(msg) ? 'email' : /user/i.test(msg) ? 'username' : null;
      if (field && form.elements[field]) {
        setFieldError(form, field, field === 'email' ? 'That email is already registered' : 'That username is taken');
        form.elements[field].focus();
        return;
      }
    }

    setFormError(form, msg);
  }

  async function submit(form, run) {
    setLoading(form, true);
    try {
      await run();
    } catch (err) {
      showServerError(form, err);
    } finally {
      setLoading(form, false);
    }
  }

  // ---------------------------------------------------------------
  // Forms
  // ---------------------------------------------------------------
  views.login.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    clearErrors(form);
    const identifier = form.elements.identifier.value.trim();
    const password = form.elements.password.value;

    const ok = applyChecks(form, {
      identifier: identifier ? '' : 'Enter your username or email',
      password: password ? (byteLen(password) > MAX_PW_BYTES ? `Password must be at most ${MAX_PW_BYTES} bytes` : '') : 'Enter your password',
    });
    if (!ok) return;

    submit(form, async () => {
      try {
        await api().login({ identifier, password });
      } catch (err) {
        if (err.status === 401) {
          form.elements.password.value = '';
          form.elements.password.focus();
        }
        throw err;
      }
      window.location.assign(HOME);
    });
  });

  views.signup.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    clearErrors(form);
    const displayName = form.elements.displayName.value.trim();
    const username = form.elements.username.value.trim().toLowerCase();
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    const confirm = form.elements.confirm.value;

    const ok = applyChecks(form, {
      displayName: !displayName ? 'Enter your name'
        : displayName.length > MAX_DISPLAY_NAME ? `At most ${MAX_DISPLAY_NAME} characters` : '',
      username: USERNAME_RE.test(username) ? '' : 'Lowercase letters, numbers and underscores, 3 to 24 long',
      email: checkEmail(email),
      password: checkNewPassword(password),
      confirm: confirm === password ? '' : "Passwords don't match",
    });
    if (!ok) return;

    submit(form, async () => {
      await api().signup({ username, email, displayName, password });
      window.location.assign(HOME);
    });
  });

  views.forgot.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    clearErrors(form);
    const email = form.elements.email.value.trim();
    if (!applyChecks(form, { email: checkEmail(email) })) return;

    submit(form, async () => {
      await api().forgotPassword({ email });
      form.reset();
      showView('login');
      showBanner("If there's an account with that email, we sent a reset link.");
    });
  });

  views.reset.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    clearErrors(form);
    const password = form.elements.password.value;
    const confirm = form.elements.confirm.value;

    const ok = applyChecks(form, {
      password: checkNewPassword(password),
      confirm: confirm === password ? '' : "Passwords don't match",
    });
    if (!ok) return;

    submit(form, async () => {
      try {
        await api().resetPassword({ token: resetToken, password });
      } catch (err) {
        if (err.status === 400 && !/invalid fields?/i.test(err.message)) {
          err.message = 'That reset link is expired or already used. Request a new one.';
        }
        throw err;
      }
      dropQuery();
      form.reset();
      showView('login');
      showBanner('Password changed. Log in with the new one.');
    });
  });

  // ---------------------------------------------------------------
  // Query params: ?reset=<token>, ?token=<email confirm>, ?view=signup
  // ---------------------------------------------------------------
  const params = new URLSearchParams(window.location.search);
  const resetToken = params.get('reset');
  const confirmToken = params.get('token');

  function dropQuery() {
    history.replaceState(null, '', window.location.pathname);
  }

  if (resetToken) {
    showView('reset');
  } else if (confirmToken) {
    showView('login', { focus: false });
    dropQuery();
    api().confirmEmail(confirmToken)
      .then(() => showBanner('Email confirmed.'))
      .catch((err) => showBanner(err.status === 400 || err.status === 404
        ? 'That confirmation link is expired or already used.'
        : err.message, true));
  } else {
    showView(params.get('view') === 'signup' ? 'signup' : 'login', { focus: false });
  }
})();
