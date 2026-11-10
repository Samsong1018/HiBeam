// libraries
const libPath = require("path");
const libExpress = require("express");
const libMySQL = require("mysql");

// connect to the mysql database
const _connection = _mysql.createConnection({
    host : process.env.DB_HOST,
    user : process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

// use express, set up path
const _app = express();
_app.use(express.json());
_app.use(express.static(libPath.join(__dirname, `frontend`)));

// basic get endpoint, it should send you directly to the index.html page
_app.get(`/`,
    (pRequest, pResponse) =>
    {
        pResponse.sendFile(libPath.join(__dirname, `frontend`, `/index.html`));
    });

_app.listen(process.env.DB_PORT, () =>
{
    console.log('server is listening');
});



