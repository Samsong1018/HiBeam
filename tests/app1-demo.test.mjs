// APP1 homelab agent: demo mode (simulated data).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Rng, DemoMetrics, DemoHistory, DemoServices, DemoAccessLog } from '../APP1/agent/simulate.mjs';

const require = createRequire(import.meta.url);
const { ParseLogs } = require('../Web/backend/lib/connectors/logs.js');

const NOW = new Date('2026-11-24T18:31:07Z');
const STARTED = new Date('2026-11-24T18:00:00Z');

test('Rng is deterministic per seed', () =>
{
    const tmpA = Rng(42);
    const tmpB = Rng(42);
    assert.deepEqual([tmpA(), tmpA(), tmpA()], [tmpB(), tmpB(), tmpB()]);
    assert.notEqual(Rng(1)(), Rng(2)());
});

test('DemoMetrics stays in believable ranges and is stable for a given moment', () =>
{
    const tmpRow = DemoMetrics(NOW, STARTED, 'crypt-01');
    assert.deepEqual(tmpRow, DemoMetrics(NOW, STARTED, 'crypt-01'));
    assert.equal(tmpRow.host, 'crypt-01');
    for (const tmpKey of ['cpuPct', 'memPct', 'diskPct']) assert.ok(tmpRow[tmpKey] > 0 && tmpRow[tmpKey] < 100, tmpKey);
    assert.ok(tmpRow.uptimeHours > 24 * 13, 'pretends to have been up for days');
});

test('DemoMetrics changes over time', () =>
{
    const tmpValues = new Set();
    for (let tmpI = 0; tmpI < 20; tmpI += 1) tmpValues.add(DemoMetrics(new Date(NOW.getTime() + tmpI * 30000), STARTED, 'x').cpuPct);
    assert.ok(tmpValues.size > 10);
});

test('DemoHistory is full immediately, oldest first, and lines up with later polls', () =>
{
    const tmpRows = DemoHistory(NOW, 30, 100);
    assert.equal(tmpRows.length, 100);
    assert.equal(tmpRows[99].time, '18:31');
    const tmpLater = DemoHistory(new Date(NOW.getTime() + 30000), 30, 100);
    assert.deepEqual(tmpLater.slice(0, 99), tmpRows.slice(1));
});

test('DemoServices has a graveyard and a service that flaps', () =>
{
    const tmpRows = DemoServices(NOW);
    assert.ok(tmpRows.some((pRow) => pRow.status === 'dead'));
    assert.ok(tmpRows.filter((pRow) => pRow.status === 'alive').length >= 8);
    const tmpBackup = (pMin) => DemoServices(new Date(`2026-11-24T18:${pMin}:00Z`)).find((pRow) => pRow.service === 'restic-backup').status;
    assert.equal(tmpBackup('30'), 'alive');
    assert.equal(tmpBackup('42'), 'dead');
});

test('DemoAccessLog parses with HiBeam\'s own nginx parser', () =>
{
    const tmpResult = ParseLogs(DemoAccessLog(NOW, 100), 'nginx', 100);
    assert.equal(tmpResult.rows.length, 100);
    const tmpCodes = new Set(tmpResult.rows.map((pRow) => pRow.status));
    assert.ok(tmpCodes.has(200) && tmpCodes.has(404), 'mix of status codes');
});

test('DemoAccessLog only ever uses documentation IP ranges', () =>
{
    for (let tmpH = 0; tmpH < 24; tmpH += 1)
    {
        const tmpText = DemoAccessLog(new Date(NOW.getTime() + tmpH * 3600000), 100);
        const tmpIps = tmpText.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g);
        for (const tmpIp of tmpIps) assert.match(tmpIp, /^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/);
    }
});

test('DemoAccessLog is newest first and scrolls: a line keeps its content as newer lines arrive', () =>
{
    const tmpNow = DemoAccessLog(NOW, 50).trim().split('\n');
    const tmpLater = DemoAccessLog(new Date(NOW.getTime() + 9000), 50).trim().split('\n');
    assert.deepEqual(tmpLater.slice(1), tmpNow.slice(0, 49));
    const tmpRows = ParseLogs(tmpNow.join('\n'), 'nginx', 50).rows;
    assert.ok(tmpRows[0].time > tmpRows[49].time);
});

test('DemoServices lists the dead first', () =>
{
    const tmpUp = DemoServices(NOW).map((pRow) => pRow.up);
    assert.deepEqual(tmpUp, [...tmpUp].sort());
});
