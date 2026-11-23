'use strict';

/*
  Deletes rows that can no longer matter, so auth tables don't grow forever:
    sessions        expired or revoked more than a day ago
    reset_tokens    expired or used more than a day ago
    email_tokens    expired or used more than a day ago
    login_attempts  older than a day (lockout only ever reads the last 24h)
  The day of slack keeps recent rows around for debugging. Runs once at startup, then hourly.
*/

const RETENTION = 'INTERVAL 1 DAY';
const PRUNE_EVERY_MS = 60 * 60 * 1000;

const PRUNE_QUERIES = [
  `DELETE FROM sessions WHERE expires_at < NOW() - ${RETENTION} OR revoked_at < NOW() - ${RETENTION}`,
  `DELETE FROM reset_tokens WHERE expires_at < NOW() - ${RETENTION} OR used_at < NOW() - ${RETENTION}`,
  `DELETE FROM email_tokens WHERE expires_at < NOW() - ${RETENTION} OR used_at < NOW() - ${RETENTION}`,
  `DELETE FROM login_attempts WHERE \`at\` < NOW(3) - ${RETENTION}`,
];

// pDb: anything with query(sql) -> Promise. Returns total rows deleted. One failing table
// doesn't stop the others; failures are logged and counted, never thrown.
async function PruneExpired(pDb, pLogger = console)
{
  let tmpDeleted = 0;
  for (const tmpSql of PRUNE_QUERIES)
  {
    try
    {
      const tmpRes = await pDb.query(tmpSql);
      tmpDeleted += (tmpRes && tmpRes.affectedRows) || 0;
    }
    catch (tmpErr)
    {
      pLogger.error(`[maintenance] prune failed: ${tmpErr && tmpErr.code ? tmpErr.code : 'error'}`);
    }
  }
  return tmpDeleted;
}

// Starts the hourly prune. The timer is unref'd so it never keeps the process alive.
function StartPruning(pDb, pLogger = console)
{
  PruneExpired(pDb, pLogger);
  const tmpTimer = setInterval(() => PruneExpired(pDb, pLogger), PRUNE_EVERY_MS);
  tmpTimer.unref();
  return tmpTimer;
}

module.exports = { PruneExpired, StartPruning, PRUNE_QUERIES };
