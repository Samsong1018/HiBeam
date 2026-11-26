#!/usr/bin/env node
// ============================================================
// APP1 SETUP: one command from a running agent to a live board.
//
//   node APP1/setup/setup.mjs --agent https://your-domain.example/hibeam-agent [--public]
//
// Creates the four sources (metrics, history, services, access log),
// tests each one, builds the board from APP1/dashboard.template.json,
// and prints its link. --public also turns it into a public status page.
//
// HiBeam login: HIBEAM_BASE_URL / HIBEAM_USERNAME / HIBEAM_PASSWORD, or
// mcp/.env (the same account the MCP server uses).
// Agent token: AGENT_TOKEN, or APP1/agent/.env. Never pass it as an
// argument, so it stays out of your shell history.
//
// Talks to HiBeam only through its REST API: nothing in Web/ changes.
// ============================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import { CreateClient } from './hibeam-client.mjs';
import { NormaliseAgentUrl, SourceRequests, FillTemplate } from './plan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(HERE, '../dashboard.template.json');
const USAGE = 'Usage: node APP1/setup/setup.mjs --agent https://your-domain.example/hibeam-agent [--public]';

const Log = (pText) => process.stdout.write(`${pText}\n`);

function ParseCli(pArgv)
{
    const { values: tmpValues } = parseArgs({
        args: pArgv,
        options: {
            agent: { type: 'string' },
            public: { type: 'boolean', default: false },
            help: { type: 'boolean', short: 'h', default: false },
        },
    });
    return tmpValues;
}

async function CreateSources(pClient, pRequests)
{
    const tmpIds = {};
    for (const tmpReq of pRequests)
    {
        const tmpCreated = await pClient.post('/api/sources', tmpReq.body);
        tmpIds[tmpReq.placeholder] = tmpCreated.id;
        Log(`  created ${tmpReq.body.name}`);
    }
    return tmpIds;
}

// Tests every source before the board is made. A failure names the source and stops.
async function TestSources(pClient, pRequests, pIds)
{
    for (const tmpReq of pRequests)
    {
        try { await pClient.post(`/api/sources/${encodeURIComponent(pIds[tmpReq.placeholder])}/test`); }
        catch (pErr)
        {
            throw new Error(`${tmpReq.body.name} didn't answer (${pErr.message}). Check the agent URL, the token, and that the agent is reachable from the internet.`);
        }
        Log(`  ok ${tmpReq.body.name}`);
    }
}

async function Main()
{
    const tmpCli = ParseCli(process.argv.slice(2));
    if (tmpCli.help || !tmpCli.agent)
    {
        Log(USAGE);
        process.exitCode = tmpCli.help ? 0 : 1;
        return;
    }
    dotenv.config({ path: path.join(HERE, '../agent/.env'), quiet: true });
    const tmpAgent = NormaliseAgentUrl(tmpCli.agent);
    const tmpRequests = SourceRequests(tmpAgent, process.env.AGENT_TOKEN || '');
    const tmpClient = CreateClient();

    Log(`Creating the four sources for ${tmpAgent}…`);
    const tmpIds = await CreateSources(tmpClient, tmpRequests);
    Log('Testing them…');
    try { await TestSources(tmpClient, tmpRequests, tmpIds); }
    catch (pErr)
    {
        // don't leave four half-working sources behind for the next attempt to trip over
        await Promise.allSettled(Object.values(tmpIds).map((pId) => tmpClient.del(`/api/sources/${encodeURIComponent(pId)}`)));
        throw pErr;
    }

    Log('Building the board from APP1/dashboard.template.json…');
    const tmpDef = FillTemplate(await fs.readFile(TEMPLATE, 'utf8'), tmpIds);
    const tmpDash = await tmpClient.post('/api/dashboards', tmpDef);
    if (tmpCli.public)
    {
        await tmpClient.patch(`/api/dashboards/${encodeURIComponent(tmpDash.id)}/visibility`, { public: true });
    }

    Log('');
    Log(`Done. ${tmpCli.public ? 'Public status page' : 'Your board'}: ${tmpClient.baseUrl}/view/${encodeURIComponent(tmpDash.id)}`);
    if (!tmpCli.public) Log('Run again with --public, or use Share on the board, to make it a status page.');
}

Main().catch((pErr) =>
{
    process.stderr.write(`APP1 setup failed: ${pErr.message}\n`);
    process.exitCode = 1;
});
