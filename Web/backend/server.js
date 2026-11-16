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
const _serverPort = 8000;

/*
    Mount map

    /backend/*            allowlisted static files (api.js only), before body parsing
    /api/auth             public auth routes
    /api/account          email confirm (no session), then session-protected account routes
    /api/sources          session-protected
    /api/dashboards       session-protected
    errorMiddleware       last
*/

// build the express app (no listening, no config check)
function CreateApp()
{
    const tmpApp = libExpress();

    // pool is lazy, this only creates it, the first query connects
    libDb.getPool();

    // must come before the JSON parser and session middleware
    tmpApp.use(`/backend/`, libStaticAllowlist.staticAllowlist({ dir: __dirname }));

    // 1mb matches the dashboards router limit, so larger definitions are not rejected here first.
    // express.json only parses application/json, so the avatar PUT (express.raw) is unaffected.
    tmpApp.use(libExpress.json({ limit: `1mb` }));

    tmpApp.use(`/api/auth`, libAuthRoutes.CreateAuthRouter());
    tmpApp.use(`/api/account`, libAccountRoutes.CreateEmailConfirmRouter());
    tmpApp.use(`/api/account`, libRequireSession.requireSession(), libAccountRoutes.CreateAccountRouter());
    tmpApp.use(`/api/sources`, libRequireSession.requireSession(), libSourcesRoutes());
    tmpApp.use(`/api/dashboards`, libRequireSession.requireSession(), libDashboardsRoutes());

    // frontend
    tmpApp.use(libExpress.static(libPath.join(__dirname, `../frontend`)));

    // basic get endpoint, it should send you directly to the index.html page
    tmpApp.get(`/`,
        (pRequest, pResponse) =>
        {
            pResponse.sendFile(libPath.join(__dirname, `../frontend/`, `/index.html`));
        });

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

    const tmpApp = CreateApp();

    return tmpApp.listen(_serverPort, () =>
    {
        console.log(`server is listening on port ${_serverPort}`);
    });
}

if (require.main === module)
{
    Start();
}

module.exports = { CreateApp, Start };
