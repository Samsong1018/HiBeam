'use strict';

/*
 * Auth routes. Paths are RELATIVE to /api/auth: server.js must mount the returned router with
 *   app.use('/api/auth', CreateAuthRouter(deps))
 * The router expects a JSON body parser (express.json()) to run before it.
 *
 * Routes: POST /signup, /login, /logout, /forgot-password, /reset-password
 *
 * CreateAuthRouter(pDeps) -> express.Router. Every dependency is optional and defaults to the
 * real module, so tests can inject fakes:
 *   repos           { users, sessions, tokens, loginAttempts }   (default ../repos)
 *   withTransaction async (fn(tx)) -> result                      (default ../db)
 *   passwords       { hashPassword, verifyPassword, DUMMY_HASH }
 *   validators      { validateSignup, validateLogin, validateEmail, validateNewPassword }
 *   session         { newSessionToken, buildSessionCookie, buildClearCookie, parseCookies,
 *                     sha256Hex, COOKIE_NAME }
 *   tokens          { createResetToken, hashToken, RESET_TOKEN_TTL_MS }
 *   lockout         { evaluateLockout }
 *   envelope        { ok, fail }
 *   bcryptCost      number, passed to hashPassword (default: passwords default, 12)
 *   now             () -> ms epoch (default Date.now)
 *   logger          { log(msg) } used for reset links (default console)
 *   baseUrl         string for reset links (default process.env.APP_BASE_URL or '')
 */

const express = require('express');

const GENERIC_LOGIN_ERROR = 'Invalid credentials';
const FORGOT_MESSAGE = 'If that email is registered, a reset link has been sent';
const BAD_RESET_TOKEN_ERROR = 'Reset token is invalid or expired';
const DEFAULT_PREFERENCES = { defaultChart: 'line', refreshRate: 0 };

function FieldsToMessage(pFields)
{
    return Object.entries(pFields)
        .map(([pName, pMsg]) => `${pName}: ${pMsg}`)
        .join('; ');
}

function IsPlainObject(pValue)
{
    return pValue !== null && typeof pValue === 'object' && !Array.isArray(pValue);
}

// Names the conflicting field from the MySQL duplicate-key message (index name).
function DuplicateField(pErr)
{
    const tmpText = String((pErr && (pErr.sqlMessage || pErr.message)) || '');
    if (tmpText.includes('uq_users_email') || /email/i.test(tmpText)) return 'email';
    if (tmpText.includes('uq_users_username') || /username/i.test(tmpText)) return 'username';
    return null;
}

function CreateAuthRouter(pDeps)
{
    const tmpDeps = pDeps || {};
    const tmpRepos = tmpDeps.repos || require('../repos');
    const tmpWithTransaction = tmpDeps.withTransaction || require('../db').withTransaction;
    const tmpPasswords = tmpDeps.passwords || require('../passwords');
    const tmpValidators = tmpDeps.validators || require('../validators');
    const tmpSession = tmpDeps.session || require('../session');
    const tmpTokens = tmpDeps.tokens || require('../tokens');
    const tmpLockout = tmpDeps.lockout || require('../lockout');
    const tmpEnvelope = tmpDeps.envelope || require('../envelope');
    const tmpNow = tmpDeps.now || Date.now;
    const tmpLogger = tmpDeps.logger || console;
    const tmpHashOptions = tmpDeps.bcryptCost === undefined ? undefined : { cost: tmpDeps.bcryptCost };

    const tmpRouter = express.Router();

    function GetBaseUrl()
    {
        return tmpDeps.baseUrl !== undefined ? tmpDeps.baseUrl : (process.env.APP_BASE_URL || '');
    }

    function SetCookie(pRes, pValue)
    {
        pRes.setHeader('Set-Cookie', pValue);
    }

    // Creates a session on `pEx` (a tx or undefined) and sets the cookie on the response.
    async function StartSession(pRes, pUserId, pEx)
    {
        const tmpNew = tmpSession.newSessionToken();
        await tmpRepos.sessions.create(pUserId, tmpNew.tokenHash, pEx);
        SetCookie(pRes, tmpSession.buildSessionCookie(tmpNew.token));
    }

    // ---- POST /signup ----
    tmpRouter.post('/signup', async (pReq, pRes) =>
    {
        const tmpResult = tmpValidators.validateSignup(pReq.body);
        if (!tmpResult.ok)
        {
            return tmpEnvelope.fail(pRes, 400, FieldsToMessage(tmpResult.fields));
        }
        const tmpValue = tmpResult.value;
        const tmpHash = await tmpPasswords.hashPassword(tmpValue.password, tmpHashOptions);

        let tmpProfile;
        let tmpCookieToken;
        try
        {
            tmpProfile = await tmpWithTransaction(async (pTx) =>
            {
                const tmpUserId = await tmpRepos.users.create({
                    username: tmpValue.username,
                    email: tmpValue.email,
                    displayName: tmpValue.displayName,
                    passwordHash: tmpHash,
                    preferences: DEFAULT_PREFERENCES,
                }, pTx);
                const tmpNew = tmpSession.newSessionToken();
                await tmpRepos.sessions.create(tmpUserId, tmpNew.tokenHash, pTx);
                tmpCookieToken = tmpNew.token;
                return tmpRepos.users.getProfile(tmpUserId, pTx);
            });
        }
        catch (pErr)
        {
            if (pErr && pErr.code === 'ER_DUP_ENTRY')
            {
                const tmpField = DuplicateField(pErr);
                const tmpMsg = tmpField ? `That ${tmpField} is already taken` : 'That username or email is already taken';
                return tmpEnvelope.fail(pRes, 409, tmpMsg);
            }
            throw pErr;
        }

        SetCookie(pRes, tmpSession.buildSessionCookie(tmpCookieToken));
        return tmpEnvelope.ok(pRes, 201, require('../views').toPublicProfile(tmpProfile));
    });

    // ---- POST /login ----
    tmpRouter.post('/login', async (pReq, pRes) =>
    {
        // 400 records no attempt and performs no password comparison.
        const tmpResult = tmpValidators.validateLogin(pReq.body);
        if (!tmpResult.ok)
        {
            return tmpEnvelope.fail(pRes, 400, FieldsToMessage(tmpResult.fields));
        }
        const tmpIdentifier = tmpResult.value.identifier;
        const tmpPassword = tmpResult.value.password;

        const tmpAttempts = await tmpRepos.loginAttempts.listRecent(tmpIdentifier);
        const tmpLock = tmpLockout.evaluateLockout(tmpAttempts, tmpNow());
        if (tmpLock.locked)
        {
            pRes.setHeader('Retry-After', String(tmpLock.retryAfterSeconds));
            return tmpEnvelope.fail(pRes, 429, 'Too many failed login attempts. Try again later');
        }

        const tmpUser = await tmpRepos.users.findByIdentifier(tmpIdentifier);
        // Always run one bcrypt comparison so unknown users cost the same as wrong passwords.
        const tmpMatches = await tmpPasswords.verifyPassword(
            tmpPassword,
            tmpUser ? tmpUser.password_hash : tmpPasswords.DUMMY_HASH
        );

        if (!tmpUser || !tmpMatches)
        {
            await tmpRepos.loginAttempts.record(tmpIdentifier, false);
            return tmpEnvelope.fail(pRes, 401, GENERIC_LOGIN_ERROR);
        }

        await tmpRepos.loginAttempts.clear(tmpIdentifier);
        await StartSession(pRes, tmpUser.id);
        const tmpProfile = await tmpRepos.users.getProfile(tmpUser.id);
        return tmpEnvelope.ok(pRes, 200, require('../views').toPublicProfile(tmpProfile));
    });

    // ---- POST /logout ----
    tmpRouter.post('/logout', async (pReq, pRes) =>
    {
        // The cookie is cleared on every path, including a database failure.
        SetCookie(pRes, tmpSession.buildClearCookie());
        try
        {
            const tmpCookies = tmpSession.parseCookies(pReq.headers ? pReq.headers.cookie : undefined);
            const tmpToken = tmpCookies[tmpSession.COOKIE_NAME];
            if (typeof tmpToken === 'string' && tmpToken !== '')
            {
                const tmpRow = await tmpRepos.sessions.findByTokenHash(tmpSession.sha256Hex(tmpToken));
                if (tmpRow && tmpRow.is_valid)
                {
                    await tmpRepos.sessions.revoke(tmpRow.user_id, tmpRow.id);
                }
            }
        }
        catch (pErr)
        {
            tmpLogger.error
                ? tmpLogger.error('[auth] logout failed: ' + (pErr && pErr.message ? pErr.message : 'unknown error'))
                : null;
            return tmpEnvelope.fail(pRes, 500, 'Internal server error');
        }
        return tmpEnvelope.ok(pRes, 200, null);
    });

    // ---- POST /forgot-password ----
    tmpRouter.post('/forgot-password', async (pReq, pRes) =>
    {
        const tmpBody = IsPlainObject(pReq.body) ? pReq.body : {};
        const tmpResult = tmpValidators.validateEmail(tmpBody.email);
        if (!tmpResult.ok)
        {
            return tmpEnvelope.fail(pRes, 400, FieldsToMessage(tmpResult.fields));
        }
        const tmpEmail = tmpResult.value;

        const tmpUser = await tmpRepos.users.findByIdentifier(tmpEmail);
        if (tmpUser)
        {
            const tmpReset = tmpTokens.createResetToken(tmpNow());
            await tmpWithTransaction(async (pTx) =>
            {
                await tmpRepos.tokens.invalidateUnusedReset(tmpUser.id, pTx);
                await tmpRepos.tokens.createReset(
                    tmpUser.id,
                    tmpReset.tokenHash,
                    Math.round(tmpTokens.RESET_TOKEN_TTL_MS / 1000),
                    pTx
                );
            });
            // No mail service: the link goes to the server console.
            tmpLogger.log(`[auth] password reset link for ${tmpEmail}: ${GetBaseUrl()}/pages/login.html?reset=${tmpReset.token}`);
        }

        return tmpEnvelope.ok(pRes, 200, { message: FORGOT_MESSAGE });
    });

    // ---- POST /reset-password ----
    tmpRouter.post('/reset-password', async (pReq, pRes) =>
    {
        const tmpBody = IsPlainObject(pReq.body) ? pReq.body : {};

        // Validate the password first so a bad password leaves the token unused.
        const tmpPwResult = tmpValidators.validateNewPassword(tmpBody.password);
        if (!tmpPwResult.ok)
        {
            return tmpEnvelope.fail(pRes, 400, FieldsToMessage(tmpPwResult.fields));
        }
        if (typeof tmpBody.token !== 'string' || tmpBody.token === '')
        {
            return tmpEnvelope.fail(pRes, 400, BAD_RESET_TOKEN_ERROR);
        }

        const tmpHash = await tmpPasswords.hashPassword(tmpPwResult.value, tmpHashOptions);
        const tmpTokenHash = tmpTokens.hashToken(tmpBody.token);

        const tmpDone = await tmpWithTransaction(async (pTx) =>
        {
            const tmpConsumed = await tmpRepos.tokens.consumeReset(tmpTokenHash, pTx);
            if (!tmpConsumed.consumed) return false;
            await tmpRepos.users.setPasswordHash(tmpConsumed.userId, tmpHash, pTx);
            await tmpRepos.sessions.revokeAll(tmpConsumed.userId, pTx);
            return true;
        });

        if (!tmpDone)
        {
            return tmpEnvelope.fail(pRes, 400, BAD_RESET_TOKEN_ERROR);
        }
        return tmpEnvelope.ok(pRes, 200, null);
    });

    return tmpRouter;
}

module.exports = { CreateAuthRouter, createAuthRouter: CreateAuthRouter };
