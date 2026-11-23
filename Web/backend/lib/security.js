'use strict';

const helmet = require('helmet');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { fail } = require('./envelope');

const MINUTE = 60 * 1000;
const TOO_MANY = 'Too many requests, try again later';

/*
  Security headers. The frontend has no inline scripts, so script-src stays strict. Styles allow
  'unsafe-inline' because gridstack and Chart.js set element styles at runtime. Avatars are shown
  from blob: URLs. Everything else is same-origin except the two CDNs the pages load from.
*/
function SecurityHeaders()
{
  const tmpProduction = process.env.NODE_ENV === 'production';
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        ...(tmpProduction ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    // HSTS only in production (behind HTTPS), so it never pins a local dev host.
    strictTransportSecurity: tmpProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false, // CDN assets don't send CORP headers
  });
}

// Same error envelope as every other API response.
function Limiter({ windowMs, limit, keyGenerator })
{
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (pReq, pRes) => fail(pRes, 429, TOO_MANY),
  });
}

// Signed-in limits key on the user, so people sharing one IP (a school, an office) don't
// starve each other. requireSession must run first so req.userId is set.
function ByUser(pReq)
{
  return pReq.userId != null ? `user:${pReq.userId}` : ipKeyGenerator(pReq.ip);
}

/*
  Limits, per window:
    login            30 / 15 min / IP    on top of the per-account lockout
    authSensitive    10 / 15 min / IP    signup, forgot-password, reset-password
    sourceFetch     120 / min / user     source test + preview, owner dashboard data. These make
                                          the server fetch a user-chosen URL, so cap them.
    publicDashboards 120 / min / IP      anonymous share links (data is also cached 15s)
*/
function CreateLimiters()
{
  return {
    login: Limiter({ windowMs: 15 * MINUTE, limit: 30 }),
    authSensitive: Limiter({ windowMs: 15 * MINUTE, limit: 10 }),
    sourceFetch: Limiter({ windowMs: MINUTE, limit: 120, keyGenerator: ByUser }),
    publicDashboards: Limiter({ windowMs: MINUTE, limit: 120 }),
  };
}

/*
  TRUST_PROXY tells Express how many reverse proxies sit in front of it, so req.ip (and so the
  rate limits) see the real client address instead of the proxy's. Unset = no proxy (direct).
  Accepts a hop count ("1") or any value Express understands ("loopback", an address list).
*/
function TrustProxySetting(pValue)
{
  if (pValue == null || pValue === '' || pValue === 'false') return false;
  if (/^\d+$/.test(pValue)) return Number(pValue);
  return pValue;
}

module.exports = { SecurityHeaders, CreateLimiters, TrustProxySetting, TOO_MANY };
