'use strict';

/*
  One-click demo accounts.

  A visitor (usually a judge) clicks "Try the demo" and gets a throwaway account holding copies of
  the showcase account's public boards and the sources those boards read. Nothing in the showcase
  account changes, and the visitor never sees it or its source credentials: each source is copied
  with its encrypted key, which is never sent to a browser.

  A demo account is marked by its email, `demo-<hex>@demo.invalid`. `.invalid` is reserved
  (RFC 2606), so no real address can match, and changing the email needs the account password,
  which nobody knows. That keeps the mark stable even if the visitor renames the account.
  maintenance.js deletes demo accounts a day after they were made.

  This file is pure. The route is routes/demo.js and the queries are repos/demo.js.
*/

const crypto = require('crypto');
const { collectSourceIds } = require('./validators');

const DEMO_EMAIL_DOMAIN = 'demo.invalid';
const DEMO_TTL_HOURS = 24;
// Live demo accounts at once. At the cap, a new demo replaces the oldest one that's at least
// DEMO_RECYCLE_MIN_AGE_HOURS old, so someone filling the cap only churns the slots and real visitors
// still get in. Only when every live demo is younger than that does POST /api/demo answer 503.
const MAX_DEMO_ACCOUNTS = 200;
const DEMO_RECYCLE_MIN_AGE_HOURS = 1;

function IsDemoEmail(pEmail)
{
  return typeof pEmail === 'string' && pEmail.toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);
}

// Username uses '-', which signup and profile edits reject, so a real user can never take one.
function NewDemoIdentity(pRandomBytes = crypto.randomBytes)
{
  const tmpTag = pRandomBytes(5).toString('hex');
  return {
    username: `demo-${tmpTag}`,
    email: `demo-${tmpTag}@${DEMO_EMAIL_DOMAIN}`,
    displayName: 'Demo visitor',
  };
}

// The source ids a set of dashboard definitions read, de-duplicated, in first-use order.
function SourceIdsOf(pDefinitions)
{
  const tmpIds = new Set();
  (Array.isArray(pDefinitions) ? pDefinitions : []).forEach((pDef) =>
  {
    collectSourceIds(pDef).forEach((pId) => tmpIds.add(pId));
  });
  return [...tmpIds];
}

/*
  A copy of pDef with every binding's sourceId swapped through pIdMap. A binding whose source
  wasn't copied (missing from the map) becomes unbound (''), so the copy can never point at a
  source the demo account doesn't own. Widgets without bindings pass through. pDef is not mutated.
*/
function CloneDefinition(pDef, pIdMap)
{
  const tmpMap = pIdMap || {};
  const tmpWidgets = Array.isArray(pDef && pDef.widgets) ? pDef.widgets : [];
  return {
    ...pDef,
    widgets: tmpWidgets.map((pWidget) =>
    {
      const tmpBindings = pWidget && pWidget.config && pWidget.config.bindings;
      if (!Array.isArray(tmpBindings)) return pWidget;
      return {
        ...pWidget,
        config: {
          ...pWidget.config,
          bindings: tmpBindings.map((pBinding) =>
          {
            const tmpOld = pBinding && pBinding.sourceId;
            if (typeof tmpOld !== 'string' || tmpOld === '') return pBinding;
            const tmpNew = Object.prototype.hasOwnProperty.call(tmpMap, tmpOld) ? tmpMap[tmpOld] : '';
            return { ...pBinding, sourceId: tmpNew };
          }),
        },
      };
    }),
  };
}

module.exports = {
  DEMO_EMAIL_DOMAIN,
  DEMO_TTL_HOURS,
  MAX_DEMO_ACCOUNTS,
  DEMO_RECYCLE_MIN_AGE_HOURS,
  IsDemoEmail,
  NewDemoIdentity,
  SourceIdsOf,
  CloneDefinition,
};
