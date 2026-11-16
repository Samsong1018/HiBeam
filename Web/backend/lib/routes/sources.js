'use strict';

const crypto = require('crypto');
const express = require('express');
const { ok, fail } = require('../envelope');
const { validateSourceInput, isValidId } = require('../validators');
const { toSourceView } = require('../views');

const NOT_FOUND = 'Not found';
const BAD_ID = 'Invalid id';
const UNREACHABLE = 'Source unreachable';

function NewSourceId()
{
  return `src_${crypto.randomBytes(12).toString('base64url')}`;
}

// deps (all optional; defaults load the real modules):
//   sources        repo with list/get/getWithKey/create/setStatus/remove (owner-scoped)
//   cryptoBox      { encryptKey, last4 }
//   connector      { testSource, previewSource }
//   newId          () => string, id generator
function CreateSourcesRouter(pDeps)
{
  const tmpDeps = pDeps || {};
  const tmpSources = tmpDeps.sources || require('../repos/sources');
  const tmpBox = tmpDeps.cryptoBox || require('../crypto-box');
  const tmpConnector = tmpDeps.connector || require('../source-connector');
  const tmpNewId = tmpDeps.newId || NewSourceId;
  const tmpRouter = express.Router();

  // Reject malformed ids before any handler (and any query) runs.
  tmpRouter.param('id', (pReq, pRes, pNext, pId) =>
  {
    if (!isValidId(pId)) return fail(pRes, 400, BAD_ID);
    return pNext();
  });

  tmpRouter.get('/', async (pReq, pRes) =>
  {
    const tmpRows = await tmpSources.list(pReq.userId);
    return ok(pRes, 200, tmpRows.map(toSourceView));
  });

  tmpRouter.post('/', async (pReq, pRes) =>
  {
    const tmpResult = validateSourceInput(pReq.body);
    if (!tmpResult.ok)
    {
      const tmpNames = Object.keys(tmpResult.fields);
      const tmpText = tmpNames.map((pName) => `${pName}: ${tmpResult.fields[pName]}`).join('; ');
      return fail(pRes, 400, tmpText);
    }
    const tmpInput = tmpResult.value;
    const tmpId = tmpNewId();
    await tmpSources.create(pReq.userId, {
      id: tmpId,
      name: tmpInput.name,
      type: tmpInput.type,
      keyEnc: tmpBox.encryptKey(tmpInput.key),
      keyLast4: tmpBox.last4(tmpInput.key)
    });
    return ok(pRes, 201, { id: tmpId });
  });

  tmpRouter.delete('/:id', async (pReq, pRes) =>
  {
    const tmpRemoved = await tmpSources.remove(pReq.userId, pReq.params.id);
    if (!tmpRemoved) return fail(pRes, 404, NOT_FOUND);
    return ok(pRes, 200, null);
  });

  tmpRouter.post('/:id/test', async (pReq, pRes) =>
  {
    const tmpRow = await tmpSources.getWithKey(pReq.userId, pReq.params.id);
    if (!tmpRow) return fail(pRes, 404, NOT_FOUND);

    let tmpOutcome;
    try
    {
      tmpOutcome = await tmpConnector.testSource(tmpRow);
    }
    catch (tmpErr)
    {
      tmpOutcome = { status: 'failed', reason: UNREACHABLE };
    }
    const tmpStatus = tmpOutcome && tmpOutcome.status === 'ok' ? 'ok' : 'failed';
    await tmpSources.setStatus(pReq.userId, pReq.params.id, tmpStatus);

    if (tmpStatus === 'ok') return ok(pRes, 200, { status: 'ok' });
    const tmpReason = tmpOutcome && typeof tmpOutcome.reason === 'string' ? tmpOutcome.reason : UNREACHABLE;
    return ok(pRes, 200, { status: 'failed', reason: tmpReason });
  });

  tmpRouter.get('/:id/preview', async (pReq, pRes) =>
  {
    const tmpRow = await tmpSources.getWithKey(pReq.userId, pReq.params.id);
    if (!tmpRow) return fail(pRes, 404, NOT_FOUND);

    let tmpRows;
    try
    {
      tmpRows = await tmpConnector.previewSource(tmpRow);
    }
    catch (tmpErr)
    {
      const tmpReason = tmpErr && typeof tmpErr.reason === 'string' ? tmpErr.reason : UNREACHABLE;
      return fail(pRes, 502, tmpReason);
    }
    return ok(pRes, 200, Array.isArray(tmpRows) ? tmpRows.slice(0, 100) : []);
  });

  return tmpRouter;
}

module.exports = CreateSourcesRouter;
