'use strict';

const express = require('express');
const { ok, fail } = require('../envelope');
const { isValidId, collectSourceIds } = require('../validators');

const NOT_FOUND = 'Not found';
const BAD_ID = 'Invalid id';
const SOURCE_FAILED = 'Source unreachable';
const DATA_CACHE_MS = 15000;
const DATA_CACHE_MAX = 500;

function ToIso(pDate)
{
  const tmpDate = pDate instanceof Date ? pDate : new Date(pDate);
  return Number.isNaN(tmpDate.getTime()) ? null : tmpDate.toISOString();
}

// Same shape as the owner view, minus anything about the owner.
function ToPublicView(pRow)
{
  return { id: pRow.id, definition: pRow.definition, public: true, isOwner: false, updatedAt: ToIso(pRow.updated_at) };
}

/*
  Read-only, unauthenticated routes for dashboards marked public. Mount at /api/public/dashboards
  WITHOUT requireSession. Only rows with is_public = 1 are ever read; a private or missing id is a
  404 either way. Data is read through the owner's sources, limited to the ids the definition binds.

  deps (all optional):
    repos           { dashboards, sources }   default require('../repos')
    previewSource   async (sourceRowWithKey, options) => rows[]
    previewOptions  2nd argument to previewSource
    now             () => ms epoch
    cacheMs         data cache TTL (default 15s). Anonymous traffic can't fan out into one
                    upstream request per page view.
*/
function CreatePublicDashboardsRouter(pDeps)
{
  const tmpDeps = pDeps || {};
  const tmpRepos = tmpDeps.repos || require('../repos');
  const tmpPreview = tmpDeps.previewSource || require('../source-connector').previewSource;
  const tmpPreviewOptions = tmpDeps.previewOptions;
  const tmpNow = tmpDeps.now || Date.now;
  const tmpCacheMs = Number.isFinite(tmpDeps.cacheMs) ? tmpDeps.cacheMs : DATA_CACHE_MS;
  const tmpCache = new Map(); // `${id}:${updatedAt}` -> { at, promise }
  const tmpRouter = express.Router();

  tmpRouter.param('id', (pReq, pRes, pNext, pId) =>
  {
    if (!isValidId(pId)) return fail(pRes, 400, BAD_ID);
    return pNext();
  });

  tmpRouter.get('/:id', async (pReq, pRes) =>
  {
    const tmpRow = await tmpRepos.dashboards.getPublic(pReq.params.id);
    if (!tmpRow) return fail(pRes, 404, NOT_FOUND);
    pRes.setHeader('Cache-Control', 'no-store');
    return ok(pRes, 200, ToPublicView(tmpRow));
  });

  async function LoadData(pRow)
  {
    const tmpIds = collectSourceIds(pRow.definition);
    const tmpSources = tmpIds.length > 0 ? await tmpRepos.sources.getManyWithKey(pRow.owner_id, tmpIds) : [];
    const tmpById = new Map(tmpSources.map((pSrc) => [pSrc.id, pSrc]));
    const tmpData = {};
    await Promise.all(tmpIds.map(async (pSourceId) =>
    {
      const tmpSource = tmpById.get(pSourceId);
      if (!tmpSource)
      {
        tmpData[pSourceId] = { name: null, error: SOURCE_FAILED };
        return;
      }
      try
      {
        const tmpRows = await tmpPreview(tmpSource, tmpPreviewOptions);
        tmpData[pSourceId] = { name: tmpSource.name, rows: Array.isArray(tmpRows) ? tmpRows.slice(0, 100) : [] };
      }
      catch (tmpErr)
      {
        const tmpReason = tmpErr && typeof tmpErr.reason === 'string' ? tmpErr.reason : SOURCE_FAILED;
        tmpData[pSourceId] = { name: tmpSource.name, error: tmpReason };
      }
    }));
    return tmpData;
  }

  function CachedData(pRow)
  {
    const tmpKey = `${pRow.id}:${ToIso(pRow.updated_at)}`;
    const tmpHit = tmpCache.get(tmpKey);
    if (tmpHit && tmpNow() - tmpHit.at < tmpCacheMs) return tmpHit.promise;

    // drop expired entries, then the oldest if still over the cap
    for (const [tmpK, tmpV] of tmpCache) if (tmpNow() - tmpV.at >= tmpCacheMs) tmpCache.delete(tmpK);
    if (tmpCache.size >= DATA_CACHE_MAX) tmpCache.delete(tmpCache.keys().next().value);

    const tmpPromise = LoadData(pRow);
    tmpPromise.catch(() => tmpCache.delete(tmpKey));
    tmpCache.set(tmpKey, { at: tmpNow(), promise: tmpPromise });
    return tmpPromise;
  }

  // Response: { [sourceId]: { name, rows } | { name, error } } for every source the definition binds.
  // Keyed by source so the viewer's registry can serve rows(sourceId) the same way it does for owners.
  tmpRouter.get('/:id/data', async (pReq, pRes) =>
  {
    const tmpRow = await tmpRepos.dashboards.getPublic(pReq.params.id);
    if (!tmpRow) return fail(pRes, 404, NOT_FOUND);
    pRes.setHeader('Cache-Control', 'no-store');
    return ok(pRes, 200, await CachedData(tmpRow));
  });

  return tmpRouter;
}

module.exports = CreatePublicDashboardsRouter;
module.exports.createPublicDashboardsRouter = CreatePublicDashboardsRouter;
