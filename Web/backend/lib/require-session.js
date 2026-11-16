'use strict';

const libSession = require('./session');
const libEnvelope = require('./envelope');

const UNAUTHENTICATED_MESSAGE = 'Authentication required';

// Factory: requireSession({ sessions }) -> Express middleware (req, res, next).
// Sets req.userId and req.sessionId for a valid session; otherwise responds 401 via fail().
// Exactly one repo query (findByTokenHash) runs, and none when the cookie is missing/malformed.
function RequireSession(pOptions)
{
    const tmpOptions = pOptions || {};
    let tmpSessions = tmpOptions.sessions;

    return async function RequireSessionMiddleware(pReq, pRes, pNext)
    {
        try
        {
            const tmpHeader = pReq && pReq.headers ? pReq.headers.cookie : undefined;
            const tmpCookies = libSession.parseCookies(tmpHeader);
            const tmpToken = tmpCookies[libSession.COOKIE_NAME];

            if (typeof tmpToken !== 'string' || tmpToken === '')
            {
                return libEnvelope.fail(pRes, 401, UNAUTHENTICATED_MESSAGE);
            }

            if (!tmpSessions)
            {
                tmpSessions = require('./repos/sessions');
            }

            const tmpRow = await tmpSessions.findByTokenHash(libSession.sha256Hex(tmpToken));

            if (!tmpRow || !tmpRow.is_valid)
            {
                return libEnvelope.fail(pRes, 401, UNAUTHENTICATED_MESSAGE);
            }

            pReq.userId = tmpRow.user_id;
            pReq.sessionId = tmpRow.id;
            return pNext();
        }
        catch (pErr)
        {
            return pNext(pErr);
        }
    };
}

module.exports = { RequireSession, requireSession: RequireSession, UNAUTHENTICATED_MESSAGE };
