// APP1 homelab agent: pure collectors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CpuPercent, MemoryUsage, DiskUsage, FormatUptime, TimeLabel,
    PushCapped, MaskIp, TailLogLines, ParseServiceList, ServiceRows,
} from '../APP1/agent/collect.mjs';

const Cpu = (pIdle, pUser) => ({ times: { user: pUser, nice: 0, sys: 0, idle: pIdle, irq: 0 } });

test('CpuPercent averages busy time across cores', () =>
{
    assert.equal(CpuPercent([Cpu(0, 0), Cpu(0, 0)], [Cpu(50, 50), Cpu(100, 0)]), 25);
    assert.equal(CpuPercent([Cpu(10, 10)], [Cpu(10, 10)]), 0);
});

test('MemoryUsage prefers MemAvailable and falls back to os numbers', () =>
{
    const tmpInfo = 'MemTotal:       8192000 kB\nMemFree:  100 kB\nMemAvailable:   4096000 kB\n';
    assert.deepEqual(MemoryUsage(tmpInfo, { total: 1, free: 1 }), { memTotalMb: 8000, memUsedMb: 4000, memPct: 50 });
    assert.equal(MemoryUsage(null, { total: 1048576 * 100, free: 1048576 * 25 }).memPct, 75);
});

test('DiskUsage reports used share of user-visible space', () =>
{
    const tmpGb = 1073741824 / 4096;
    const tmpRes = DiskUsage({ bsize: 4096, blocks: 100 * tmpGb, bfree: 40 * tmpGb, bavail: 40 * tmpGb });
    assert.deepEqual(tmpRes, { diskTotalGb: 100, diskUsedGb: 60, diskPct: 60 });
});

test('FormatUptime and TimeLabel', () =>
{
    assert.equal(FormatUptime(59), '0m');
    assert.equal(FormatUptime(3 * 3600 + 120), '3h 2m');
    assert.equal(FormatUptime(2 * 86400 + 3600), '2d 1h 0m');
    assert.equal(TimeLabel(new Date('2026-11-24T09:05:00Z')), '09:05');
});

test('PushCapped keeps the newest items and does not mutate', () =>
{
    const tmpList = [1, 2, 3];
    assert.deepEqual(PushCapped(tmpList, 4, 3), [2, 3, 4]);
    assert.deepEqual(tmpList, [1, 2, 3]);
});

test('MaskIp hides the host part of v4 and v6 addresses', () =>
{
    assert.equal(MaskIp('203.0.113.77'), '203.0.113.0');
    assert.equal(MaskIp('2001:db8:85a3:8d3:1319:8a2e:370:7348'), '2001:db8:85a3::');
    assert.equal(MaskIp('-'), '-');
    // compressed forms must not shift host bits into the kept prefix
    assert.equal(MaskIp('2001:db8::1'), '2001:db8:0::');
    assert.equal(MaskIp('fe80::abcd:1'), 'fe80:0:0::');
    assert.equal(MaskIp('::ffff:203.0.113.9'), '203.0.113.0');
    // garbage that might be an address is dropped, not echoed
    assert.equal(MaskIp('203.0.113.9x'), '-');
    assert.equal(MaskIp('1:2:3:4:5:6:7:8:9'), '-');
});

test('TailLogLines keeps the last lines, newest first, with masked client addresses', () =>
{
    const tmpText = '1.2.3.4 - - [x] "GET / HTTP/1.1" 200 1\n\n5.6.7.8 - - [y] "GET /a HTTP/1.1" 404 2\n';
    assert.deepEqual(TailLogLines(tmpText, 1), ['5.6.7.0 - - [y] "GET /a HTTP/1.1" 404 2']);
    assert.deepEqual(TailLogLines(tmpText, 2).map((pLine) => pLine.slice(0, 7)), ['5.6.7.0', '1.2.3.0']);
});

test('ParseServiceList drops anything that is not a plain unit name', () =>
{
    assert.deepEqual(ParseServiceList('nginx, wg-quick@wg0 ,;rm -rf,../x,--all,docker.service'),
        ['nginx', 'wg-quick@wg0', 'docker.service']);
    assert.deepEqual(ParseServiceList(undefined), []);
});

test('ServiceRows maps systemctl states to alive/dead', () =>
{
    assert.deepEqual(ServiceRows(['a', 'b', 'c'], 'active\nfailed\n'), [
        { service: 'a', status: 'alive', state: 'active', up: 1 },
        { service: 'b', status: 'dead', state: 'failed', up: 0 },
        { service: 'c', status: 'dead', state: 'unknown', up: 0 },
    ]);
});
