#!/usr/bin/env node
// ============================================================
// APP2 MONTHLY IMPORT
//
//   node APP2/import/monthly-import.mjs <workbook.xlsx> --setup     first time: sources + board
//   node APP2/import/monthly-import.mjs <workbook.xlsx>             every month after
//   node APP2/import/monthly-import.mjs <workbook.xlsx> --dry-run   print the report, no network
//
// Options: --year 2026 (default: this year), --state <file> (default: APP2/import/state.json)
//
// Every sheet is uploaded and tested before the board changes, so a bad
// month never leaves the board half-updated. Talks to HiBeam only through
// its REST API: nothing in Web/ changes. Spec: .kiro/specs/app2-monthly-import/
// ============================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ReadWorkbook, CheckSheets } from './workbook.mjs';
import { SHEETS, BuildReport, ApplyReport, PdfName } from './report.mjs';
import { CreateClient } from './hibeam-client.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(HERE, '../dashboard.template.json');
const REQUIRED = Object.entries(SHEETS).filter(([, pDef]) => !pDef.optional);

const Log = (pText) => process.stdout.write(`${pText}\n`);

function ParseCli(pArgv)
{
    const { values: tmpValues, positionals: tmpPos } = parseArgs({
        args: pArgv,
        allowPositionals: true,
        options: {
            setup: { type: 'boolean', default: false },
            'dry-run': { type: 'boolean', default: false },
            year: { type: 'string' },
            state: { type: 'string', default: path.join(HERE, 'state.json') },
            help: { type: 'boolean', short: 'h', default: false },
        },
    });
    const tmpYear = tmpValues.year === undefined ? undefined : Number(tmpValues.year);
    if (tmpYear !== undefined && !(Number.isInteger(tmpYear) && tmpYear >= 1900 && tmpYear <= 2999)) throw new Error('--year must be a four-digit year');
    return { file: tmpPos[0], setup: tmpValues.setup, dryRun: tmpValues['dry-run'], year: tmpYear, state: tmpValues.state, help: tmpValues.help };
}

async function UploadAll(pClient, pFile, pSourceIds)
{
    const tmpBytes = await fs.readFile(pFile);
    for (const [tmpKey, tmpDef] of REQUIRED)
    {
        const tmpId = pSourceIds[tmpKey];
        if (!tmpId) throw new Error(`state file has no source for "${tmpDef.name}". Run --setup again.`);
        await pClient.putFile(`/api/sources/${encodeURIComponent(tmpId)}/file`, tmpBytes);
        const tmpTest = await pClient.post(`/api/sources/${encodeURIComponent(tmpId)}/test`);
        if (tmpTest?.status !== 'ok') throw new Error(`"${tmpDef.name}" failed its test after upload: ${tmpTest?.reason || 'unknown reason'}`);
        Log(`  ✓ ${tmpDef.name}`);
    }
}

async function Setup(pClient, pFile, pReport)
{
    Log('Creating one Excel source per sheet…');
    const tmpIds = {};
    for (const [tmpKey, tmpDef] of REQUIRED)
    {
        const tmpCreated = await pClient.post('/api/sources', { name: `Money · ${tmpDef.name}`, type: 'excel', key: JSON.stringify({ sheet: tmpDef.name }) });
        tmpIds[tmpKey] = tmpCreated.id;
    }
    await UploadAll(pClient, pFile, tmpIds);

    const tmpTemplate = await fs.readFile(TEMPLATE, 'utf8');
    const tmpFilled = tmpTemplate.replace(/\{\{(\w+)\}\}/g, (pMatch, pKey) =>
    {
        if (!tmpIds[pKey]) throw new Error(`template placeholder ${pMatch} has no matching sheet`);
        return tmpIds[pKey];
    });
    const { definition: tmpDef } = ApplyReport(JSON.parse(tmpFilled), pReport);
    const tmpDash = await pClient.post('/api/dashboards', tmpDef);
    return { dashboardId: tmpDash.id, sources: tmpIds };
}

async function Monthly(pClient, pFile, pReport, pState)
{
    Log('Uploading the workbook to every source…');
    await UploadAll(pClient, pFile, pState.sources);
    const tmpDash = await pClient.get(`/api/dashboards/${encodeURIComponent(pState.dashboardId)}`);
    const { definition: tmpNext, warnings: tmpWarnings } = ApplyReport(tmpDash.definition, pReport);
    tmpWarnings.forEach((pW) => Log(`  ! ${pW}`));
    await pClient.patch(`/api/dashboards/${encodeURIComponent(pState.dashboardId)}`, tmpNext);
}

async function Main()
{
    const tmpCli = ParseCli(process.argv.slice(2));
    if (tmpCli.help || !tmpCli.file)
    {
        Log('Usage: node APP2/import/monthly-import.mjs <workbook.xlsx> [--setup] [--dry-run] [--year YYYY] [--state FILE]');
        process.exitCode = tmpCli.help ? 0 : 1;
        return;
    }

    const tmpSheets = await ReadWorkbook(tmpCli.file);
    CheckSheets(tmpSheets);
    const tmpReport = BuildReport(tmpSheets, { year: tmpCli.year });
    Log(`${tmpReport.name} · ${tmpReport.month} ${tmpReport.year}`);
    Log(`Spent $${tmpReport.spentTotal.toLocaleString("en-US")} of $${tmpReport.budgetTotal.toLocaleString("en-US")} budgeted`);
    Log(`This month: ${tmpReport.caption}`);
    if (tmpCli.dryRun) return;

    const tmpClient = CreateClient();
    let tmpState;
    if (tmpCli.setup)
    {
        tmpState = await Setup(tmpClient, tmpCli.file, tmpReport);
        await fs.writeFile(tmpCli.state, `${JSON.stringify(tmpState, null, 2)}\n`);
        const tmpShown = path.relative(process.cwd(), tmpCli.state);
        Log(`Saved source and board ids to ${tmpShown.startsWith('..') ? tmpCli.state : tmpShown}`);
    }
    else
    {
        try { tmpState = JSON.parse(await fs.readFile(tmpCli.state, 'utf8')); }
        catch { throw new Error(`No state file at ${tmpCli.state}. Run once with --setup.`); }
        await Monthly(tmpClient, tmpCli.file, tmpReport, tmpState);
    }

    Log('');
    Log(`Board: ${tmpClient.baseUrl}/pages/view.html?id=${encodeURIComponent(tmpState.dashboardId)}`);
    Log(`Then Export → Export as PDF, and save it as ${PdfName(tmpReport)}`);
}

Main().catch((pErr) =>
{
    process.stderr.write(`monthly-import: ${pErr.message}\n`);
    process.exitCode = 1;
});
