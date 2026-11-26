'use strict';

/*
  Demo routes, mounted at /api/demo with no session.

    GET  /   { enabled, boards: [{ id, name }] }  the showcase account's public boards, for the
                                                   "see a live board" links on the login page
    POST /   creates a demo account holding copies of those boards and the sources they read,
             signs the visitor in, and answers 201 { dashboards, firstDashboardId }

  Both are off (enabled: false, POST 404) unless DEMO_SEED_USER names an existing account.
  Make that account's boards public to put them in the demo. See lib/demo.js for how demo accounts
  are marked and cleaned up.

  deps (all optional; defaults load the real modules):
    seedUser         () => username or ''        default process.env.DEMO_SEED_USER
    repos            { users, sessions, dashboards, demo }
    withTransaction  async (fn(tx)) -> result
    session          { newSessionToken, buildBrowserSessionCookie }
    newSourceId      () => string
    newDashboardId   () => string
    randomBytes      (n) => Buffer
    maxAccounts      number                     default MAX_DEMO_ACCOUNTS
*/

const crypto = require('crypto');
const express = require('express');
const { ok, fail } = require('../envelope');
const libDemo = require('../demo');

const NOT_AVAILABLE = 'The demo is not available';
const BUSY = 'The demo is busy right now, try again in an hour';
const DEFAULT_PREFERENCES = { defaultChart: 'line', refreshRate: 0 };
// Not a bcrypt hash, so verifyPassword is always false: nobody can log in to a demo account with
// a password, change its password, or change its email.
const NO_PASSWORD = '!demo-account-has-no-password';

function NewId(pPrefix)
{
  return `${pPrefix}_${crypto.randomBytes(12).toString('base64url')}`;
}

function ResolveDeps(pDeps)
{
  const tmpDeps = pDeps || {};
  const tmpRepos = tmpDeps.repos || require('../repos');
  return {
    seedUser: tmpDeps.seedUser || (() => (process.env.DEMO_SEED_USER || '').trim()),
    repos: { ...tmpRepos, demo: tmpRepos.demo || require('../repos/demo') },
    withTransaction: tmpDeps.withTransaction || require('../db').withTransaction,
    session: tmpDeps.session || require('../session'),
    newSourceId: tmpDeps.newSourceId || (() => NewId('src')),
    newDashboardId: tmpDeps.newDashboardId || (() => NewId('dash')),
    randomBytes: tmpDeps.randomBytes || crypto.randomBytes,
    maxAccounts: tmpDeps.maxAccounts || libDemo.MAX_DEMO_ACCOUNTS,
  };
}

// The showcase owner's id and public boards, or null when the demo is off.
async function LoadShowcase(pD)
{
  const tmpName = pD.seedUser();
  if (!tmpName) return null;
  const tmpOwnerId = await pD.repos.demo.findUserIdByUsername(tmpName);
  if (tmpOwnerId === null || tmpOwnerId === undefined) return null;
  const tmpBoards = await pD.repos.demo.listPublicDashboards(tmpOwnerId);
  return tmpBoards.length > 0 ? { ownerId: tmpOwnerId, boards: tmpBoards } : null;
}

// Copies the sources and boards into pUserId inside pTx. Returns the new dashboard ids, in order.
async function CopyShowcase(pD, pShowcase, pUserId, pTx)
{
  const tmpWanted = libDemo.SourceIdsOf(pShowcase.boards.map((pBoard) => pBoard.definition));
  const tmpRows = await pD.repos.demo.listSourcesForCopy(pShowcase.ownerId, tmpWanted, pTx);
  const tmpIdMap = {};
  for (const tmpRow of tmpRows)
  {
    const tmpNewId = pD.newSourceId();
    tmpIdMap[tmpRow.id] = tmpNewId;
    await pD.repos.demo.insertSourceCopy(pUserId, {
      id: tmpNewId,
      name: tmpRow.name,
      type: tmpRow.type,
      status: tmpRow.status,
      keyEnc: tmpRow.key_enc,
      keyLast4: tmpRow.key_last4,
      fileData: tmpRow.file_data,
      lastSyncAt: tmpRow.last_sync_at,
    }, pTx);
  }
  const tmpDashboardIds = [];
  for (const tmpBoard of pShowcase.boards)
  {
    const tmpId = pD.newDashboardId();
    const tmpDef = libDemo.CloneDefinition(tmpBoard.definition, tmpIdMap);
    await pD.repos.dashboards.create(pUserId, { id: tmpId, name: tmpBoard.name, definition: tmpDef }, pTx);
    tmpDashboardIds.push(tmpId);
  }
  return tmpDashboardIds;
}

function CreateDemoRouter(pDeps)
{
  const tmpD = ResolveDeps(pDeps);
  const tmpRouter = express.Router();

  tmpRouter.get('/', async (pReq, pRes) =>
  {
    const tmpShowcase = await LoadShowcase(tmpD);
    if (!tmpShowcase) return ok(pRes, 200, { enabled: false, boards: [] });
    return ok(pRes, 200, {
      enabled: true,
      boards: tmpShowcase.boards.map((pBoard) => ({ id: pBoard.id, name: pBoard.name })),
    });
  });

  tmpRouter.post('/', async (pReq, pRes) =>
  {
    const tmpShowcase = await LoadShowcase(tmpD);
    if (!tmpShowcase) return fail(pRes, 404, NOT_AVAILABLE);
    const tmpLive = await tmpD.repos.demo.countDemoUsers(libDemo.DEMO_EMAIL_DOMAIN);
    if (tmpLive >= tmpD.maxAccounts)
    {
      const tmpRecycled = await tmpD.repos.demo.recycleOldestDemoUser(
        libDemo.DEMO_EMAIL_DOMAIN, libDemo.DEMO_RECYCLE_MIN_AGE_HOURS);
      if (!tmpRecycled) return fail(pRes, 503, BUSY);
    }

    const tmpIdentity = libDemo.NewDemoIdentity(tmpD.randomBytes);
    const tmpSession = tmpD.session.newSessionToken();
    const tmpDashboardIds = await tmpD.withTransaction(async (pTx) =>
    {
      const tmpUserId = await tmpD.repos.users.create({
        username: tmpIdentity.username,
        email: tmpIdentity.email,
        displayName: tmpIdentity.displayName,
        passwordHash: NO_PASSWORD,
        preferences: DEFAULT_PREFERENCES,
      }, pTx);
      const tmpIds = await CopyShowcase(tmpD, tmpShowcase, tmpUserId, pTx);
      await tmpD.repos.sessions.create(tmpUserId, tmpSession.tokenHash, pTx);
      return tmpIds;
    });

    pRes.setHeader('Set-Cookie', tmpD.session.buildBrowserSessionCookie(tmpSession.token));
    return ok(pRes, 201, { dashboards: tmpDashboardIds.length, firstDashboardId: tmpDashboardIds[0] });
  });

  return tmpRouter;
}

module.exports = { CreateDemoRouter, NO_PASSWORD };
