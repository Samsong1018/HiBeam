'use strict';

const GENERIC_ERROR = 'Internal server error';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function ok(res, status, data) {
  return res.status(status).json({ success: true, data });
}

function fail(res, status, error) {
  const text = typeof error === 'string' && error.length > 0 ? error : GENERIC_ERROR;
  return res.status(status).json({ success: false, error: text });
}

// Remove values that must never reach logs.
function scrub(text) {
  return String(text)
    .replace(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, '[hash]')
    .replace(/(password|passwd|pwd|token|secret|key|authorization|cookie)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&)]+)/gi, '$1$2[redacted]')
    .replace(/(sid=)[^;\s]+/gi, '$1[redacted]');
}

function errorMiddleware(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) return next(err);

  let status = 500;
  let message = GENERIC_ERROR;

  if (err instanceof HttpError) {
    status = err.status;
    message = err.message;
  } else if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
    status = 400;
    message = err.type === 'entity.too.large' ? 'Request body too large' : 'Malformed JSON body';
  }

  if (status >= 500) {
    const detail = err && err.stack ? err.stack : err && err.message ? err.message : String(err);
    console.error(`[error] ${req.method} ${req.path} -> ${status}: ${scrub(detail)}`);
  }

  return fail(res, status, message);
}

module.exports = { HttpError, ok, fail, errorMiddleware, GENERIC_ERROR };
