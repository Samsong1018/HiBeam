// ============================================================
// HiBeam Homelab Agent: demo mode
// Made-up but believable readings for a box that doesn't exist.
// Nothing here touches the real machine: every value is a pure
// function of the clock, so the board moves on every refresh and
// two polls at the same moment agree.
//
// Log lines use only the RFC 5737 documentation ranges
// (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24), so no real
// visitor or server address can ever appear.
// ============================================================

import { FormatUptime, TimeLabel } from './collect.mjs';

const DEMO_CORES = 8;
const DEMO_MEM_MB = 32768;
const DEMO_DISK_GB = 1863;
// Pretend the box booted 13 days, 6 hours before the agent first started.
const BOOT_OFFSET_SEC = 13 * 86400 + 6 * 3600;
const LOG_STEP_SEC = 9;

// Small seeded PRNG (mulberry32): same seed, same sequence.
export function Rng(pSeed)
{
    let tmpState = pSeed >>> 0;
    return () =>
    {
        tmpState = (tmpState + 0x6d2b79f5) >>> 0;
        let tmpT = tmpState;
        tmpT = Math.imul(tmpT ^ (tmpT >>> 15), tmpT | 1);
        tmpT ^= tmpT + Math.imul(tmpT ^ (tmpT >>> 7), tmpT | 61);
        return ((tmpT ^ (tmpT >>> 14)) >>> 0) / 4294967296;
    };
}

function Clamp(pValue, pMin, pMax)
{
    return Math.min(pMax, Math.max(pMin, pValue));
}

function Round1(pValue)
{
    return Math.round(pValue * 10) / 10;
}

// One reading at second pSec. Noise is seeded by the second, so it's stable per moment.
function ReadingAt(pSec)
{
    const tmpRand = Rng(pSec * 2654435761);
    const tmpNoise = () => tmpRand() - 0.5;
    // A slow daily swell, a 20-minute "cron job" wave, and the odd spike.
    const tmpDay = Math.sin((2 * Math.PI * pSec) / 86400);
    const tmpWave = Math.sin((2 * Math.PI * pSec) / 1200);
    const tmpSpike = tmpRand() < 0.04 ? 35 * tmpRand() : 0;
    const tmpCpu = Clamp(24 + 8 * tmpDay + 11 * tmpWave + 6 * tmpNoise() + tmpSpike, 2, 99);
    const tmpMem = Clamp(61 + 4 * tmpDay + 2.5 * Math.sin((2 * Math.PI * pSec) / 5400) + tmpNoise(), 5, 97);
    // Disk creeps up about 0.3% a day and drops back weekly, like a log rotation + backup prune.
    const tmpDisk = 63.2 + 0.3 * ((pSec % (7 * 86400)) / 86400);
    const tmpLoad = Math.max(0.05, (tmpCpu / 100) * DEMO_CORES * 0.85 + 0.3 * tmpNoise());
    return { cpuPct: Round1(tmpCpu), memPct: Round1(tmpMem), diskPct: Round1(tmpDisk), load1: Math.round(tmpLoad * 100) / 100 };
}

// Same shape as the real /metrics row.
export function DemoMetrics(pNow, pStartedAt, pHostLabel)
{
    const tmpSec = Math.floor(pNow.getTime() / 1000);
    const tmpNow = ReadingAt(tmpSec);
    const tmpUptimeSec = BOOT_OFFSET_SEC + Math.max(0, (pNow.getTime() - pStartedAt.getTime()) / 1000);
    return {
        host: pHostLabel,
        cpuPct: tmpNow.cpuPct,
        cores: DEMO_CORES,
        memTotalMb: DEMO_MEM_MB,
        memUsedMb: Math.round((DEMO_MEM_MB * tmpNow.memPct) / 100),
        memPct: tmpNow.memPct,
        diskTotalGb: DEMO_DISK_GB,
        diskUsedGb: Round1((DEMO_DISK_GB * tmpNow.diskPct) / 100),
        diskPct: tmpNow.diskPct,
        load1: tmpNow.load1,
        load5: ReadingAt(tmpSec - 300).load1,
        load15: ReadingAt(tmpSec - 900).load1,
        uptimeHours: Math.round(tmpUptimeSec / 360) / 10,
        uptime: FormatUptime(tmpUptimeSec),
        sampledAt: pNow.toISOString(),
    };
}

// pSize rows ending at the latest whole sample, oldest first. Full from the first request.
export function DemoHistory(pNow, pSampleSeconds, pSize)
{
    const tmpStep = Math.max(1, pSampleSeconds);
    const tmpLast = Math.floor(pNow.getTime() / 1000 / tmpStep) * tmpStep;
    return Array.from({ length: pSize }, (pUnused, pIndex) =>
    {
        const tmpSec = tmpLast - (pSize - 1 - pIndex) * tmpStep;
        return { time: TimeLabel(new Date(tmpSec * 1000)), ...ReadingAt(tmpSec) };
    });
}

// A homelab's worth of units. A few are long dead (the graveyard), and one
// flaps: it goes down for a few minutes in every hour.
const DEMO_SERVICES = [
    { service: 'nginx', state: 'active' },
    { service: 'postgresql', state: 'active' },
    { service: 'redis-server', state: 'active' },
    { service: 'docker', state: 'active' },
    { service: 'grafana-server', state: 'active' },
    { service: 'prometheus', state: 'active' },
    { service: 'jellyfin', state: 'active' },
    { service: 'pihole-FTL', state: 'active' },
    { service: 'restic-backup', flaps: true },
    { service: 'minecraft', state: 'failed' },
    { service: 'legacy-ftp', state: 'inactive' },
    { service: 'irc-bouncer', state: 'failed' },
];

export function DemoServices(pNow)
{
    const tmpMinute = Math.floor(pNow.getTime() / 60000) % 60;
    return DEMO_SERVICES.map((pUnit) =>
    {
        const tmpState = pUnit.flaps ? (tmpMinute >= 40 && tmpMinute < 47 ? 'activating' : 'active') : pUnit.state;
        const tmpUp = tmpState === 'active';
        return { service: pUnit.service, status: tmpUp ? 'alive' : 'dead', state: tmpState, up: tmpUp ? 1 : 0 };
    }).sort((pA, pB) => pA.up - pB.up); // the dead first: it's a graveyard
}

const DOC_NETS = ['192.0.2', '198.51.100', '203.0.113'];
const PATHS = [
    ['/', 30], ['/index.html', 6], ['/blog/', 10], ['/blog/wireguard-on-a-budget', 6], ['/blog/self-hosting-mail-is-pain', 5],
    ['/projects/', 7], ['/assets/app.js', 12], ['/assets/style.css', 12], ['/favicon.ico', 8], ['/api/status', 10],
    ['/rss.xml', 5], ['/grafana/login', 3], ['/wp-login.php', 3], ['/.env', 2], ['/admin/', 2], ['/old-page', 2],
];
const AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'curl/8.5.0',
    'Uptime-Kuma/1.23.15',
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function Pick(pRand, pWeighted)
{
    const tmpTotal = pWeighted.reduce((pSum, [, pWeight]) => pSum + pWeight, 0);
    let tmpRoll = pRand() * tmpTotal;
    for (const [tmpValue, tmpWeight] of pWeighted)
    {
        tmpRoll -= tmpWeight;
        if (tmpRoll < 0) return tmpValue;
    }
    return pWeighted[pWeighted.length - 1][0];
}

function StatusFor(pPath, pRand)
{
    if (pPath === '/wp-login.php' || pPath === '/.env' || pPath === '/admin/') return pRand() < 0.85 ? 404 : 403;
    if (pPath === '/old-page') return 301;
    if (pPath.startsWith('/assets/') || pPath === '/favicon.ico') return pRand() < 0.55 ? 304 : 200;
    if (pPath === '/api/status' && pRand() < 0.06) return 502;
    return pRand() < 0.97 ? 200 : 500;
}

function NginxTime(pDate)
{
    const tmpPad = (pValue) => String(pValue).padStart(2, '0');
    return `${tmpPad(pDate.getUTCDate())}/${MONTHS[pDate.getUTCMonth()]}/${pDate.getUTCFullYear()}`
        + `:${tmpPad(pDate.getUTCHours())}:${tmpPad(pDate.getUTCMinutes())}:${tmpPad(pDate.getUTCSeconds())} +0000`;
}

// One nginx "combined" line per LOG_STEP_SEC slot. A slot's line never changes,
// so the log reads like a real tail: new lines appear, old ones scroll off.
function LogLineForSlot(pSlot)
{
    const tmpRand = Rng(pSlot * 40503 + 7);
    const tmpPath = Pick(tmpRand, PATHS);
    const tmpStatus = StatusFor(tmpPath, tmpRand);
    const tmpIp = `${DOC_NETS[Math.floor(tmpRand() * DOC_NETS.length)]}.${1 + Math.floor(tmpRand() * 254)}`;
    const tmpWhen = new Date((pSlot * LOG_STEP_SEC + Math.floor(tmpRand() * LOG_STEP_SEC)) * 1000);
    const tmpBytes = tmpStatus === 304 || tmpStatus === 301 ? 0 : 200 + Math.floor(tmpRand() * 48000);
    const tmpAgent = tmpPath === '/api/status' ? 'Uptime-Kuma/1.23.15' : AGENTS[Math.floor(tmpRand() * AGENTS.length)];
    return `${tmpIp} - - [${NginxTime(tmpWhen)}] "GET ${tmpPath} HTTP/1.1" ${tmpStatus} ${tmpBytes} "-" "${tmpAgent}"`;
}

export function DemoAccessLog(pNow, pCount)
{
    const tmpLast = Math.floor(pNow.getTime() / 1000 / LOG_STEP_SEC) - 1;
    // Newest first, like the agent's live log feed.
    const tmpLines = Array.from({ length: pCount }, (pUnused, pIndex) => LogLineForSlot(tmpLast - pIndex));
    return `${tmpLines.join('\n')}\n`;
}
