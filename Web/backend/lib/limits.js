'use strict';

/*
  Per-user caps and fan-out limits. Anyone can sign up, so these bound how much storage one
  account can use and how many outbound fetches one request can start.
*/
const MAX_SOURCES_PER_USER = 50;
const MAX_DASHBOARDS_PER_USER = 50;
const SOURCE_FETCH_CONCURRENCY = 4;

// Runs pFn over pItems with at most pLimit calls in flight. Resolves when all have settled;
// pFn is expected to handle its own errors.
async function MapLimited(pItems, pLimit, pFn)
{
  let tmpNext = 0;
  const tmpWorker = async () =>
  {
    while (tmpNext < pItems.length)
    {
      const tmpItem = pItems[tmpNext];
      tmpNext += 1;
      await pFn(tmpItem);
    }
  };
  const tmpCount = Math.max(1, Math.min(pLimit, pItems.length));
  await Promise.all(Array.from({ length: tmpCount }, tmpWorker));
}

module.exports = { MAX_SOURCES_PER_USER, MAX_DASHBOARDS_PER_USER, SOURCE_FETCH_CONCURRENCY, MapLimited };
