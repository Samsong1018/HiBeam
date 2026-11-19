'use strict';

const crypto = require('crypto');
const express = require('express');
const { ok, fail } = require('../envelope');
const { isValidId, validateDashboardDefinition, collectSourceIds } = require('../validators');

const NOT_FOUND = 'Not found';
const BAD_ID = 'Invalid id';
const BAD_SOURCE = 'Definition references a source that does not exist';
const BAD_VISIBILITY = 'public must be true or false';
const SOURCE_FAILED = 'Source unreachable';
const MAX_BODY = '1mb';

function NewDashboardId()
{
  return `dash_${crypto.randomBytes(12).toString('base64url')}`;
}

function ToIso(pDate)
{
  const tmpDate = pDate instanceof Date ? pDate : new Date(pDate);
  return Number.isNaN(tmpDate.getTime()) ? null : tmpDate.toISOString();
}

function ToDashboardView(pRow)
{
  // Every route here is owner-scoped, so whoever gets a row back owns it.
  return { id: pRow.id, definition: pRow.definition, public: Boolean(pRow.is_public), isOwner: true, updatedAt: ToIso(pRow.updated_at) };
}

function ToListItem(pRow)
{
  return { id: pRow.id, name: pRow.name, updatedAt: ToIso(pRow.updated_at) };
}

function FieldsToMessage(pFields)
{
  return Object.entries(pFields).map(([pKey, pMsg]) => `${pKey}: ${pMsg}`).join('; ');
}

/*
  Factory. deps (all optional; defaults load the real modules):
    deps.repos            { dashboards, sources }   default require('../repos')
    deps.previewSource    async (sourceRowWithKey) => rows[]   default require('../source-connector').previewSource
    deps.previewOptions   passed as the 2nd argument to previewSource
    deps.newId            () => string               default dash_ + 16 base64url chars
  Mount behind requireSession at /api/dashboards; the router reads req.userId only.
*/
function CreateDashboardsRouter(pDeps)
{
  const tmpDeps = pDeps || {};
  const tmpRepos = tmpDeps.repos || require('../repos');
  const tmpPreview = tmpDeps.previewSource || require('../source-connector').previewSource;
  const tmpPreviewOptions = tmpDeps.previewOptions;
  const tmpNewId = tmpDeps.newId || NewDashboardId;
  const tmpRouter = express.Router();

  tmpRouter.use(express.json({ limit: MAX_BODY }));

  // Malformed ids are rejected before any query runs.
  tmpRouter.param('id', (pReq, pRes, pNext, pId) =>
  {
    if (!isValidId(pId)) return fail(pRes, 400, BAD_ID);
    return pNext();
  });

  // Validates the body and source ownership. Returns { value } or sends a 400 and returns null.
  async function ReadDefinition(pReq, pRes)
  {
    const tmpResult = validateDashboardDefinition(pReq.body);
    if (!tmpResult.ok)
    {
      fail(pRes, 400, FieldsToMessage(tmpResult.fields));
      return null;
    }
    const tmpIds = collectSourceIds(tmpResult.value);
    if (tmpIds.length > 0)
    {
      const tmpOwned = new Set(await tmpRepos.sources.findOwnedIds(pReq.userId, tmpIds));
      if (!tmpIds.every((pId) => tmpOwned.has(pId)))
      {
        fail(pRes, 400, BAD_SOURCE);
        return null;
      }
    }
    return tmpResult.value;
  }

  tmpRouter.get('/', async (pReq, pRes) =>
  {
    const tmpRows = await tmpRepos.dashboards.list(pReq.userId);
    return ok(pRes, 200, tmpRows.map(ToListItem));
  });

  tmpRouter.post('/', async (pReq, pRes) =>
  {
    const tmpDef = await ReadDefinition(pReq, pRes);
    if (!tmpDef) return null;
    const tmpId = tmpNewId();
    await tmpRepos.dashboards.create(pReq.userId, { id: tmpId, name: tmpDef.name, definition: tmpDef });
    const tmpRow = await tmpRepos.dashboards.get(pReq.userId, tmpId);
    if (!tmpRow) return fail(pRes, 500);
    return ok(pRes, 201, ToDashboardView(tmpRow));
  });

  tmpRouter.get('/:id', async (pReq, pRes) =>
  {
    const tmpRow = await tmpRepos.dashboards.get(pReq.userId, pReq.params.id);
    if (!tmpRow) return fail(pRes, 404, NOT_FOUND);
    return ok(pRes, 200, ToDashboardView(tmpRow));
  });

  tmpRouter.patch('/:id', async (pReq, pRes) =>
  {
    // Existence first, so a foreign id never reveals anything through validation errors.
    const tmpExisting = await tmpRepos.dashboards.get(pReq.userId, pReq.params.id);
    if (!tmpExisting) return fail(pRes, 404, NOT_FOUND);
    const tmpDef = await ReadDefinition(pReq, pRes);
    if (!tmpDef) return null;
    const tmpUpdated = await tmpRepos.dashboards.update(pReq.userId, pReq.params.id, { name: tmpDef.name, definition: tmpDef });
    if (!tmpUpdated) return fail(pRes, 404, NOT_FOUND);
    const tmpRow = await tmpRepos.dashboards.get(pReq.userId, pReq.params.id);
    if (!tmpRow) return fail(pRes, 404, NOT_FOUND);
    return ok(pRes, 200, ToDashboardView(tmpRow));
  });

  tmpRouter.patch('/:id/visibility', async (pReq, pRes) =>
  {
    const tmpPublic = pReq.body && pReq.body.public;
    if (typeof tmpPublic !== 'boolean') return fail(pRes, 400, BAD_VISIBILITY);
    const tmpUpdated = await tmpRepos.dashboards.setVisibility(pReq.userId, pReq.params.id, tmpPublic);
    if (!tmpUpdated) return fail(pRes, 404, NOT_FOUND);
    return ok(pRes, 200, { public: tmpPublic });
  });

  tmpRouter.delete('/:id', async (pReq, pRes) =>
  {
    const tmpRemoved = await tmpRepos.dashboards.remove(pReq.userId, pReq.params.id);
    if (!tmpRemoved) return fail(pRes, 404, NOT_FOUND);
    return ok(pRes, 200, null);
  });

  // Response: { [widgetId]: rows[] | { error } }. A widget uses the rows of its first binding;
  // a widget with no binding gets []. Sources not owned by the user are never loaded.
  tmpRouter.get('/:id/data', async (pReq, pRes) =>
  {
    const tmpRow = await tmpRepos.dashboards.get(pReq.userId, pReq.params.id);
    if (!tmpRow) return fail(pRes, 404, NOT_FOUND);
    const tmpWidgets = tmpRow.definition && Array.isArray(tmpRow.definition.widgets) ? tmpRow.definition.widgets : [];
    const tmpIds = collectSourceIds(tmpRow.definition);
    const tmpSources = tmpIds.length > 0 ? await tmpRepos.sources.getManyWithKey(pReq.userId, tmpIds) : [];
    const tmpById = new Map(tmpSources.map((pSrc) => [pSrc.id, pSrc]));

    // One preview per distinct source, run in parallel; failures become { error } entries.
    const tmpResults = new Map();
    await Promise.all(tmpIds.map(async (pSourceId) =>
    {
      const tmpSource = tmpById.get(pSourceId);
      if (!tmpSource)
      {
        tmpResults.set(pSourceId, { error: SOURCE_FAILED });
        return;
      }
      try
      {
        tmpResults.set(pSourceId, await tmpPreview(tmpSource, tmpPreviewOptions));
      }
      catch (tmpErr)
      {
        const tmpReason = tmpErr && typeof tmpErr.reason === 'string' ? tmpErr.reason : SOURCE_FAILED;
        tmpResults.set(pSourceId, { error: tmpReason });
      }
    }));

    const tmpData = {};
    for (const tmpWidget of tmpWidgets)
    {
      const tmpBindings = tmpWidget.config && Array.isArray(tmpWidget.config.bindings) ? tmpWidget.config.bindings : [];
      const tmpFirst = tmpBindings.find((pBind) => pBind && typeof pBind.sourceId === 'string' && pBind.sourceId !== '');
      tmpData[tmpWidget.id] = tmpFirst ? tmpResults.get(tmpFirst.sourceId) : [];
    }
    return ok(pRes, 200, tmpData);
  });

  // Malformed JSON bodies become a 400 envelope; other errors go to the app error middleware.
  tmpRouter.use((pErr, pReq, pRes, pNext) =>
  {
    if (pErr && (pErr.type === 'entity.parse.failed' || pErr.type === 'entity.too.large'))
    {
      return fail(pRes, 400, 'Request body is not valid JSON');
    }
    return pNext(pErr);
  });

  return tmpRouter;
}

module.exports = CreateDashboardsRouter;
module.exports.createDashboardsRouter = CreateDashboardsRouter;
module.exports.NewDashboardId = NewDashboardId;
