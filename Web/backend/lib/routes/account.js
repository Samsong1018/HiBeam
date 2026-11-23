'use strict';
/*
 * Account routes. Paths are RELATIVE to /api/account.
 *
 * Exports:
 *   CreateAccountRouter(pDeps)      session-protected routes. server.js must mount it AFTER the
 *                                   session middleware:
 *                                     app.use('/api/account', requireSession(...), CreateAccountRouter(deps))
 *   CreateEmailConfirmRouter(pDeps) GET /email/confirm only. Token-based, NO session (Requirement
 *                                   10.5 and the design: the link must work from an email client
 *                                   that has no cookie, and the token binds the user id).
 *
 * Mounting order in server.js (the confirm router MUST come before requireSession, otherwise the
 * confirm link returns 401):
 *   app.use('/api/account', CreateEmailConfirmRouter(deps));
 *   app.use('/api/account', requireSession({ sessions }), CreateAccountRouter(deps));
 * The confirm router only answers GET /email/confirm and calls next() for everything else.
 * CreateAccountRouter does not contain /email/confirm, so it cannot be reached behind a session.
 *
 * Routes behind the session: GET /, PATCH /profile, PUT /avatar, GET /avatar, DELETE /avatar,
 * POST /password, POST /email, PATCH /preferences, POST /sessions/revoke-all, DELETE /.
 * Body parsing: express.json() is expected for JSON routes. PUT /avatar reads the raw bytes with
 * express.raw (2 MB). If a global express.json() already consumed a JSON-typed upload, req.body
 * is not a Buffer and the upload is rejected as "image missing". Image content types are not
 * touched by express.json().
 *
 * Every dependency is optional and defaults to the real module, so tests can inject fakes:
 *   repos           { users, sessions, tokens }          (default ../repos)
 *   withTransaction async (fn(tx)) -> result             (default ../db)
 *   passwords       { hashPassword, verifyPassword }
 *   validators      { validateProfile, validatePreferences, validateChangePassword, validateChangeEmail }
 *   session         { buildClearCookie }
 *   tokens          { createEmailToken, hashToken, EMAIL_TOKEN_TTL_MS }
 *   image           { checkAvatar, MAX_AVATAR_BYTES }
 *   views           { toPublicProfile }
 *   envelope        { ok, fail }
 *   bcryptCost      number, passed to hashPassword (default: passwords default)
 *   now             () -> ms epoch (default Date.now)
 *   logger          { log(msg) } used for confirmation links (default console)
 *   baseUrl         string for confirmation links (default process.env.APP_BASE_URL or '')
 */
const express = require('express');
const CURRENT_PASSWORD_ERROR = 'Current password is incorrect';
const BAD_CONFIRM_TOKEN_ERROR = 'Confirmation token is invalid or expired';
const USERNAME_TAKEN_ERROR = 'Username is already taken';
const EMAIL_TAKEN_ERROR = 'Email is already in use';
const NOT_FOUND_ERROR = 'Not found';
const AVATAR_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
const AVATAR_ERRORS = {
    missing: 'Image is missing',
    too_large: 'Image is too large (maximum 2 MB)',
    unsupported: 'Unsupported image type (use PNG, JPEG, or WebP)',
};
function FieldsToMessage(pFields)
{
    return Object.entries(pFields)
        .map(([pName, pMsg]) => `${pName}: ${pMsg}`)
        .join('; ');
}
function IsDuplicateEntry(pErr)
{
    return Boolean(pErr) && pErr.code === 'ER_DUP_ENTRY';
}
function ResolveDeps(pDeps)
{
    const tmpDeps = pDeps || {};
    const tmpImage = tmpDeps.image || require('../image');
    return {
        repos: tmpDeps.repos || require('../repos'),
        withTransaction: tmpDeps.withTransaction || require('../db').withTransaction,
        passwords: tmpDeps.passwords || require('../passwords'),
        validators: tmpDeps.validators || require('../validators'),
        session: tmpDeps.session || require('../session'),
        tokens: tmpDeps.tokens || require('../tokens'),
        image: tmpImage,
        views: tmpDeps.views || require('../views'),
        envelope: tmpDeps.envelope || require('../envelope'),
        bcryptCost: tmpDeps.bcryptCost,
        logger: tmpDeps.logger || console,
        baseUrl: function BaseUrl()
        {
            return tmpDeps.baseUrl !== undefined ? tmpDeps.baseUrl : (process.env.APP_BASE_URL || '');
        },
    };
}
function CreateAccountRouter(pDeps)
{
    const tmpD = ResolveDeps(pDeps);
    const tmpRepos = tmpD.repos;
    const tmpEnv = tmpD.envelope;
    const tmpRouter = express.Router();
    const tmpRawLimit = tmpD.image.MAX_AVATAR_BYTES || 2097152;
    const tmpRawParser = express.raw({ type: () => true, limit: tmpRawLimit });
    function HashOptions()
    {
        return tmpD.bcryptCost === undefined ? undefined : { cost: tmpD.bcryptCost };
    }
    async function SendProfile(pRes, pStatus, pUserId)
    {
        const tmpRow = await tmpRepos.users.getProfile(pUserId);
        if (!tmpRow)
        {
            return tmpEnv.fail(pRes, 404, NOT_FOUND_ERROR);
        }
        return tmpEnv.ok(pRes, pStatus, tmpD.views.toPublicProfile(tmpRow));
    }
    // GET /api/account
    tmpRouter.get('/', async (pReq, pRes) =>
    {
        return SendProfile(pRes, 200, pReq.userId);
    });
    // PATCH /api/account/profile
    tmpRouter.patch('/profile', async (pReq, pRes) =>
    {
        const tmpCheck = tmpD.validators.validateProfile(pReq.body);
        if (!tmpCheck.ok)
        {
            return tmpEnv.fail(pRes, 400, FieldsToMessage(tmpCheck.fields));
        }
        try
        {
            const tmpMatched = await tmpRepos.users.updateProfile(pReq.userId, tmpCheck.value);
            if (!tmpMatched)
            {
                return tmpEnv.fail(pRes, 404, NOT_FOUND_ERROR);
            }
        }
        catch (pErr)
        {
            if (IsDuplicateEntry(pErr))
            {
                return tmpEnv.fail(pRes, 409, USERNAME_TAKEN_ERROR);
            }
            throw pErr;
        }
        return SendProfile(pRes, 200, pReq.userId);
    });
    // PUT /api/account/avatar
    // Maps the body parser's "entity too large" to 400 here; everything else goes to errorMiddleware.
    tmpRouter.put('/avatar', (pReq, pRes, pNext) =>
    {
        tmpRawParser(pReq, pRes, (pErr) =>
        {
            if (pErr && pErr.type === 'entity.too.large')
            {
                return tmpEnv.fail(pRes, 400, AVATAR_ERRORS.too_large);
            }
            return pNext(pErr);
        });
    }, async (pReq, pRes) =>
    {
        const tmpBody = Buffer.isBuffer(pReq.body) ? pReq.body : null;
        const tmpResult = tmpD.image.checkAvatar(tmpBody);
        if (typeof tmpResult === 'string')
        {
            return tmpEnv.fail(pRes, 400, AVATAR_ERRORS[tmpResult] || AVATAR_ERRORS.unsupported);
        }
        // One UPDATE sets bytes, sniffed mime, and avatar_updated_at (Requirement 8.8).
        const tmpMatched = await tmpRepos.users.setAvatar(pReq.userId, tmpBody, tmpResult.mime);
        if (!tmpMatched)
        {
            return tmpEnv.fail(pRes, 404, NOT_FOUND_ERROR);
        }
        const tmpRow = await tmpRepos.users.getProfile(pReq.userId);
        if (!tmpRow)
        {
            return tmpEnv.fail(pRes, 404, NOT_FOUND_ERROR);
        }
        return tmpEnv.ok(pRes, 200, { avatarUrl: tmpD.views.toPublicProfile(tmpRow).avatarUrl });
    });
    // GET /api/account/avatar
    // One query, keyed by req.userId only. `v` never picks the image; it only decides caching:
    // the profile hands out /avatar?v=<updated epoch>, and that URL changes whenever the avatar
    // does, so a versioned request can be cached for a day. An unversioned one revalidates.
    tmpRouter.get('/avatar', async (pReq, pRes) =>
    {
        const tmpAvatar = await tmpRepos.users.getAvatar(pReq.userId);
        // The stored mime is server-written; only these three values are ever sent as Content-Type.
        const tmpMime = tmpAvatar && AVATAR_MIMES.includes(tmpAvatar.avatar_mime) ? tmpAvatar.avatar_mime : null;
        if (!tmpMime)
        {
            return tmpEnv.fail(pRes, 404, NOT_FOUND_ERROR);
        }
        pRes.status(200);
        pRes.setHeader('Content-Type', tmpMime);
        pRes.setHeader('X-Content-Type-Options', 'nosniff');
        const tmpVersioned = typeof pReq.query.v === 'string' && /^\d+$/.test(pReq.query.v);
        pRes.setHeader('Cache-Control', tmpVersioned ? 'private, max-age=86400' : 'private, no-cache');
        pRes.setHeader('Content-Length', Buffer.byteLength(tmpAvatar.avatar));
        return pRes.end(tmpAvatar.avatar);
    });
    // DELETE /api/account/avatar
    tmpRouter.delete('/avatar', async (pReq, pRes) =>
    {
        await tmpRepos.users.clearAvatar(pReq.userId);
        return tmpEnv.ok(pRes, 200, null);
    });
    // POST /api/account/password
    tmpRouter.post('/password', async (pReq, pRes) =>
    {
        const tmpCheck = tmpD.validators.validateChangePassword(pReq.body);
        if (!tmpCheck.ok)
        {
            return tmpEnv.fail(pRes, 400, FieldsToMessage(tmpCheck.fields));
        }
        const tmpStoredHash = await tmpRepos.users.getPasswordHash(pReq.userId);
        const tmpMatches = await tmpD.passwords.verifyPassword(tmpCheck.value.currentPassword, tmpStoredHash);
        if (!tmpMatches)
        {
            return tmpEnv.fail(pRes, 403, CURRENT_PASSWORD_ERROR);
        }
        const tmpNewHash = await tmpD.passwords.hashPassword(tmpCheck.value.newPassword, HashOptions());
        // Hash change and revocation of the other sessions commit together; the current session stays valid.
        await tmpD.withTransaction(async (pTx) =>
        {
            await tmpRepos.users.setPasswordHash(pReq.userId, tmpNewHash, pTx);
            await tmpRepos.sessions.revokeAllExcept(pReq.userId, pReq.sessionId, pTx);
        });
        return tmpEnv.ok(pRes, 200, null);
    });
    // POST /api/account/email
    tmpRouter.post('/email', async (pReq, pRes) =>
    {
        const tmpCheck = tmpD.validators.validateChangeEmail(pReq.body);
        if (!tmpCheck.ok)
        {
            return tmpEnv.fail(pRes, 400, FieldsToMessage(tmpCheck.fields));
        }
        const tmpStoredHash = await tmpRepos.users.getPasswordHash(pReq.userId);
        const tmpMatches = await tmpD.passwords.verifyPassword(tmpCheck.value.password, tmpStoredHash);
        if (!tmpMatches)
        {
            return tmpEnv.fail(pRes, 403, CURRENT_PASSWORD_ERROR);
        }
        // Includes the user's own current email (Requirement 10.4).
        if (await tmpRepos.users.emailExists(tmpCheck.value.newEmail))
        {
            return tmpEnv.fail(pRes, 409, EMAIL_TAKEN_ERROR);
        }
        const tmpToken = tmpD.tokens.createEmailToken();
        await tmpRepos.tokens.createEmail(
            pReq.userId,
            tmpCheck.value.newEmail,
            tmpToken.tokenHash,
            Math.round(tmpD.tokens.EMAIL_TOKEN_TTL_MS / 1000));
        // No mail service: the link goes to the server console only.
        tmpD.logger.log(`[email-confirm] ${tmpD.baseUrl()}/api/account/email/confirm?token=${tmpToken.token}`);
        return tmpEnv.ok(pRes, 200, null);
    });
    // PATCH /api/account/preferences
    tmpRouter.patch('/preferences', async (pReq, pRes) =>
    {
        const tmpCheck = tmpD.validators.validatePreferences(pReq.body);
        if (!tmpCheck.ok)
        {
            return tmpEnv.fail(pRes, 400, FieldsToMessage(tmpCheck.fields));
        }
        const tmpPrefs = {
            defaultChart: tmpCheck.value.defaultChart,
            refreshRate: tmpCheck.value.refreshRate,
        };
        const tmpMatched = await tmpRepos.users.updatePreferences(pReq.userId, tmpPrefs);
        if (!tmpMatched)
        {
            return tmpEnv.fail(pRes, 404, NOT_FOUND_ERROR);
        }
        return tmpEnv.ok(pRes, 200, tmpPrefs);
    });
    // POST /api/account/sessions/revoke-all
    tmpRouter.post('/sessions/revoke-all', async (pReq, pRes) =>
    {
        await tmpRepos.sessions.revokeAll(pReq.userId);
        pRes.setHeader('Set-Cookie', tmpD.session.buildClearCookie());
        return tmpEnv.ok(pRes, 200, null);
    });
    // DELETE /api/account
    // On any failure the transaction rolls back, the error reaches errorMiddleware (500), and no
    // Set-Cookie is sent. The cookie is cleared only after commit.
    tmpRouter.delete('/', async (pReq, pRes) =>
    {
        const tmpDeleted = await tmpD.withTransaction((pTx) => tmpRepos.users.deleteAccount(pReq.userId, pTx));
        pRes.setHeader('Set-Cookie', tmpD.session.buildClearCookie());
        if (!tmpDeleted)
        {
            return tmpEnv.fail(pRes, 404, NOT_FOUND_ERROR);
        }
        return tmpEnv.ok(pRes, 200, null);
    });
    return tmpRouter;
}
// Token-based: no session. Mount BEFORE requireSession (see header).
function CreateEmailConfirmRouter(pDeps)
{
    const tmpD = ResolveDeps(pDeps);
    const tmpRepos = tmpD.repos;
    const tmpEnv = tmpD.envelope;
    const tmpRouter = express.Router();
    // GET /api/account/email/confirm?token=
    tmpRouter.get('/email/confirm', async (pReq, pRes) =>
    {
        const tmpRawToken = pReq.query ? pReq.query.token : undefined;
        if (typeof tmpRawToken !== 'string' || tmpRawToken.length === 0 || tmpRawToken.length > 256)
        {
            return tmpEnv.fail(pRes, 400, BAD_CONFIRM_TOKEN_ERROR);
        }
        const tmpTokenHash = tmpD.tokens.hashToken(tmpRawToken);
        // The transaction commits in every outcome except a thrown error, so on a 409 the
        // consumed token stays marked used (Requirement 10.7).
        const tmpOutcome = await tmpD.withTransaction(async (pTx) =>
        {
            const tmpConsumed = await tmpRepos.tokens.consumeEmail(tmpTokenHash, pTx);
            if (!tmpConsumed.consumed)
            {
                return 'invalid';
            }
            if (await tmpRepos.users.emailExists(tmpConsumed.newEmail, pTx))
            {
                return 'conflict';
            }
            try
            {
                await tmpRepos.users.setEmail(tmpConsumed.userId, tmpConsumed.newEmail, pTx);
            }
            catch (pErr)
            {
                // Lost a race with another user taking the address; a duplicate-key error
                // does not abort the MySQL transaction, so the used token still commits.
                if (IsDuplicateEntry(pErr))
                {
                    return 'conflict';
                }
                throw pErr;
            }
            return 'confirmed';
        });
        if (tmpOutcome === 'invalid')
        {
            return tmpEnv.fail(pRes, 400, BAD_CONFIRM_TOKEN_ERROR);
        }
        if (tmpOutcome === 'conflict')
        {
            return tmpEnv.fail(pRes, 409, EMAIL_TAKEN_ERROR);
        }
        return tmpEnv.ok(pRes, 200, null);
    });
    return tmpRouter;
}
module.exports = { CreateAccountRouter, CreateEmailConfirmRouter };
