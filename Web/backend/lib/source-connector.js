'use strict';

const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const { decryptKey } = require('./crypto-box');

const TIMEOUT_MS = 10000;
const MAX_ROWS = 100;
const MAX_BYTES = 2 * 1024 * 1024;
const IMPLEMENTED_TYPES = ['rest', 'json'];

// Fixed reason set. Upstream text, keys, and URLs are never echoed.
const REASONS = Object.freeze({
  unreachable: 'Source unreachable',
  timeout: 'Connection timed out',
  unsupported: 'Source type is not supported yet',
  blockedUrl: 'Source URL is not allowed',
  badUrl: 'Source URL is invalid',
  badKey: 'Source credentials could not be read',
  rejected: 'Source rejected the credentials',
  upstreamError: 'Source returned an error',
  badResponse: 'Source returned an unexpected response'
});

class SourceError extends Error
{
  constructor(pReason)
  {
    super(pReason);
    this.name = 'SourceError';
    this.reason = pReason;
  }
}

// ---------------------------------------------------------------- IP checks

function ParseIPv4(pText)
{
  const tmpParts = pText.split('.');
  if (tmpParts.length !== 4) return null;
  const tmpBytes = [];
  for (const tmpPart of tmpParts)
  {
    if (!/^\d{1,3}$/.test(tmpPart)) return null;
    const tmpNum = Number(tmpPart);
    if (tmpNum > 255) return null;
    tmpBytes.push(tmpNum);
  }
  return tmpBytes;
}

function ParseIPv6(pText)
{
  let tmpText = pText;
  if (tmpText.includes('%')) return null;
  // Trailing dotted IPv4 (e.g. ::ffff:127.0.0.1)
  const tmpLastColon = tmpText.lastIndexOf(':');
  const tmpTail = tmpText.slice(tmpLastColon + 1);
  if (tmpTail.includes('.'))
  {
    const tmpV4 = ParseIPv4(tmpTail);
    if (!tmpV4) return null;
    const tmpHi = ((tmpV4[0] << 8) | tmpV4[1]).toString(16);
    const tmpLo = ((tmpV4[2] << 8) | tmpV4[3]).toString(16);
    tmpText = `${tmpText.slice(0, tmpLastColon + 1)}${tmpHi}:${tmpLo}`;
  }
  const tmpHalves = tmpText.split('::');
  if (tmpHalves.length > 2) return null;
  const tmpSplit = (pPart) => (pPart === '' ? [] : pPart.split(':'));
  const tmpHead = tmpSplit(tmpHalves[0]);
  const tmpRest = tmpHalves.length === 2 ? tmpSplit(tmpHalves[1]) : [];
  let tmpGroups;
  if (tmpHalves.length === 2)
  {
    const tmpFill = 8 - tmpHead.length - tmpRest.length;
    if (tmpFill < 1) return null;
    tmpGroups = [...tmpHead, ...new Array(tmpFill).fill('0'), ...tmpRest];
  }
  else
  {
    tmpGroups = tmpHead;
  }
  if (tmpGroups.length !== 8) return null;
  const tmpBytes = [];
  for (const tmpGroup of tmpGroups)
  {
    if (!/^[0-9a-fA-F]{1,4}$/.test(tmpGroup)) return null;
    const tmpNum = parseInt(tmpGroup, 16);
    tmpBytes.push(tmpNum >> 8, tmpNum & 255);
  }
  return tmpBytes;
}

function IsBlockedIPv4(pBytes)
{
  const [tmpA, tmpB, tmpC] = pBytes;
  if (tmpA === 0) return true;                                  // 0.0.0.0/8
  if (tmpA === 10) return true;                                 // private
  if (tmpA === 100 && tmpB >= 64 && tmpB <= 127) return true;   // CGNAT
  if (tmpA === 127) return true;                                // loopback
  if (tmpA === 169 && tmpB === 254) return true;                // link-local
  if (tmpA === 172 && tmpB >= 16 && tmpB <= 31) return true;    // private
  if (tmpA === 192 && tmpB === 0 && tmpC === 0) return true;    // IETF protocol
  if (tmpA === 192 && tmpB === 168) return true;                // private
  if (tmpA === 198 && (tmpB === 18 || tmpB === 19)) return true; // benchmarking
  if (tmpA >= 224) return true;                                 // multicast, reserved, broadcast
  return false;
}

function IsBlockedIPv6(pBytes)
{
  const tmpZero = (pFrom, pTo) => pBytes.slice(pFrom, pTo).every((pB) => pB === 0);
  const tmpEmbedded = (pOffset) => IsBlockedIPv4(pBytes.slice(pOffset, pOffset + 4));
  if (tmpZero(0, 15) && pBytes[15] <= 1) return true;          // :: and ::1
  if (tmpZero(0, 10) && pBytes[10] === 255 && pBytes[11] === 255) return tmpEmbedded(12); // ::ffff:a.b.c.d
  if (tmpZero(0, 12)) return tmpEmbedded(12);                   // IPv4-compatible ::a.b.c.d
  if (tmpZero(0, 8) && pBytes[8] === 255 && pBytes[9] === 255 && tmpZero(10, 12)) return tmpEmbedded(12); // ::ffff:0:a.b.c.d
  if (pBytes[0] === 0x00 && pBytes[1] === 0x64 && pBytes[2] === 0xff && pBytes[3] === 0x9b && tmpZero(4, 12)) return tmpEmbedded(12); // NAT64
  if (pBytes[0] === 0x20 && pBytes[1] === 0x02) return tmpEmbedded(2); // 6to4
  if (pBytes[0] === 0xfe && (pBytes[1] & 0xc0) === 0x80) return true;  // fe80::/10 link-local
  if (pBytes[0] === 0xfe && (pBytes[1] & 0xc0) === 0xc0) return true;  // fec0::/10 site-local
  if ((pBytes[0] & 0xfe) === 0xfc) return true;                 // fc00::/7 unique local
  if (pBytes[0] === 0xff) return true;                          // multicast
  return false;
}

// True when the address must not be contacted. Unparseable input is blocked.
function IsBlockedAddress(pAddress)
{
  const tmpText = String(pAddress).replace(/^\[|\]$/g, '');
  const tmpKind = net.isIP(tmpText);
  if (tmpKind === 4) return IsBlockedIPv4(ParseIPv4(tmpText) || [0, 0, 0, 0]);
  if (tmpKind === 6)
  {
    const tmpBytes = ParseIPv6(tmpText);
    return tmpBytes ? IsBlockedIPv6(tmpBytes) : true;
  }
  return true;
}

// ------------------------------------------------------------ URL + resolve

function ParseSourceUrl(pText)
{
  let tmpUrl;
  try
  {
    tmpUrl = new URL(pText);
  }
  catch (tmpErr)
  {
    throw new SourceError(REASONS.badUrl);
  }
  if (tmpUrl.protocol !== 'http:' && tmpUrl.protocol !== 'https:') throw new SourceError(REASONS.blockedUrl);
  if (tmpUrl.username || tmpUrl.password) throw new SourceError(REASONS.blockedUrl);
  return tmpUrl;
}

async function DefaultResolve(pHostname)
{
  const tmpList = await dns.promises.lookup(pHostname, { all: true });
  return tmpList.map((pEntry) => pEntry.address);
}

// Returns the address to connect to after validating every resolved address.
async function ResolveSafeAddress(pUrl, pResolve)
{
  const tmpHost = pUrl.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(tmpHost))
  {
    if (IsBlockedAddress(tmpHost)) throw new SourceError(REASONS.blockedUrl);
    return tmpHost;
  }
  let tmpAddresses;
  try
  {
    tmpAddresses = await pResolve(tmpHost);
  }
  catch (tmpErr)
  {
    throw new SourceError(REASONS.unreachable);
  }
  if (!Array.isArray(tmpAddresses) || tmpAddresses.length === 0) throw new SourceError(REASONS.unreachable);
  if (tmpAddresses.some((pAddr) => IsBlockedAddress(pAddr))) throw new SourceError(REASONS.blockedUrl);
  return tmpAddresses[0];
}

// ---------------------------------------------------------------- transport

// Default transport: GET with no redirects, connection pinned to the vetted address.
function DefaultTransport(pReq)
{
  return new Promise((pResolve, pReject) =>
  {
    const tmpUrl = new URL(pReq.url);
    const tmpLib = tmpUrl.protocol === 'https:' ? https : http;
    const tmpFamily = net.isIP(pReq.address);
    const tmpLookup = (pHost, pOpts, pCb) =>
    {
      if (pOpts && pOpts.all) return pCb(null, [{ address: pReq.address, family: tmpFamily }]);
      return pCb(null, pReq.address, tmpFamily);
    };
    const tmpRequest = tmpLib.request(tmpUrl, {
      method: 'GET',
      headers: pReq.headers,
      lookup: tmpLookup,
      signal: pReq.signal
    }, (pRes) =>
    {
      const tmpChunks = [];
      let tmpSize = 0;
      pRes.on('data', (pChunk) =>
      {
        tmpSize += pChunk.length;
        if (tmpSize > MAX_BYTES)
        {
          pRes.destroy();
          pReject(new Error('too large'));
          return;
        }
        tmpChunks.push(pChunk);
      });
      pRes.on('end', () => pResolve({ status: pRes.statusCode, body: Buffer.concat(tmpChunks).toString('utf8') }));
      pRes.on('error', pReject);
    });
    tmpRequest.on('error', pReject);
    tmpRequest.end();
  });
}

// ------------------------------------------------------------------- fetch

// The decrypted key is either a plain URL, or a JSON object:
// { "url": "...", "token": "...", "queryParam": "..." }
// token is sent as a bearer token, or as the value of queryParam when given.
function ReadConfig(pSource, pDecrypt)
{
  let tmpPlain;
  try
  {
    tmpPlain = pDecrypt(pSource.key_enc);
  }
  catch (tmpErr)
  {
    throw new SourceError(REASONS.badKey);
  }
  const tmpTrim = String(tmpPlain).trim();
  if (tmpTrim.startsWith('{'))
  {
    let tmpObj;
    try
    {
      tmpObj = JSON.parse(tmpTrim);
    }
    catch (tmpErr)
    {
      throw new SourceError(REASONS.badKey);
    }
    if (!tmpObj || typeof tmpObj.url !== 'string') throw new SourceError(REASONS.badKey);
    return {
      url: tmpObj.url,
      token: typeof tmpObj.token === 'string' ? tmpObj.token : null,
      queryParam: typeof tmpObj.queryParam === 'string' && tmpObj.queryParam ? tmpObj.queryParam : null
    };
  }
  return { url: tmpTrim, token: null, queryParam: null };
}

async function FetchBody(pSource, pOpts, pSignal)
{
  if (!pSource || !IMPLEMENTED_TYPES.includes(pSource.type)) throw new SourceError(REASONS.unsupported);
  const tmpConfig = ReadConfig(pSource, pOpts.decrypt);
  const tmpUrl = ParseSourceUrl(tmpConfig.url);
  const tmpHeaders = { Accept: 'application/json', 'User-Agent': 'dashboard-source-connector' };
  if (tmpConfig.token)
  {
    if (tmpConfig.queryParam) tmpUrl.searchParams.set(tmpConfig.queryParam, tmpConfig.token);
    else tmpHeaders.Authorization = `Bearer ${tmpConfig.token}`;
  }
  const tmpAddress = await ResolveSafeAddress(tmpUrl, pOpts.resolve);
  let tmpRes;
  try
  {
    tmpRes = await pOpts.transport({ url: tmpUrl.toString(), address: tmpAddress, headers: tmpHeaders, signal: pSignal });
  }
  catch (tmpErr)
  {
    throw new SourceError(REASONS.unreachable);
  }
  const tmpStatus = tmpRes && tmpRes.status;
  if (tmpStatus === 401 || tmpStatus === 403) throw new SourceError(REASONS.rejected);
  if (!Number.isInteger(tmpStatus) || tmpStatus < 200 || tmpStatus >= 300) throw new SourceError(REASONS.upstreamError);
  let tmpData;
  try
  {
    tmpData = JSON.parse(tmpRes.body);
  }
  catch (tmpErr)
  {
    throw new SourceError(REASONS.badResponse);
  }
  return tmpData;
}

function ToRows(pData)
{
  let tmpList = null;
  if (Array.isArray(pData)) tmpList = pData;
  else if (pData && typeof pData === 'object')
  {
    for (const tmpName of ['data', 'rows', 'items', 'results'])
    {
      if (Array.isArray(pData[tmpName])) { tmpList = pData[tmpName]; break; }
    }
    if (!tmpList) tmpList = [pData];
  }
  else
  {
    throw new SourceError(REASONS.badResponse);
  }
  return tmpList.slice(0, MAX_ROWS).map((pItem) =>
    (pItem && typeof pItem === 'object' && !Array.isArray(pItem) ? pItem : { value: pItem }));
}

// Runs pTask(signal) under a hard timeout.
function WithTimeout(pTask, pMs)
{
  const tmpController = new AbortController();
  let tmpTimer;
  const tmpTimeout = new Promise((pResolve, pReject) =>
  {
    tmpTimer = setTimeout(() =>
    {
      tmpController.abort();
      pReject(new SourceError(REASONS.timeout));
    }, pMs);
  });
  const tmpWork = Promise.resolve().then(() => pTask(tmpController.signal));
  tmpWork.catch(() => {});
  return Promise.race([tmpWork, tmpTimeout]).finally(() => clearTimeout(tmpTimer));
}

function BuildOpts(pOptions)
{
  const tmpOpts = pOptions || {};
  return {
    transport: tmpOpts.transport || DefaultTransport,
    resolve: tmpOpts.resolve || DefaultResolve,
    decrypt: tmpOpts.decrypt || decryptKey,
    timeoutMs: Number.isFinite(tmpOpts.timeoutMs) ? tmpOpts.timeoutMs : TIMEOUT_MS
  };
}

function SafeReason(pErr)
{
  return pErr instanceof SourceError ? pErr.reason : REASONS.unreachable;
}

// ------------------------------------------------------------------ public

// pSource is the stored row (type, key_enc). Never throws.
async function TestSource(pSource, pOptions)
{
  const tmpOpts = BuildOpts(pOptions);
  try
  {
    await WithTimeout((pSignal) => FetchBody(pSource, tmpOpts, pSignal), tmpOpts.timeoutMs);
    return { status: 'ok' };
  }
  catch (tmpErr)
  {
    return { status: 'failed', reason: SafeReason(tmpErr) };
  }
}

// Resolves with 0..100 rows. Rejects with SourceError (fixed .reason) on any failure; route maps to 502.
async function PreviewSource(pSource, pOptions)
{
  const tmpOpts = BuildOpts(pOptions);
  try
  {
    const tmpData = await WithTimeout((pSignal) => FetchBody(pSource, tmpOpts, pSignal), tmpOpts.timeoutMs);
    return ToRows(tmpData);
  }
  catch (tmpErr)
  {
    throw tmpErr instanceof SourceError ? tmpErr : new SourceError(REASONS.unreachable);
  }
}

module.exports = {
  testSource: TestSource,
  previewSource: PreviewSource,
  SourceError,
  REASONS,
  isBlockedAddress: IsBlockedAddress,
  TIMEOUT_MS,
  MAX_ROWS
};
