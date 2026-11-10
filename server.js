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

_app.listen(_serverPort, () =>
{
    console.log(`server is listening on port ${_serverPort}`);
});



