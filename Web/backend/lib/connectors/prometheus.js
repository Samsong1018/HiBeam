'use strict';

// Prometheus HTTP API: builds /api/v1/query(_range) URLs and turns the standard response into rows.

const { HeaderNames, RowObject } = require('./values');

const MAX_QUERY_CHARS = 2000;
const MAX_SERIES = 12;
const MIN_STEP_S = 15;
const RANGES = Object.freeze({ instant: 0, '1h': 3600, '6h': 21600, '24h': 86400 });
const RANGE_NAMES = Object.keys(RANGES);
const PREFERRED_LABELS = ['instance', 'job', 'pod', 'service', 'host', 'name', 'container', 'namespace'];
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

class PromError extends Error
{
  constructor(pCode)
  {
    super(pCode);
    this.code = pCode; // 'badQuery' | 'badRange' | 'badUrl' | 'promRejected' | 'badResponse'
  }
}

// Smallest step (>= 15 s) that keeps a range query at or under pMaxRows points.
function StepFor(pRangeSeconds, pMaxRows)
{
  return Math.max(MIN_STEP_S, Math.ceil(pRangeSeconds / Math.max(1, pMaxRows - 1)));
}

// Keeps any path prefix the user gave (https://host/prometheus); a pasted /api/v1/query is dropped.
function ApiUrl(pBase, pEndpoint)
{
  let tmpUrl;
  try
  {
    tmpUrl = new URL(pBase);
  }
  catch (tmpErr)
  {
    throw new PromError('badUrl');
  }
  const tmpPath = tmpUrl.pathname.replace(/\/+$/, '').replace(/\/api\/v1\/(query|query_range)$/, '');
  tmpUrl.pathname = `${tmpPath}/api/v1/${pEndpoint}`;
  tmpUrl.hash = '';
  return tmpUrl;
}

// pConfig: { url, query, range? }. Returns the full request URL text.
function BuildPromUrl(pConfig, pNowMs, pMaxRows)
{
  const tmpBase = typeof pConfig.url === 'string' ? pConfig.url.trim() : '';
  if (!tmpBase) throw new PromError('badUrl');
  const tmpQuery = typeof pConfig.query === 'string' ? pConfig.query.trim() : '';
  if (!tmpQuery || tmpQuery.length > MAX_QUERY_CHARS) throw new PromError('badQuery');
  const tmpRangeName = typeof pConfig.range === 'string' && pConfig.range.trim() !== '' ? pConfig.range.trim() : 'instant';
  if (!Object.prototype.hasOwnProperty.call(RANGES, tmpRangeName)) throw new PromError('badRange');
  const tmpRange = RANGES[tmpRangeName];
  if (tmpRange === 0)
  {
    const tmpUrl = ApiUrl(tmpBase, 'query');
    tmpUrl.searchParams.set('query', tmpQuery);
    return tmpUrl.toString();
  }
  const tmpEnd = Math.floor(pNowMs / 1000);
  const tmpUrl = ApiUrl(tmpBase, 'query_range');
  tmpUrl.searchParams.set('query', tmpQuery);
  tmpUrl.searchParams.set('start', String(tmpEnd - tmpRange));
  tmpUrl.searchParams.set('end', String(tmpEnd));
  tmpUrl.searchParams.set('step', String(StepFor(tmpRange, pMaxRows)));
  return tmpUrl.toString();
}

// Prometheus sends sample values as strings; "NaN", "+Inf", "-Inf" become null.
function SampleNumber(pValue)
{
  const tmpNum = typeof pValue === 'number' ? pValue : Number(pValue);
  return Number.isFinite(tmpNum) ? tmpNum : null;
}

function LabelsOf(pSeries)
{
  const tmpMetric = pSeries && pSeries.metric && typeof pSeries.metric === 'object' && !Array.isArray(pSeries.metric) ? pSeries.metric : {};
  const tmpOut = {};
  for (const [tmpKey, tmpValue] of Object.entries(tmpMetric))
  {
    if (!BAD_KEYS.has(tmpKey)) tmpOut[tmpKey] = String(tmpValue);
  }
  return tmpOut;
}

function VectorRows(pResult, pMax)
{
  return pResult.slice(0, pMax).map((pSeries) =>
  {
    const tmpLabels = LabelsOf(pSeries);
    const tmpRow = {};
    const tmpKeys = Object.keys(tmpLabels).filter((pKey) => pKey !== '__name__');
    if (tmpKeys.length === 0 && tmpLabels.__name__ !== undefined) tmpRow.metric = tmpLabels.__name__;
    tmpKeys.forEach((pKey) => { tmpRow[pKey] = tmpLabels[pKey]; });
    tmpRow.value = SampleNumber(Array.isArray(pSeries.value) ? pSeries.value[1] : null);
    return tmpRow;
  });
}

// One name per series from the labels that tell them apart: a single label whose values are
// all different (instance, job, ... first), else "{k=v,k2=v2}" of every label that varies.
function SeriesNames(pLabelSets)
{
  if (pLabelSets.length === 1)
  {
    return [pLabelSets[0].__name__ || 'value'];
  }
  const tmpKeys = [...new Set(pLabelSets.flatMap((pSet) => Object.keys(pSet)))];
  const tmpVarying = tmpKeys.filter((pKey) => new Set(pLabelSets.map((pSet) => pSet[pKey])).size > 1);
  const tmpOrdered = [
    ...PREFERRED_LABELS.filter((pKey) => tmpVarying.includes(pKey)),
    ...tmpVarying.filter((pKey) => !PREFERRED_LABELS.includes(pKey)).sort()
  ];
  const tmpUnique = tmpOrdered.find((pKey) =>
    pLabelSets.every((pSet) => pSet[pKey] !== undefined) && new Set(pLabelSets.map((pSet) => pSet[pKey])).size === pLabelSets.length);
  if (tmpUnique) return pLabelSets.map((pSet) => pSet[tmpUnique]);
  if (tmpOrdered.length === 0) return pLabelSets.map((pSet) => pSet.__name__ || 'value');
  return pLabelSets.map((pSet) =>
    `{${tmpOrdered.filter((pKey) => pSet[pKey] !== undefined).map((pKey) => `${pKey}=${pSet[pKey]}`).join(',')}}`);
}

// One row per timestamp (ISO `time`), one column per series. Newest pMax timestamps are kept.
function MatrixRows(pResult, pMax)
{
  const tmpSeries = pResult.slice(0, MAX_SERIES);
  if (tmpSeries.length === 0) return [];
  const tmpNames = HeaderNames(['time', ...SeriesNames(tmpSeries.map(LabelsOf))]).slice(1);
  const tmpByTime = new Map();
  tmpSeries.forEach((pSeries, pIndex) =>
  {
    const tmpValues = Array.isArray(pSeries.values) ? pSeries.values : [];
    for (const tmpPair of tmpValues)
    {
      if (!Array.isArray(tmpPair)) continue;
      const tmpTs = Number(tmpPair[0]);
      if (!Number.isFinite(tmpTs)) continue;
      if (!tmpByTime.has(tmpTs)) tmpByTime.set(tmpTs, new Array(tmpSeries.length).fill(null));
      tmpByTime.get(tmpTs)[pIndex] = SampleNumber(tmpPair[1]);
    }
  });
  const tmpTimes = [...tmpByTime.keys()].sort((pA, pB) => pA - pB).slice(-pMax);
  return tmpTimes.map((pTs) =>
  {
    const tmpDate = new Date(pTs * 1000);
    const tmpTime = Number.isNaN(tmpDate.getTime()) ? null : tmpDate.toISOString();
    return RowObject(['time', ...tmpNames], [tmpTime, ...tmpByTime.get(pTs)]);
  });
}

// Body text of a 2xx /api/v1/query(_range) response -> rows.
function PromRows(pBody, pMax)
{
  let tmpData;
  try
  {
    tmpData = JSON.parse(pBody);
  }
  catch (tmpErr)
  {
    throw new PromError('badResponse');
  }
  if (!tmpData || typeof tmpData !== 'object') throw new PromError('badResponse');
  if (tmpData.status === 'error') throw new PromError('promRejected');
  if (tmpData.status !== 'success' || !tmpData.data || typeof tmpData.data !== 'object') throw new PromError('badResponse');
  const { resultType: tmpType, result: tmpResult } = tmpData.data;
  if (tmpType === 'scalar' || tmpType === 'string')
  {
    if (!Array.isArray(tmpResult)) throw new PromError('badResponse');
    return [{ value: tmpType === 'scalar' ? SampleNumber(tmpResult[1]) : String(tmpResult[1]) }];
  }
  if (!Array.isArray(tmpResult)) throw new PromError('badResponse');
  if (tmpType === 'vector') return VectorRows(tmpResult, pMax);
  if (tmpType === 'matrix') return MatrixRows(tmpResult, pMax);
  throw new PromError('badResponse');
}

module.exports = { BuildPromUrl, PromRows, StepFor, SeriesNames, PromError, RANGES, RANGE_NAMES, MAX_SERIES, MAX_QUERY_CHARS };
