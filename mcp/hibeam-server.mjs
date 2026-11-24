#!/usr/bin/env node
// ============================================================
// HiBeam MCP Server
// Exposes HiBeam dashboards and sources as MCP tools so any
// MCP-compatible AI agent (Kiro, etc.) can query and manage them.
//
// Transport: stdio (Kiro launches this as a subprocess, see
// .kiro/settings/mcp.json)
//
// Config (env vars, read from mcp/.env or the launching environment;
// real environment variables win over the file):
//   HIBEAM_BASE_URL   Base URL of your running HiBeam server.
//                     Defaults to http://localhost:8000
//   HIBEAM_USERNAME   Username or email to log in with
//   HIBEAM_PASSWORD   Password to log in with
//
// The server logs in on the first tool call and re-auths on 401, so it
// starts fine even when HiBeam isn't running yet.
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

// quiet: dotenv logs to stdout otherwise, which would corrupt the MCP stdio stream
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env'), quiet: true });

// ------------------------------------------------------------
// Config
// ------------------------------------------------------------

const _baseUrl = (process.env.HIBEAM_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
const _username = process.env.HIBEAM_USERNAME || '';
const _password = process.env.HIBEAM_PASSWORD || '';

if (!_username || !_password)
{
    process.stderr.write(
        '[hibeam-mcp] HIBEAM_USERNAME and HIBEAM_PASSWORD must be set.\n'
        + '             Copy mcp/.env.example to mcp/.env and fill them in.\n'
    );
    process.exit(1);
}

// ------------------------------------------------------------
// Session management
// ------------------------------------------------------------

let _sessionCookie = null;

async function Login()
{
    const tmpRes = await fetch(`${_baseUrl}/api/auth/login`,
    {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: _username, password: _password }),
    });

    if (!tmpRes.ok)
    {
        const tmpBody = await tmpRes.text().catch(() => '');
        throw new Error(`HiBeam login failed (${tmpRes.status}): ${tmpBody}`);
    }

    // Extract the sid cookie from Set-Cookie
    const tmpSetCookie = tmpRes.headers.get('set-cookie') || '';
    const tmpMatch = tmpSetCookie.match(/(?:^|,\s*)sid=([^;,]+)/i);
    if (!tmpMatch)
    {
        throw new Error('HiBeam login succeeded but no session cookie was returned.');
    }

    _sessionCookie = `sid=${tmpMatch[1]}`;
    process.stderr.write(`[hibeam-mcp] Logged in as ${_username}\n`);
}

// Wraps a fetch call, automatically re-logging in on 401.
async function ApiGet(pPath)
{
    if (!_sessionCookie) await Login();

    let tmpRes = await fetch(`${_baseUrl}${pPath}`,
    {
        headers: { Cookie: _sessionCookie },
    });

    if (tmpRes.status === 401)
    {
        await Login();
        tmpRes = await fetch(`${_baseUrl}${pPath}`,
        {
            headers: { Cookie: _sessionCookie },
        });
    }

    return ParseApiResponse(tmpRes, pPath);
}

async function ApiPost(pPath, pBody)
{
    if (!_sessionCookie) await Login();

    let tmpRes = await fetch(`${_baseUrl}${pPath}`,
    {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: _sessionCookie },
        body: JSON.stringify(pBody),
    });

    if (tmpRes.status === 401)
    {
        await Login();
        tmpRes = await fetch(`${_baseUrl}${pPath}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: _sessionCookie },
            body: JSON.stringify(pBody),
        });
    }

    return ParseApiResponse(tmpRes, pPath);
}

async function ApiDelete(pPath)
{
    if (!_sessionCookie) await Login();

    let tmpRes = await fetch(`${_baseUrl}${pPath}`,
    {
        method: 'DELETE',
        headers: { Cookie: _sessionCookie },
    });

    if (tmpRes.status === 401)
    {
        await Login();
        tmpRes = await fetch(`${_baseUrl}${pPath}`,
        {
            method: 'DELETE',
            headers: { Cookie: _sessionCookie },
        });
    }

    return ParseApiResponse(tmpRes, pPath);
}

async function ApiPatch(pPath, pBody)
{
    if (!_sessionCookie) await Login();

    let tmpRes = await fetch(`${_baseUrl}${pPath}`,
    {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: _sessionCookie },
        body: JSON.stringify(pBody),
    });

    if (tmpRes.status === 401)
    {
        await Login();
        tmpRes = await fetch(`${_baseUrl}${pPath}`,
        {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Cookie: _sessionCookie },
            body: JSON.stringify(pBody),
        });
    }

    return ParseApiResponse(tmpRes, pPath);
}

// Sends a raw body (e.g. file bytes) with any method, re-logging in on 401.
async function ApiSend(pMethod, pPath, pBody, pContentType)
{
    if (!_sessionCookie) await Login();

    const tmpSend = () => fetch(`${_baseUrl}${pPath}`,
    {
        method: pMethod,
        headers: { 'Content-Type': pContentType, Cookie: _sessionCookie },
        body: pBody,
    });

    let tmpRes = await tmpSend();
    if (tmpRes.status === 401)
    {
        await Login();
        tmpRes = await tmpSend();
    }

    return ParseApiResponse(tmpRes, pPath);
}

async function ParseApiResponse(pRes, pPath)
{
    let tmpBody;
    try { tmpBody = await pRes.json(); }
    catch { throw new Error(`${pPath} returned non-JSON (status ${pRes.status})`); }

    if (!pRes.ok || tmpBody.success === false)
    {
        throw new Error(tmpBody.error || `Request to ${pPath} failed with status ${pRes.status}`);
    }

    return tmpBody.data;
}

// Public route — no auth needed.
async function ApiGetPublic(pPath)
{
    const tmpRes = await fetch(`${_baseUrl}${pPath}`);
    return ParseApiResponse(tmpRes, pPath);
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function TextResult(pText)
{
    return { content: [{ type: 'text', text: String(pText) }] };
}

function JsonResult(pValue)
{
    return TextResult(JSON.stringify(pValue, null, 2));
}

function ErrorResult(pErr)
{
    return { content: [{ type: 'text', text: `Error: ${pErr.message || String(pErr)}` }], isError: true };
}

// Summarise a dashboard definition into a readable string without dumping the full JSON.
function SummariseDashboard(pDash)
{
    const tmpDef = pDash.definition || {};
    const tmpWidgets = Array.isArray(tmpDef.widgets) ? tmpDef.widgets : [];
    const tmpWidgetSummary = tmpWidgets.length === 0
        ? 'no widgets'
        : tmpWidgets.map((pW) => `${pW.type}${pW.config?.title ? ` "${pW.config.title}"` : ''}`).join(', ');

    return [
        `ID:       ${pDash.id}`,
        `Name:     ${tmpDef.name || '(unnamed)'}`,
        `Widgets:  ${tmpWidgets.length} — ${tmpWidgetSummary}`,
        `Public:   ${pDash.public ? 'yes' : 'no'}`,
        `Updated:  ${pDash.updatedAt || 'unknown'}`,
    ].join('\n');
}

function SummariseSource(pSrc)
{
    return `${pSrc.id}  [${pSrc.type}]  ${pSrc.name}`;
}

// ------------------------------------------------------------
// MCP server + tools
// ------------------------------------------------------------

const _server = new McpServer(
{
    name: 'hibeam',
    version: '1.0.0',
});

// ---- Dashboards ----

_server.tool(
    'list_dashboards',
    'List all dashboards belonging to the logged-in HiBeam user. Returns id, name, and last-updated time for each.',
    {},
    async () =>
    {
        try
        {
            const tmpDashboards = await ApiGet('/api/dashboards');
            if (!tmpDashboards.length) return TextResult('No dashboards found.');
            const tmpLines = tmpDashboards.map((pD) =>
                `${pD.id}  ${pD.name || '(unnamed)'}  (updated ${pD.updatedAt || 'unknown'})`
            );
            return TextResult(`${tmpDashboards.length} dashboard(s):\n\n${tmpLines.join('\n')}`);
        }
        catch (pErr) { return ErrorResult(pErr); }
    }
);

_server.tool(
    'get_dashboard',
    'Get the full details of a single dashboard: its name, widget list, and sharing status. Use list_dashboards first to find the id.',
    { id: z.string().describe('The dashboard id, e.g. dash_abc123') },
    async ({ id }) =>
    {
        try
        {
            const tmpDash = await ApiGet(`/api/dashboards/${encodeURIComponent(id)}`);
            return TextResult(SummariseDashboard(tmpDash));
        }
        catch (pErr) { return ErrorResult(pErr); }
    }
);

_server.tool(
    'get_dashboard_data',
    'Fetch the current live data for every widget on a dashboard. Returns the rows each widget is bound to, keyed by widget id. Use this to see what values a dashboard is actually showing right now.',
    { id: z.string().describe('The dashboard id, e.g. dash_abc123') },
    async ({ id }) =>
    {
        try
        {
            const tmpData = await ApiGet(`/api/dashboards/${encodeURIComponent(id)}/data`);
            return JsonResult(tmpData);
        }
        catch (pErr) { return ErrorResult(pErr); }
    }
);

_server.tool(
    'get_public_dashboard_data',
    'Fetch the current live data for a public dashboard without needing to be logged in. Use this when you only have a share link and no account access.',
    { id: z.string().describe('The dashboard id from the public share URL, e.g. dash_abc123') },
    async ({ id }) =>
    {
        try
        {
            const tmpData = await ApiGetPublic(`/api/public/dashboards/${encodeURIComponent(id)}/data`);
            return JsonResult(tmpData);
        }
        catch (pErr) { return ErrorResult(pErr); }
    }
);

_server.tool(
    'set_dashboard_visibility',
    'Make a dashboard public (anyone with the link can view it) or private (only the owner).',
    {
        id: z.string().describe('The dashboard id'),
        public: z.boolean().describe('true to make it public, false to make it private'),
    },
    async ({ id, public: tmpPublic }) =>
    {
        try
        {
            await ApiPatch(`/api/dashboards/${encodeURIComponent(id)}/visibility`, { public: tmpPublic });
            return TextResult(`Dashboard ${id} is now ${tmpPublic ? 'public' : 'private'}.`);
        }
        catch (pErr) { return ErrorResult(pErr); }
    }
);

_server.tool(
    'delete_dashboard',
    'Permanently delete a dashboard. This cannot be undone.',
    { id: z.string().describe('The dashboard id to delete') },
    async ({ id }) =>
    {
        try
        {
            await ApiDelete(`/api/dashboards/${encodeURIComponent(id)}`);
            return TextResult(`Dashboard ${id} deleted.`);
        }
        catch (pErr) { return ErrorResult(pErr); }
    }
);

// ---- Sources ----

_server.tool(
    'list_sources',
    'List all data sources configured by the logged-in user. Returns each source\'s id, type (rest, json, sql, scrape, logs, excel), and name.',
    {},
    async () =>
    {
        try
        {
            const tmpSources = await ApiGet('/api/sources');
            if (!tmpSources.length) return TextResult('No sources configured.');
            const tmpLines = tmpSources.map(SummariseSource);
            return TextResult(`${tmpSources.length} source(s):\n\n${tmpLines.join('\n')}`);
        }
        catch (pErr) { return ErrorResult(pErr); }
    }
);

_server.tool(
    'preview_source',
    'Fetch a live sample of rows from a data source. Returns up to 100 rows so you can see what shape the data is in.',
    { id: z.string().describe('The source id') },
    async ({ id }) =>
    {
        try
        {
            const tmpRows = await ApiGet(`/api/sources/${encodeURIComponent(id)}/preview`);
            return JsonResult(tmpRows);
        }
        catch (pErr) { return ErrorResult(pErr); }
    }
);

// ---- Writes: sources ----

const SOURCE_TYPES = ['rest', 'json', 'sql', 'scrape', 'logs', 'excel'];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

_server.tool(
    'create_source',
    'Create a data source. config is the connection settings for the type: '
    + 'rest/json { url, token?, path? }, logs { url, format: json|nginx|apache|syslog, token? }, '
    + 'scrape { url, selector }, sql { connection: "mysql://user:pass@host:3306/db", query }, excel { sheet? } '
    + '(then call upload_source_file). URLs must be publicly reachable; private and loopback addresses are refused. '
    + 'Returns the new source id.',
    {
        name: z.string().min(1).max(100).describe('Display name for the source'),
        type: z.enum(SOURCE_TYPES).describe('Source type'),
        config: z.record(z.string(), z.string()).describe('Connection settings for the type (see description)'),
    },
    async ({ name, type, config }) =>
    {
        try
        {
            const tmpCreated = await ApiPost('/api/sources', { name, type, key: JSON.stringify(config) });
            return TextResult(`Created source ${tmpCreated.id} [${type}] ${name}`);
        }
        catch (pErr) { return ErrorResult(pErr); }
    }
);

_server.tool(
    'upload_source_file',
    'Upload a local .csv or .xlsx file (max 5 MB) to an excel source.',
    {
        id: z.string().describe('The excel source id'),
        file_path: z.string().describe('Absolute path to the .csv or .xlsx file'),
    },
    async ({ id, file_path: tmpFilePath }) =>
    {
        try
        {
            const tmpExt = path.extname(tmpFilePath).toLowerCase();
            if (tmpExt !== '.csv' && tmpExt !== '.xlsx') throw new Error('Only .csv and .xlsx files can be uploaded');
            const tmpStat = await fs.stat(tmpFilePath);
            if (tmpStat.size > MAX_UPLOAD_BYTES) throw new Error('File is larger than 5 MB');
            const tmpBytes = await fs.readFile(tmpFilePath);
            const tmpResult = await ApiSend('PUT', `/api/sources/${encodeURIComponent(id)}/file`, tmpBytes, 'application/octet-stream');
            return TextResult(`Uploaded ${tmpResult.bytes} bytes to ${id}`);
        }
        catch (pErr) { return ErrorResult(pErr); }
    }
);

_server.tool(
    'test_source',
    'Test a source connection. Returns ok, or failed with a reason.',
    { id: z.string().describe('The source id') },
    async ({ id }) =>
    {
        try
        {
            const tmpResult = await ApiPost(`/api/sources/${encodeURIComponent(id)}/test`, {});
            return TextResult(tmpResult.status === 'ok' ? `Source ${id}: ok` : `Source ${id}: failed (${tmpResult.reason})`);
        }
        catch (pErr) { return ErrorResult(pErr); }
    }
);

_server.tool(
    'delete_source',
    'Permanently delete a data source. Dashboards bound to it will show an error for those widgets.',
    { id: z.string().describe('The source id to delete') },
    async ({ id }) =>
    {
        try
        {
            await ApiDelete(`/api/sources/${encodeURIComponent(id)}`);
            return TextResult(`Source ${id} deleted.`);
        }
        catch (pErr) { return ErrorResult(pErr); }
    }
);

// ---- Writes: dashboards ----

const _bindingSchema = z.object({
    sourceId: z.string(),
    xField: z.string().optional(),
    yField: z.string().optional(),
    agg: z.enum(['sum', 'avg', 'min', 'max', 'count', 'last']).optional(),
});

const _widgetSchema = z.object({
    id: z.string().describe('Unique widget id, letters/digits/_/- e.g. w_cpu'),
    type: z.enum(['line', 'bar', 'pie', 'kpi', 'table', 'text', 'label']),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(1),
    h: z.number().int().min(1),
    config: z.object({ bindings: z.array(_bindingSchema).max(6).optional() }).passthrough()
        .describe('Widget settings. Common: title, color (c1-c6), refresh (0|30|60|300|900 seconds). '
            + 'line/bar/pie: bindings [{sourceId,xField,yField,agg}]; line: smooth, fill, legend; bar: horizontal, stacked; pie: donut; '
            + 'kpi: bindings [{sourceId,yField,agg}], prefix, suffix, decimals; table: bindings [{sourceId}], columns [], limit; '
            + 'text: body, fontSize (sm|md|lg); label: text, size (sm|md|lg), align, muted'),
});

const _definitionShape = {
    name: z.string().min(1).max(120).describe('Dashboard name'),
    columns: z.union([z.literal(24), z.literal(48), z.literal(72), z.literal(96)]).optional()
        .describe('Grid columns, default 48. Widget x/w are in these units; h is in rows.'),
    show_grid: z.boolean().optional().describe('Show grid lines in the editor, default true'),
    widgets: z.array(_widgetSchema).max(200).describe('Widgets on the grid'),
};

function BuildDefinition({ name, columns, show_grid: tmpShowGrid, widgets })
{
    return { name, grid: { columns: columns || 48, showGrid: tmpShowGrid !== false }, widgets };
}

_server.tool(
    'create_dashboard',
    'Create a dashboard from a full definition. Bind widgets to sources you own (use list_sources / preview_source '
    + 'to find ids and field names). Returns the new dashboard id.',
    _definitionShape,
    async (pArgs) =>
    {
        try
        {
            const tmpDash = await ApiPost('/api/dashboards', BuildDefinition(pArgs));
            return TextResult(`Created dashboard\n\n${SummariseDashboard(tmpDash)}`);
        }
        catch (pErr) { return ErrorResult(pErr); }
    }
);

_server.tool(
    'update_dashboard',
    'Replace a dashboard\'s whole definition (name, grid and every widget). Use get_dashboard_definition first to edit an existing one.',
    { id: z.string().describe('The dashboard id'), ..._definitionShape },
    async ({ id, ...pRest }) =>
    {
        try
        {
            const tmpDash = await ApiPatch(`/api/dashboards/${encodeURIComponent(id)}`, BuildDefinition(pRest));
            return TextResult(`Updated dashboard\n\n${SummariseDashboard(tmpDash)}`);
        }
        catch (pErr) { return ErrorResult(pErr); }
    }
);

_server.tool(
    'get_dashboard_definition',
    'Get the raw JSON definition of a dashboard (grid and every widget with its config), for editing with update_dashboard.',
    { id: z.string().describe('The dashboard id') },
    async ({ id }) =>
    {
        try
        {
            const tmpDash = await ApiGet(`/api/dashboards/${encodeURIComponent(id)}`);
            return JsonResult(tmpDash.definition);
        }
        catch (pErr) { return ErrorResult(pErr); }
    }
);

// ---- Server info ----

_server.tool(
    'hibeam_status',
    'Check whether the HiBeam server is reachable and return the configured base URL.',
    {},
    async () =>
    {
        try
        {
            // The root redirects to home.html — a 200 or 302 both mean the server is up.
            const tmpRes = await fetch(`${_baseUrl}/`, { redirect: 'manual' });
            return TextResult(`HiBeam is reachable at ${_baseUrl} (HTTP ${tmpRes.status})`);
        }
        catch (pErr)
        {
            return ErrorResult(new Error(`Cannot reach HiBeam at ${_baseUrl}: ${pErr.message}`));
        }
    }
);

// ------------------------------------------------------------
// Start
// ------------------------------------------------------------

// No login here: each API call logs in lazily, so a backend that is down
// at launch doesn't stop the MCP server from connecting.
const _transport = new StdioServerTransport();
await _server.connect(_transport);
