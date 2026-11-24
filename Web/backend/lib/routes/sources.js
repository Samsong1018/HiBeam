'use strict';

const crypto = require('crypto');
const express = require('express');
const { ok, fail } = require('../envelope');
const { MAX_SOURCES_PER_USER } = require('../limits');
const { validateSourceInput, isValidId } = require('../validators');
const { toSourceView } = require('../views');

const NOT_FOUND = 'Not found';
const BAD_ID = 'Invalid id';
const UNREACHABLE = 'Source unreachable';
const UPLOAD_ERRORS = {
  missing: 'File is missing',
  too_large: 'File is too large (maximum 5 MB)',
  unsupported: 'Unsupported file (use .xlsx or .csv)',
  not_excel: 'Only spreadsheet sources take a file'
};

function NewSourceId()
{
  return `src_${crypto.randomBytes(12).toString('base64url')}`;
}

// deps (all optional; defaults load the real modules):
//   sources        repo with list/get/getWithKey/create/setStatus/remove (owner-scoped)
//   cryptoBox      { encryptKey, last4 }
//   connector      { testSource, previewSource }
//   newId          () => string, id generator
//   spreadsheet    { CheckUpload, MAX_FILE_BYTES }
function CreateSourcesRouter(pDeps)
{
  const tmpDeps = pDeps || {};
  const tmpSources = tmpDeps.sources || require('../repos/sources');
  const tmpBox = tmpDeps.cryptoBox || require('../crypto-box');
  const tmpConnector = tmpDeps.connector || require('../source-connector');
  const tmpNewId = tmpDeps.newId || NewSourceId;
  const tmpSheet = tmpDeps.spreadsheet || require('../connectors/spreadsheet');
  const tmpRawParser = express.raw({ type: () => true, limit: tmpSheet.MAX_FILE_BYTES });
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
    const tmpExisting = await tmpSources.list(pReq.userId);
    if (tmpExisting.length >= MAX_SOURCES_PER_USER)
    {
      return fail(pRes, 409, `Source limit reached (${MAX_SOURCES_PER_USER}). Delete one to make room.`);
    }
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

  // PUT /api/sources/:id/file  raw .xlsx/.csv bytes for an excel source (any Content-Type).
  tmpRouter.put('/:id/file', (pReq, pRes, pNext) =>
  {
    tmpRawParser(pReq, pRes, (pErr) =>
    {
      if (pErr && pErr.type === 'entity.too.large') return fail(pRes, 400, UPLOAD_ERRORS.too_large);
      return pNext(pErr);
    });
  }, async (pReq, pRes) =>
  {
    const tmpRow = await tmpSources.get(pReq.userId, pReq.params.id);
    if (!tmpRow) return fail(pRes, 404, NOT_FOUND);
    if (tmpRow.type !== 'excel') return fail(pRes, 400, UPLOAD_ERRORS.not_excel);
    const tmpBody = Buffer.isBuffer(pReq.body) ? pReq.body : null;
    const tmpProblem = tmpSheet.CheckUpload(tmpBody);
    if (tmpProblem) return fail(pRes, 400, UPLOAD_ERRORS[tmpProblem] || UPLOAD_ERRORS.unsupported);
    const tmpSaved = await tmpSources.setFile(pReq.userId, pReq.params.id, tmpBody);
    if (!tmpSaved) return fail(pRes, 404, NOT_FOUND);
    return ok(pRes, 200, { bytes: tmpBody.length });
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
