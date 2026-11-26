// libraries
const libPath = require("path");
const libDotenv = require("dotenv");
const libExpress = require("express");

// load .env from the project root (does not override variables already set)
libDotenv.config({ path: libPath.join(__dirname, `../../.env`), quiet: true });

const libConfig = require("./lib/config");
const libDb = require("./lib/db");
const libEnvelope = require("./lib/envelope");
const libStaticAllowlist = require("./lib/static-allowlist");
const libRequireSession = require("./lib/require-session");
const libAuthRoutes = require("./lib/routes/auth");
const libAccountRoutes = require("./lib/routes/account");
const libSourcesRoutes = require("./lib/routes/sources");
const libDashboardsRoutes = require("./lib/routes/dashboards");
const libPublicDashboardsRoutes = require("./lib/routes/public-dashboards");
const libDemoRoutes = require("./lib/routes/demo");
const libSecurity = require("./lib/security");
const libMaintenance = require("./lib/maintenance");
const libPageMeta = require("./lib/page-meta");
const _serverPort = Number(process.env.PORT) || 8000;
// HOST=127.0.0.1 in production so only the reverse proxy can reach the app; unset = all interfaces
const _serverHost = process.env.HOST || undefined;

// paths that make the server fetch a user-chosen source; case-insensitive because Express routes are
const SOURCE_FETCH_PATHS = Object.freeze({
    sources: /^\/[^/]+\/(test|preview)\/?$/i,
    dashboards: /^\/[^/]+\/data\/?$/i,
});

// runs pMiddleware only when the path (relative to the mount point) matches pPattern
function OnlyFor(pPattern, pMiddleware)
{
    return (pRequest, pResponse, pNext) => (pPattern.test(pRequest.path) ? pMiddleware(pRequest, pResponse, pNext) : pNext());
}

/*
    Mount map

    helmet                security headers + CSP on every response
    /backend/*            allowlisted static files (api.js only), before body parsing
    /api/auth             public auth routes
    /api/account          email confirm (no session), then session-protected account routes
    /api/sources          session-protected
    /api/dashboards       session-protected
    /api/public/dashboards  no session, read-only, is_public = 1 rows only
    /api/demo             no session: list the showcase boards, or start a throwaway demo account
    errorMiddleware       last

    Rate limits (lib/security.js): login, signup/forgot/reset/email-change, source test/preview + owner
    dashboard data (per user), and public dashboards (per IP).
*/

// build the express app (no listening, no config check)
function CreateApp()
{
    const tmpApp = libExpress();
    const tmpLimiters = libSecurity.CreateLimiters();

    // real client IPs behind a reverse proxy (see TRUST_PROXY in .env.example)
    tmpApp.set(`trust proxy`, libSecurity.TrustProxySetting(process.env.TRUST_PROXY));
    tmpApp.disable(`x-powered-by`);
    tmpApp.use(libSecurity.SecurityHeaders());

    // pool is lazy, this only creates it, the first query connects
    libDb.getPool();

    // must come before the JSON parser and session middleware
    tmpApp.use(`/backend/`, libStaticAllowlist.staticAllowlist({ dir: __dirname }));

    // 1mb matches the dashboards router limit, so larger definitions are not rejected here first.
    // express.json only parses application/json, so the avatar PUT (express.raw) is unaffected.
    tmpApp.use(libExpress.json({ limit: `1mb` }));

    // cookies are SameSite=Lax, which still lets sibling subdomains POST; refuse cross-origin writes
    tmpApp.use(`/api/`, libSecurity.sameOriginWrites());

    tmpApp.use(`/api/auth/login`, tmpLimiters.login);
    tmpApp.use([`/api/auth/signup`, `/api/auth/forgot-password`, `/api/auth/reset-password`], tmpLimiters.authSensitive);
    // sends mail from our domain to an address the user types, so it shares the auth limit
    tmpApp.use(`/api/account/email`, tmpLimiters.authSensitive);
    tmpApp.use(`/api/auth`, libAuthRoutes.CreateAuthRouter());
    tmpApp.use(`/api/account`, libAccountRoutes.CreateEmailConfirmRouter());
    tmpApp.use(`/api/account`, libRequireSession.requireSession(), libAccountRoutes.CreateAccountRouter());
    tmpApp.use(`/api/sources`, libRequireSession.requireSession(),
        OnlyFor(SOURCE_FETCH_PATHS.sources, tmpLimiters.sourceFetch), libSourcesRoutes());
    tmpApp.use(`/api/public/dashboards`, tmpLimiters.publicDashboards, libPublicDashboardsRoutes());
    // starting a demo creates an account, so POST shares the signup limit; GET is a cheap lookup
    tmpApp.use(`/api/demo`, (pRequest, pResponse, pNext) =>
        (pRequest.method === `POST` ? tmpLimiters.authSensitive : tmpLimiters.publicDashboards)(pRequest, pResponse, pNext),
        libDemoRoutes.CreateDemoRouter());
    tmpApp.use(`/api/dashboards`, libRequireSession.requireSession(),
        OnlyFor(SOURCE_FETCH_PATHS.dashboards, tmpLimiters.sourceFetch), libDashboardsRoutes());

    // pages at clean URLs (/, /login, /account, /view/:id, /edit/:id) with link-preview tags
    // written into <head>; old /pages/*.html links 301 to them. See lib/page-meta.js.
    // Must come before static, which would serve index.html and the raw page files.
    // /view/<id> looks up the board for its preview tags without a session, so it shares the
    // per-IP limit of the public dashboards API.
    tmpApp.use(`/view/`, tmpLimiters.publicDashboards);
    tmpApp.use(libPageMeta.pageMeta({ dir: libPath.join(__dirname, `../frontend`) }));

    // frontend
    tmpApp.use(libExpress.static(libPath.join(__dirname, `../frontend`)));

    // unknown API routes get the JSON envelope, not Express's HTML 404
    tmpApp.use(`/api/`, (pRequest, pResponse) => libEnvelope.fail(pResponse, 404, `Not found`));

    tmpApp.use(libEnvelope.errorMiddleware);

    return tmpApp;
}

// check config, then listen
function Start()
{
    const tmpMissing = libConfig.missingConfig();

    if (tmpMissing.length > 0)
    {
        console.error(`missing required environment variable(s): ${tmpMissing.join(`, `)}`);
        process.exitCode = 1;
        return null;
    }

    // behind a proxy without TRUST_PROXY, every visitor shares the proxy's IP and one rate-limit bucket
    if (process.env.NODE_ENV === `production` && !process.env.TRUST_PROXY)
    {
        console.warn(`warning: NODE_ENV=production but TRUST_PROXY is unset. If this runs behind a reverse proxy, `
            + `set TRUST_PROXY=1 or all visitors will share one rate limit.`);
    }

    const tmpApp = CreateApp();
    libMaintenance.StartPruning(libDb);

    // Express 5 hands listen errors (e.g. EADDRINUSE) to this callback instead of throwing
    return tmpApp.listen(_serverPort, _serverHost, (pErr) =>
    {
        if (pErr)
        {
            console.error(`could not listen on port ${_serverPort}: ${pErr.code || pErr.message}`);
            process.exit(1);
        }
        console.log(`server is listening on port ${_serverPort}`);
    });
}

if (require.main === module)
{
    Start();
}

module.exports = { CreateApp, Start, SOURCE_FETCH_PATHS };
