#!/usr/bin/env node
// ============================================================
// HiBeam Homelab Agent
// A tiny, dependency-free HTTP server that exposes this machine's
// health as JSON (and its web server log as text) for HiBeam sources.
//
//   GET /health        no auth, for uptime checks
//   GET /metrics       one row: cpu, memory, disk, load, uptime
//   GET /history       up to HISTORY_SIZE rows, one per SAMPLE_SECONDS
//   GET /services      one row per unit in SERVICES (alive / dead)
//   GET /logs/access   last LOG_LINES lines of ACCESS_LOG, client IPs masked
//
// AGENT_MODE=demo serves simulated readings from simulate.mjs instead, so a
// public board can run without exposing anything about the real host.
//
// Everything except /health needs `Authorization: Bearer <AGENT_TOKEN>`.
// Binds to 127.0.0.1 by default: put nginx (TLS) in front of it.
// Config lives in APP1/agent/.env (see .env.example).
// ============================================================

import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    CpuPercent, MemoryUsage, DiskUsage, FormatUptime, TimeLabel,
    PushCapped, TailLogLines, ParseServiceList, ServiceRows,
} from './collect.mjs';
import { DemoMetrics, DemoHistory, DemoServices, DemoAccessLog } from './simulate.mjs';

const _here = path.dirname(fileURLToPath(import.meta.url));
LoadEnvFile(path.join(_here, '.env'));

const _demo = (process.env.AGENT_MODE || 'live').toLowerCase() === 'demo';

const _config = {
    host: process.env.AGENT_HOST || '127.0.0.1',
    port: Number(process.env.AGENT_PORT) || 9480,
    token: process.env.AGENT_TOKEN || '',
    sampleSeconds: Math.max(5, Number(process.env.SAMPLE_SECONDS) || 30),
    historySize: Math.min(100, Math.max(1, Number(process.env.HISTORY_SIZE) || 100)),
    diskPath: process.env.DISK_PATH || '/',
    accessLog: process.env.ACCESS_LOG || '',
    logLines: Math.min(100, Math.max(1, Number(process.env.LOG_LINES) || 100)),
    services: ParseServiceList(process.env.SERVICES || ''),
    // Demo mode never falls back to the real hostname.
    hostLabel: process.env.HOST_LABEL || (_demo ? 'crypt-01' : os.hostname()),
};

if (_config.token.length < 24)
{
    process.stderr.write('[agent] AGENT_TOKEN must be set (24+ characters). Generate one with: openssl rand -hex 24\n');
    process.exit(1);
}

const LOG_READ_BYTES = 256 * 1024;

// ------------------------------------------------------------
// Sampling
// ------------------------------------------------------------

let _lastCpus = os.cpus();
let _latest = null;
let _history = [];

async function TakeSample()
{
    const tmpCpus = os.cpus();
    const tmpCpu = CpuPercent(_lastCpus, tmpCpus);
    _lastCpus = tmpCpus;

    const tmpMeminfo = await fs.readFile('/proc/meminfo', 'utf8').catch(() => null);
    const tmpMem = MemoryUsage(tmpMeminfo, { total: os.totalmem(), free: os.freemem() });
    const tmpDisk = await fs.statfs(_config.diskPath).then(DiskUsage).catch(() => ({ diskTotalGb: 0, diskUsedGb: 0, diskPct: 0 }));
    const [tmpLoad1, tmpLoad5, tmpLoad15] = os.loadavg();
    const tmpNow = new Date();

    _latest = {
        host: _config.hostLabel,
        cpuPct: tmpCpu,
        cores: tmpCpus.length,
        ...tmpMem,
        ...tmpDisk,
        load1: Math.round(tmpLoad1 * 100) / 100,
        load5: Math.round(tmpLoad5 * 100) / 100,
        load15: Math.round(tmpLoad15 * 100) / 100,
        uptimeHours: Math.round(os.uptime() / 360) / 10,
        uptime: FormatUptime(os.uptime()),
        sampledAt: tmpNow.toISOString(),
    };
    _history = PushCapped(_history, {
        time: TimeLabel(tmpNow),
        cpuPct: _latest.cpuPct,
        memPct: _latest.memPct,
        diskPct: _latest.diskPct,
        load1: _latest.load1,
    }, _config.historySize);
}

function StartSampling()
{
    const tmpRun = () => TakeSample().catch((pErr) => process.stderr.write(`[agent] sample failed: ${pErr.message}\n`));
    // First reading after 1s so the CPU delta covers a real interval.
    setTimeout(tmpRun, 1000);
    setInterval(tmpRun, _config.sampleSeconds * 1000).unref();
}

// ------------------------------------------------------------
// Readers
// ------------------------------------------------------------

function ReadServices()
{
    if (_config.services.length === 0) return Promise.resolve([]);
    return new Promise((pResolve) =>
    {
        // is-active exits non-zero when any unit is down; stdout still has one line per unit.
        execFile('systemctl', ['is-active', '--', ..._config.services], { timeout: 5000 }, (pErr, pStdout) =>
        {
            pResolve(ServiceRows(_config.services, pStdout));
        });
    });
}

async function ReadAccessLog()
{
    if (!_config.accessLog) return null;
    const tmpHandle = await fs.open(_config.accessLog, 'r');
    try
    {
        const { size: tmpSize } = await tmpHandle.stat();
        const tmpStart = Math.max(0, tmpSize - LOG_READ_BYTES);
        const tmpBuf = Buffer.alloc(tmpSize - tmpStart);
        await tmpHandle.read(tmpBuf, 0, tmpBuf.length, tmpStart);
        let tmpText = tmpBuf.toString('utf8');
        // Drop the partial first line when we started mid-file.
        if (tmpStart > 0) tmpText = tmpText.slice(tmpText.indexOf('\n') + 1);
        return TailLogLines(tmpText, _config.logLines).join('\n') + '\n';
    }
    finally
    {
        await tmpHandle.close();
    }
}

// ------------------------------------------------------------
// HTTP
// ------------------------------------------------------------

function TokenMatches(pHeader)
{
    const tmpMatch = /^Bearer\s+(.+)$/i.exec(pHeader || '');
    if (!tmpMatch) return false;
    const tmpGot = crypto.createHash('sha256').update(tmpMatch[1].trim()).digest();
    const tmpWant = crypto.createHash('sha256').update(_config.token).digest();
    return crypto.timingSafeEqual(tmpGot, tmpWant);
}

function Send(pRes, pStatus, pBody, pType)
{
    const tmpBody = typeof pBody === 'string' ? pBody : JSON.stringify(pBody);
    pRes.writeHead(pStatus, {
        'Content-Type': pType || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    pRes.end(tmpBody);
}

const _startedAt = new Date();

// Demo mode: invented readings only. Nothing from this machine is read or served.
const DEMO_ROUTES = {
    '/metrics': async () => ({ body: [DemoMetrics(new Date(), _startedAt, _config.hostLabel)] }),
    '/history': async () => ({ body: DemoHistory(new Date(), _config.sampleSeconds, _config.historySize) }),
    '/services': async () => ({ body: DemoServices(new Date()) }),
    '/logs/access': async () => ({ body: DemoAccessLog(new Date(), _config.logLines), type: 'text/plain; charset=utf-8' }),
};

const LIVE_ROUTES = {
    '/metrics': async () => ({ body: _latest ? [_latest] : [] }),
    '/history': async () => ({ body: _history }),
    '/services': async () => ({ body: await ReadServices() }),
    '/logs/access': async () =>
    {
        const tmpText = await ReadAccessLog();
        if (tmpText == null) return { status: 404, body: { error: 'ACCESS_LOG is not configured' } };
        return { body: tmpText, type: 'text/plain; charset=utf-8' };
    },
};

async function HandleRequest(pReq, pRes)
{
    const tmpPath = new URL(pReq.url, 'http://agent').pathname.replace(/\/+$/, '') || '/';
    if (pReq.method !== 'GET') return Send(pRes, 405, { error: 'Method not allowed' });
    if (tmpPath === '/health') return Send(pRes, 200, { ok: true });

    const tmpRoute = (_demo ? DEMO_ROUTES : LIVE_ROUTES)[tmpPath];
    if (!tmpRoute) return Send(pRes, 404, { error: 'Not found' });
    if (!TokenMatches(pReq.headers.authorization)) return Send(pRes, 401, { error: 'Unauthorized' });

    try
    {
        const tmpResult = await tmpRoute();
        return Send(pRes, tmpResult.status || 200, tmpResult.body, tmpResult.type);
    }
    catch (pErr)
    {
        process.stderr.write(`[agent] ${tmpPath} failed: ${pErr.message}\n`);
        return Send(pRes, 500, { error: 'Could not read that metric' });
    }
}

// Minimal KEY=value loader; real environment variables win.
function LoadEnvFile(pFile)
{
    let tmpText;
    try { tmpText = readFileSync(pFile, 'utf8'); }
    catch { return; }
    for (const tmpLine of tmpText.split('\n'))
    {
        const tmpMatch = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(tmpLine);
        if (!tmpMatch) continue;
        const tmpValue = tmpMatch[2].replace(/^(['"])(.*)\1$/, '$2');
        if (process.env[tmpMatch[1]] === undefined) process.env[tmpMatch[1]] = tmpValue;
    }
}

if (!_demo) StartSampling();
http.createServer((pReq, pRes) => { HandleRequest(pReq, pRes); })
    .listen(_config.port, _config.host, () =>
    {
        process.stderr.write(_demo
            ? `[agent] DEMO MODE: serving simulated data on http://${_config.host}:${_config.port}\n`
            : `[agent] listening on http://${_config.host}:${_config.port} (${_config.services.length} services, log: ${_config.accessLog ? 'on' : 'off'})\n`);
    });
