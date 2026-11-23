'use strict';

// Read-only MySQL queries against a user's own database. The host is vetted by the caller
// (same private-address block as HTTP sources) and the socket is pinned to that address.

const CONNECT_TIMEOUT_MS = 8000;
const MAX_QUERY = 8000;

class SqlError extends Error
{
  constructor(pCode)
  {
    super(pCode);
    this.code = pCode; // badConnection | unsupportedDb | notSelect | rejected | unreachable | queryFailed
  }
}

// mysql://user:pass@host:3306/db?ssl=true -> parts. Other schemes are refused.
function ParseConnection(pText)
{
  let tmpUrl;
  try
  {
    tmpUrl = new URL(String(pText).trim());
  }
  catch (tmpErr)
  {
    throw new SqlError('badConnection');
  }
  if (tmpUrl.protocol !== 'mysql:' && tmpUrl.protocol !== 'mariadb:') throw new SqlError('unsupportedDb');
  const tmpDb = decodeURIComponent(tmpUrl.pathname.replace(/^\//, ''));
  if (!tmpUrl.hostname || !tmpUrl.username || !tmpDb) throw new SqlError('badConnection');
  const tmpPort = tmpUrl.port ? Number(tmpUrl.port) : 3306;
  const tmpSsl = ['true', '1', 'required'].includes(String(tmpUrl.searchParams.get('ssl')).toLowerCase());
  return {
    url: tmpUrl,
    hostname: tmpUrl.hostname.replace(/^\[|\]$/g, ''),
    port: tmpPort,
    user: decodeURIComponent(tmpUrl.username),
    password: decodeURIComponent(tmpUrl.password),
    database: tmpDb,
    ssl: tmpSsl
  };
}

// Must start with SELECT or WITH (comments ignored for the check only; the original text is what
// runs, so string literals containing '#' or '--' survive). multipleStatements is off, so a
// second statement is a server-side syntax error. The READ ONLY transaction is the real guard
// (WITH ... DELETE is valid MySQL); this check just gives a clear message for obvious mistakes.
function CheckQuery(pQuery)
{
  if (typeof pQuery !== 'string' || pQuery.length > MAX_QUERY) throw new SqlError('notSelect');
  const tmpLead = pQuery
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(--\s|#)[^\n]*/g, ' ')
    .trim();
  if (!/^(select|with)\b/i.test(tmpLead)) throw new SqlError('notSelect');
  return pQuery.trim().replace(/;\s*$/, '');
}

function MapDriverError(pErr)
{
  const tmpCode = pErr && pErr.code;
  if (tmpCode === 'ER_ACCESS_DENIED_ERROR' || tmpCode === 'ER_DBACCESS_DENIED_ERROR' || tmpCode === 'ER_BAD_DB_ERROR') return new SqlError('rejected');
  if (typeof tmpCode === 'string' && tmpCode.startsWith('ER_')) return new SqlError('queryFailed');
  return new SqlError('unreachable');
}

function CleanValue(pValue)
{
  if (Buffer.isBuffer(pValue)) return pValue.toString('utf8');
  if (typeof pValue === 'bigint') return Number(pValue);
  if (pValue instanceof Date) return Number.isNaN(pValue.getTime()) ? null : pValue.toISOString();
  return pValue;
}

/*
  pConfig  { connection, query }  (from the decrypted key)
  pOpts    { resolveSafeAddress(urlLike) -> address, mysql (driver, default require('mysql2')),
             maxRows, timeoutMs, signal }
  Streams rows and stops after maxRows so a huge result never lands in memory.
*/
async function SqlRows(pConfig, pOpts)
{
  const tmpConn = ParseConnection(pConfig && pConfig.connection);
  const tmpQuery = CheckQuery(pConfig && pConfig.query);
  const tmpAddress = await pOpts.resolveSafeAddress(tmpConn.url);
  const tmpDriver = pOpts.mysql || require('mysql2');

  const tmpConnection = tmpDriver.createConnection({
    host: tmpAddress,
    port: tmpConn.port,
    user: tmpConn.user,
    password: tmpConn.password,
    database: tmpConn.database,
    connectTimeout: CONNECT_TIMEOUT_MS,
    multipleStatements: false,
    dateStrings: true,
    supportBigNumbers: true,
    // verify the certificate against the hostname the user typed, not the pinned IP
    ssl: tmpConn.ssl ? { servername: tmpConn.hostname, rejectUnauthorized: true } : undefined
  });

  const tmpRun = (pSql) => new Promise((pResolve, pReject) =>
    tmpConnection.query(pSql, (pErr) => (pErr ? pReject(pErr) : pResolve())));

  const tmpStop = () => { try { tmpConnection.destroy(); } catch (tmpErr) { /* already closed */ } };
  if (pOpts.signal) pOpts.signal.addEventListener('abort', tmpStop, { once: true });

  try
  {
    await tmpRun('START TRANSACTION READ ONLY');
    // MySQL 5.7.8+; MariaDB doesn't know it, and the outer timeout still applies there
    await tmpRun(`SET SESSION MAX_EXECUTION_TIME = ${Math.max(1000, Math.floor(pOpts.timeoutMs || 10000))}`).catch(() => {});
    const tmpRows = await new Promise((pResolve, pReject) =>
    {
      const tmpOut = [];
      let tmpDone = false;
      const tmpFinish = (pErr) =>
      {
        if (tmpDone) return;
        tmpDone = true;
        if (pErr) pReject(pErr); else pResolve(tmpOut);
      };
      const tmpStream = tmpConnection.query(tmpQuery);
      tmpStream.on('result', (pRow) =>
      {
        if (tmpDone) return;
        const tmpClean = {};
        for (const [tmpKey, tmpVal] of Object.entries(pRow)) tmpClean[tmpKey] = CleanValue(tmpVal);
        tmpOut.push(tmpClean);
        if (tmpOut.length >= pOpts.maxRows)
        {
          tmpFinish();
          tmpStop(); // no need to read the rest
        }
      });
      tmpStream.on('error', tmpFinish);
      tmpStream.on('end', () => tmpFinish());
    });
    return tmpRows;
  }
  catch (tmpErr)
  {
    throw tmpErr instanceof SqlError ? tmpErr : MapDriverError(tmpErr);
  }
  finally
  {
    if (pOpts.signal) pOpts.signal.removeEventListener('abort', tmpStop);
    tmpStop(); // read-only transaction is discarded with the connection
  }
}

module.exports = { SqlRows, SqlError, ParseConnection, CheckQuery };
