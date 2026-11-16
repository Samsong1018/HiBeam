// Fetch client for the Kiroween backend. Loads as a CommonJS module in Node
// and as a plain browser script (exposes globalThis.KiroApi).
// This file is served publicly: no secrets, no require, no Node-only APIs.

class ApiError extends Error
{
    constructor(message, status)
    {
        super(message);
        this.name = `ApiError`;
        this.status = status;
    }
}

function isEnvelope(pValue)
{
    return pValue !== null
        && typeof pValue === `object`
        && typeof pValue.success === `boolean`;
}

function createApiClient({ fetchImpl = globalThis.fetch, baseUrl = `` } = {})
{
    // pOptions: { as: 'json' | 'blob', rawBody: Blob, contentType: string }
    async function request(pMethod, pPath, pBody, pOptions = {})
    {
        const init = { method: pMethod, credentials: `same-origin` };

        if (pOptions.rawBody !== undefined)
        {
            init.body = pOptions.rawBody;
            if (pOptions.contentType)
            {
                init.headers = { 'Content-Type': pOptions.contentType };
            }
        }
        else if (pBody !== undefined)
        {
            init.headers = { 'Content-Type': `application/json` };
            init.body = JSON.stringify(pBody);
        }

        let res;
        try
        {
            res = await fetchImpl(baseUrl + pPath, init);
        }
        catch (_err)
        {
            throw new ApiError(`Cannot reach the server`, undefined);
        }

        if (pOptions.as === `blob` && res.ok)
        {
            return await res.blob();
        }

        let envelope;
        try
        {
            envelope = JSON.parse(await res.text());
        }
        catch (_err)
        {
            throw new ApiError(`Invalid response from server`, res.status);
        }

        if (!isEnvelope(envelope))
        {
            throw new ApiError(`Invalid response from server`, res.status);
        }

        if (res.ok && envelope.success === true)
        {
            return envelope.data;
        }

        const message = typeof envelope.error === `string` && envelope.error
            ? envelope.error
            : `Request failed`;
        throw new ApiError(message, res.status);
    }

    const enc = encodeURIComponent;

    return {
        // Auth
        signup: (pBody) => request(`POST`, `/api/auth/signup`, pBody),
        login: (pBody) => request(`POST`, `/api/auth/login`, pBody),
        logout: () => request(`POST`, `/api/auth/logout`),
        forgotPassword: (pBody) => request(`POST`, `/api/auth/forgot-password`, pBody),
        resetPassword: (pBody) => request(`POST`, `/api/auth/reset-password`, pBody),

        // Account
        getAccount: () => request(`GET`, `/api/account`),
        updateProfile: (pBody) => request(`PATCH`, `/api/account/profile`, pBody),
        putAvatar: (pBlob) => request(`PUT`, `/api/account/avatar`, undefined,
            { rawBody: pBlob, contentType: pBlob && pBlob.type ? pBlob.type : undefined }),
        deleteAvatar: () => request(`DELETE`, `/api/account/avatar`),
        changePassword: (pBody) => request(`POST`, `/api/account/password`, pBody),
        changeEmail: (pBody) => request(`POST`, `/api/account/email`, pBody),
        confirmEmail: (pToken) => request(`GET`, `/api/account/email/confirm?token=${enc(pToken)}`),
        updatePreferences: (pBody) => request(`PATCH`, `/api/account/preferences`, pBody),
        revokeAllSessions: () => request(`POST`, `/api/account/sessions/revoke-all`),
        deleteAccount: () => request(`DELETE`, `/api/account`),
        getAvatar: () => request(`GET`, `/api/account/avatar`, undefined, { as: `blob` }),

        // Sources
        listSources: () => request(`GET`, `/api/sources`),
        createSource: (pBody) => request(`POST`, `/api/sources`, pBody),
        deleteSource: (pId) => request(`DELETE`, `/api/sources/${enc(pId)}`),
        testSource: (pId) => request(`POST`, `/api/sources/${enc(pId)}/test`),
        previewSource: (pId) => request(`GET`, `/api/sources/${enc(pId)}/preview`),

        // Dashboards
        listDashboards: () => request(`GET`, `/api/dashboards`),
        createDashboard: (pBody) => request(`POST`, `/api/dashboards`, pBody),
        getDashboard: (pId) => request(`GET`, `/api/dashboards/${enc(pId)}`),
        updateDashboard: (pId, pBody) => request(`PATCH`, `/api/dashboards/${enc(pId)}`, pBody),
        deleteDashboard: (pId) => request(`DELETE`, `/api/dashboards/${enc(pId)}`),
        getDashboardData: (pId) => request(`GET`, `/api/dashboards/${enc(pId)}/data`)
    };
}

// Default instance. Created lazily-safe: fetch may be absent in old Node, so guard.
const api = createApiClient({
    fetchImpl: (...pArgs) => globalThis.fetch(...pArgs),
    baseUrl: ``
});

if (typeof module !== `undefined` && module.exports)
{
    module.exports = { createApiClient, ApiError, api };
}
else
{
    globalThis.KiroApi = { createApiClient, ApiError, api };
}
