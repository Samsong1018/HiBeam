// libraries
const libPath = require("path");
const libExpress = require("express");
const libMySQL = require("mysql");
const _serverPort = 8000;

// connect to the mysql database
const _connection = libMySQL.createConnection({
    host : process.env.DB_HOST,
    user : process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

// use express, set up path
const _app = libExpress();
_app.use(libExpress.json());
_app.use(libExpress.static(libPath.join(__dirname, `./Web/frontend`)));

// basic get endpoint, it should send you directly to the index.html page
_app.get(`/`,
    (pRequest, pResponse) =>
    {
        pResponse.sendFile(libPath.join(__dirname, `Web`, `./frontend/index.html`));
    });

/*
    if you get a chance could you move your server stuff
    to the backend folder for organization and so that when 
    I go to host it I dont have to shift stuff around

    ENDPOINTS TO BUILD

    Auth
    POST    /api/auth/signup
    POST    /api/auth/login
    POST    /api/auth/logout
    POST    /api/auth/forgot-password
    POST    /api/auth/reset-password

    Account
    GET     /api/account
    PATCH   /api/account/profile
    PUT     /api/account/avatar
    DELETE  /api/account/avatar
    POST    /api/account/password
    POST    /api/account/email
    GET     /api/account/email/confirm
    PATCH   /api/account/preferences
    POST    /api/account/sessions/revoke-all
    DELETE  /api/account

    Sources
    GET     /api/sources
    POST    /api/sources
    DELETE  /api/sources/:id
    POST    /api/sources/:id/test
    GET     /api/sources/:id/preview   (sample rows so the editor can list fields + draw charts)

    Dashboards
    GET     /api/dashboards
    POST    /api/dashboards
    GET     /api/dashboards/:id
    PATCH   /api/dashboards/:id
    DELETE  /api/dashboards/:id
    GET     /api/dashboards/:id/data
*/

_app.listen(_serverPort, () =>
{
    console.log(`server is listening on port ${_serverPort}`);
});



