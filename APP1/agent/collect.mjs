// ============================================================
// HiBeam Homelab Agent: collectors
// Pure functions that turn raw system readings into the rows the
// agent serves. No I/O here, so tests/app1-agent.test.mjs can cover
// every one of them without a real machine.
// ============================================================

// CPU busy % between two os.cpus() snapshots, averaged over all cores.
export function CpuPercent(pPrev, pNext)
{
    let tmpIdle = 0;
    let tmpTotal = 0;
    const tmpCount = Math.min(pPrev.length, pNext.length);
    for (let tmpI = 0; tmpI < tmpCount; tmpI += 1)
    {
        const tmpA = pPrev[tmpI].times;
        const tmpB = pNext[tmpI].times;
        const tmpSumA = tmpA.user + tmpA.nice + tmpA.sys + tmpA.idle + tmpA.irq;
        const tmpSumB = tmpB.user + tmpB.nice + tmpB.sys + tmpB.idle + tmpB.irq;
        tmpIdle += Math.max(0, tmpB.idle - tmpA.idle);
        tmpTotal += Math.max(0, tmpSumB - tmpSumA);
    }
    if (tmpTotal === 0) return 0;
    return Round1(100 * (1 - tmpIdle / tmpTotal));
}

// Reads MemTotal / MemAvailable out of /proc/meminfo text.
// Falls back to pFallback ({ total, free } in bytes) when the file is missing (macOS, etc).
export function MemoryUsage(pMeminfo, pFallback)
{
    const tmpTotalKb = ReadMeminfoKb(pMeminfo, 'MemTotal');
    const tmpAvailKb = ReadMeminfoKb(pMeminfo, 'MemAvailable');
    let tmpTotalMb;
    let tmpUsedMb;
    if (tmpTotalKb != null && tmpAvailKb != null)
    {
        tmpTotalMb = tmpTotalKb / 1024;
        tmpUsedMb = (tmpTotalKb - tmpAvailKb) / 1024;
    }
    else
    {
        tmpTotalMb = pFallback.total / 1048576;
        tmpUsedMb = (pFallback.total - pFallback.free) / 1048576;
    }
    return {
        memTotalMb: Math.round(tmpTotalMb),
        memUsedMb: Math.round(tmpUsedMb),
        memPct: tmpTotalMb > 0 ? Round1((100 * tmpUsedMb) / tmpTotalMb) : 0,
    };
}

function ReadMeminfoKb(pText, pKey)
{
    if (typeof pText !== 'string') return null;
    const tmpMatch = pText.match(new RegExp(`^${pKey}:\\s+(\\d+)\\s*kB`, 'm'));
    return tmpMatch ? Number(tmpMatch[1]) : null;
}

// Disk usage from an fs.statfs() result.
export function DiskUsage(pStat)
{
    const tmpTotal = pStat.blocks * pStat.bsize;
    const tmpFree = pStat.bavail * pStat.bsize;
    const tmpUsed = tmpTotal - pStat.bfree * pStat.bsize;
    return {
        diskTotalGb: Round1(tmpTotal / 1073741824),
        diskUsedGb: Round1(tmpUsed / 1073741824),
        diskPct: tmpTotal > 0 ? Round1((100 * tmpUsed) / (tmpUsed + tmpFree)) : 0,
    };
}

// "3d 4h 12m" from seconds.
export function FormatUptime(pSeconds)
{
    const tmpSec = Math.max(0, Math.floor(pSeconds));
    const tmpDays = Math.floor(tmpSec / 86400);
    const tmpHours = Math.floor((tmpSec % 86400) / 3600);
    const tmpMins = Math.floor((tmpSec % 3600) / 60);
    if (tmpDays > 0) return `${tmpDays}d ${tmpHours}h ${tmpMins}m`;
    if (tmpHours > 0) return `${tmpHours}h ${tmpMins}m`;
    return `${tmpMins}m`;
}

// "HH:MM" in UTC, so every viewer sees the same labels.
export function TimeLabel(pDate)
{
    return pDate.toISOString().slice(11, 16);
}

// Returns a new array with pItem appended, keeping at most pMax items.
export function PushCapped(pList, pItem, pMax)
{
    const tmpNext = [...pList, pItem];
    return tmpNext.length > pMax ? tmpNext.slice(tmpNext.length - pMax) : tmpNext;
}

// Zeroes the last part of an IPv4 address or the last 80 bits of an IPv6 one,
// so a public log feed never publishes full visitor addresses.
export function MaskIp(pIp)
{
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(pIp)) return pIp.replace(/\.\d{1,3}$/, '.0');
    if (pIp.includes(':'))
    {
        // IPv4-mapped (::ffff:1.2.3.4): mask it as the IPv4 address it is.
        const tmpMapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(pIp);
        if (tmpMapped) return MaskIp(tmpMapped[1]);
        const tmpGroups = ExpandIPv6(pIp);
        // Anything unparseable is dropped rather than risk publishing it.
        if (!tmpGroups) return '-';
        return `${tmpGroups.slice(0, 3).join(':')}::`;
    }
    return /^[\w.-]{1,64}$/.test(pIp) && !/\d/.test(pIp) ? pIp : '-';
}

// "2001:db8::1" -> ['2001','db8','0','0','0','0','0','1'], or null if it isn't plain IPv6.
function ExpandIPv6(pIp)
{
    const tmpHalves = pIp.toLowerCase().split('::');
    if (tmpHalves.length > 2) return null;
    const tmpSplit = (pPart) => (pPart === '' ? [] : pPart.split(':'));
    const tmpHead = tmpSplit(tmpHalves[0]);
    const tmpTail = tmpHalves.length === 2 ? tmpSplit(tmpHalves[1]) : [];
    const tmpFill = 8 - tmpHead.length - tmpTail.length;
    if (tmpHalves.length === 2 ? tmpFill < 1 : tmpFill !== 0) return null;
    const tmpGroups = [...tmpHead, ...new Array(tmpFill).fill('0'), ...tmpTail];
    if (!tmpGroups.every((pGroup) => /^[0-9a-f]{1,4}$/.test(pGroup))) return null;
    return tmpGroups.map((pGroup) => pGroup.replace(/^0+(?=.)/, ''));
}

// Last pCount non-empty lines of pText, newest first, with the leading client
// address masked (nginx / apache combined logs start with it).
export function TailLogLines(pText, pCount)
{
    const tmpLines = pText.split('\n').filter((pLine) => pLine.trim() !== '');
    return tmpLines.slice(-pCount).reverse().map((pLine) =>
    {
        const tmpSpace = pLine.indexOf(' ');
        if (tmpSpace <= 0) return pLine;
        return MaskIp(pLine.slice(0, tmpSpace)) + pLine.slice(tmpSpace);
    });
}

// systemd unit names only: no paths, no options, no shell characters.
const UNIT_RE = /^[A-Za-z0-9@_][A-Za-z0-9@._-]{0,99}$/;

export function ParseServiceList(pText)
{
    if (typeof pText !== 'string') return [];
    return pText.split(',').map((pName) => pName.trim()).filter((pName) => UNIT_RE.test(pName));
}

// Zips unit names with `systemctl is-active` output lines.
export function ServiceRows(pNames, pOutput)
{
    const tmpStates = String(pOutput || '').split('\n').map((pLine) => pLine.trim());
    return pNames.map((pName, pIndex) =>
    {
        const tmpState = tmpStates[pIndex] || 'unknown';
        const tmpUp = tmpState === 'active';
        return { service: pName, status: tmpUp ? 'alive' : 'dead', state: tmpState, up: tmpUp ? 1 : 0 };
    });
}

function Round1(pValue)
{
    return Math.round(pValue * 10) / 10;
}
