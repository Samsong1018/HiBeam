// ============================================================
// Minimal HiBeam REST session for APP2 scripts: log in once, keep the
// sid cookie, retry once on 401. Reads the same env as the MCP server
// (HIBEAM_BASE_URL / HIBEAM_USERNAME / HIBEAM_PASSWORD, or mcp/.env).
// ============================================================

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function CreateClient(pEnv = process.env)
{
    dotenv.config({ path: path.join(HERE, '../../mcp/.env'), quiet: true });
    const tmpBase = (pEnv.HIBEAM_BASE_URL || process.env.HIBEAM_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
    const tmpUser = pEnv.HIBEAM_USERNAME || process.env.HIBEAM_USERNAME || '';
    const tmpPass = pEnv.HIBEAM_PASSWORD || process.env.HIBEAM_PASSWORD || '';
    if (!tmpUser || !tmpPass) throw new Error('Set HIBEAM_USERNAME and HIBEAM_PASSWORD (or fill in mcp/.env).');
    let tmpCookie = null;

    async function Login()
    {
        const tmpRes = await fetch(`${tmpBase}/api/auth/login`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: tmpUser, password: tmpPass }),
        });
        // never echo the body: a failed login message is all we need
        if (!tmpRes.ok) throw new Error(`HiBeam login failed for ${tmpUser} (HTTP ${tmpRes.status})`);
        const tmpMatch = (tmpRes.headers.get('set-cookie') || '').match(/(?:^|,\s*)sid=([^;,]+)/i);
        if (!tmpMatch) throw new Error('HiBeam login returned no session cookie');
        tmpCookie = `sid=${tmpMatch[1]}`;
    }

    async function Send(pMethod, pPath, pBody, pType = 'application/json')
    {
        if (!tmpCookie) await Login();
        const tmpGo = () => fetch(`${tmpBase}${pPath}`,
        {
            method: pMethod,
            headers: { Cookie: tmpCookie, ...(pBody === undefined ? {} : { 'Content-Type': pType }) },
            body: pBody === undefined ? undefined : (pType === 'application/json' ? JSON.stringify(pBody) : pBody),
        });
        let tmpRes = await tmpGo();
        if (tmpRes.status === 401)
        {
            await Login();
            tmpRes = await tmpGo();
        }
        let tmpJson;
        try { tmpJson = await tmpRes.json(); }
        catch { throw new Error(`${pMethod} ${pPath} returned non-JSON (HTTP ${tmpRes.status})`); }
        if (!tmpRes.ok || tmpJson.success === false) throw new Error(`${pMethod} ${pPath}: ${tmpJson.error || `HTTP ${tmpRes.status}`}`);
        return tmpJson.data;
    }

    return {
        baseUrl: tmpBase,
        get: (pPath) => Send('GET', pPath),
        post: (pPath, pBody) => Send('POST', pPath, pBody ?? {}),
        patch: (pPath, pBody) => Send('PATCH', pPath, pBody),
        putFile: (pPath, pBytes) => Send('PUT', pPath, pBytes, 'application/octet-stream'),
        del: (pPath) => Send('DELETE', pPath),
    };
}
