// ============================================================
// APP1 setup plan (pure, no network). setup.mjs carries it out.
//
// The four sources the Homelab Ops board reads, keyed by the
// placeholder each one fills in dashboard.template.json, and the
// template with those placeholders swapped for real source ids.
// ============================================================

// placeholder -> { name, type, path on the agent, extra source settings }
export const SOURCES = Object.freeze({
    metrics: { name: 'Homelab · metrics', type: 'rest', path: '/metrics' },
    history: { name: 'Homelab · history', type: 'rest', path: '/history' },
    services: { name: 'Homelab · services', type: 'rest', path: '/services' },
    logs: { name: 'Homelab · access log', type: 'logs', path: '/logs/access', extra: { format: 'nginx' } },
});

// The agent's base URL, checked and normalised. HiBeam only fetches public https/http URLs, so
// say so here instead of letting four source tests fail one by one.
export function NormaliseAgentUrl(pUrl)
{
    let tmpUrl;
    try { tmpUrl = new URL(String(pUrl || '').trim()); }
    catch { throw new Error('--agent must be a full URL, like https://your-domain.example/hibeam-agent'); }
    if (tmpUrl.protocol !== 'https:' && tmpUrl.protocol !== 'http:') throw new Error('--agent must be an http(s) URL');
    if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(tmpUrl.host))
    {
        throw new Error('HiBeam refuses loopback addresses (SSRF guard). Put the agent behind your public HTTPS site first: see APP1/README.md');
    }
    return `${tmpUrl.origin}${tmpUrl.pathname.replace(/\/+$/, '')}`;
}

// The create-source request bodies, in placeholder order. The token goes inside `key`, which
// HiBeam encrypts at rest and never sends back.
export function SourceRequests(pAgentUrl, pToken)
{
    if (typeof pToken !== 'string' || pToken.length < 24) throw new Error('The agent token must be set (24+ characters, the AGENT_TOKEN in APP1/agent/.env)');
    return Object.entries(SOURCES).map(([tmpKey, tmpDef]) => ({
        placeholder: tmpKey,
        body: {
            name: tmpDef.name,
            type: tmpDef.type,
            key: JSON.stringify({ url: `${pAgentUrl}${tmpDef.path}`, token: pToken, ...(tmpDef.extra || {}) }),
        },
    }));
}

// The template text with every {{placeholder}} swapped for its source id. Throws on a
// placeholder with no source, so a half-bound board is never created.
export function FillTemplate(pTemplateText, pIds)
{
    const tmpFilled = String(pTemplateText).replace(/\{\{(\w+)\}\}/g, (pMatch, pKey) =>
    {
        if (typeof pIds[pKey] !== 'string' || !pIds[pKey]) throw new Error(`template placeholder ${pMatch} has no source`);
        return pIds[pKey];
    });
    return JSON.parse(tmpFilled);
}
