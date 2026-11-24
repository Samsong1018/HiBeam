'use strict';

const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const os = require('os');
const { decryptKey } = require('./crypto-box');
const { ScrapeRows, ScrapeError } = require('./connectors/scrape');
const { ParseLogs } = require('./connectors/logs');
const { SpreadsheetRows, SheetError, CsvTextRows } = require('./connectors/spreadsheet');
const { FetchFollowing, HopError } = require('./connectors/redirects');
const { BuildPromUrl, PromRows, PromError } = require('./connectors/prometheus');
const { SqlRows, SqlError } = require('./connectors/sql');
const { FlattenRow } = require('./connectors/flatten');

const TIMEOUT_MS = 10000;
const MAX_ROWS = 100;
const MAX_BYTES = 2 * 1024 * 1024;
// Log sources ask for only this much of the end of the file (Range: bytes=-N).
const LOG_TAIL_BYTES = 1024 * 1024;

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
  badResponse: 'Source returned an unexpected response',
  badPath: 'Array path was not found in the response',
  badSelector: 'CSS selector is invalid',
  noLogLines: 'No log lines matched the chosen format',
  noFile: 'No spreadsheet has been uploaded for this source',
  badFile: 'Spreadsheet could not be read (use .xlsx or .csv)',
  noSheet: 'Sheet was not found in the workbook',
  badConnection: 'Connection string is invalid (use mysql://user:pass@host:3306/db)',
  unsupportedDb: 'Only MySQL / MariaDB connections are supported',
  notSelect: 'Only a single SELECT query is allowed',
  queryFailed: 'Query failed on the database',
  tooLarge: 'Source response is larger than 2 MB',
  notCsv: 'Link did not return CSV (for Google Sheets use File > Share > Publish to web > CSV)',
  tooManyRedirects: 'Source redirected too many times',
  badQuery: 'PromQL query is required (up to 2000 characters)',
  badRange: 'Range must be instant, 1h, 6h or 24h',
  promRejected: 'Prometheus rejected the query'
});

// Connector error codes -> fixed reasons. Driver/parser text is never passed through.
const CODE_REASONS = {
  badSelector: REASONS.badSelector,
  noFile: REASONS.noFile,
  badFile: REASONS.badFile,
  noSheet: REASONS.noSheet,
  badConnection: REASONS.badConnection,
  unsupportedDb: REASONS.unsupportedDb,
  notSelect: REASONS.notSelect,
  rejected: REASONS.rejected,
  unreachable: REASONS.unreachable,
  queryFailed: REASONS.queryFailed,
  // csv / prometheus (HopError, PromError)
  tooManyRedirects: REASONS.tooManyRedirects,
  badRedirect: REASONS.badResponse,
  insecureRedirect: REASONS.blockedUrl,
  badUrl: REASONS.badUrl,
  badResponse: REASONS.badResponse,
  badQuery: REASONS.badQuery,
  badRange: REASONS.badRange,
  promRejected: REASONS.promRejected
};

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
  if (tmpA === 192 && tmpB === 0 && tmpC === 2) return true;    // TEST-NET-1
  if (tmpA === 198 && tmpB === 51 && tmpC === 100) return true; // TEST-NET-2
  if (tmpA === 203 && tmpB === 0 && tmpC === 113) return true;  // TEST-NET-3
  if (tmpA === 192 && tmpB === 88 && tmpC === 99) return true;  // 6to4 relay anycast
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
  if (pBytes[0] === 0x20 && pBytes[1] === 0x01 && pBytes[2] === 0x00 && pBytes[3] === 0x00) return true; // Teredo 2001::/32
  if (pBytes[0] === 0x20 && pBytes[1] === 0x01 && pBytes[2] === 0x0d && pBytes[3] === 0xb8) return true; // documentation
  if (pBytes[0] === 0x00 && pBytes[1] === 0x64 && pBytes[2] === 0xff && pBytes[3] === 0x9b
    && pBytes[4] === 0x00 && pBytes[5] === 0x01) return true;  // local-use NAT64 64:ff9b:1::/48
  if (pBytes[0] === 0xfe && (pBytes[1] & 0xc0) === 0x80) return true;  // fe80::/10 link-local
  if (pBytes[0] === 0xfe && (pBytes[1] & 0xc0) === 0xc0) return true;  // fec0::/10 site-local
  if ((pBytes[0] & 0xfe) === 0xfc) return true;                 // fc00::/7 unique local
  if (pBytes[0] === 0xff) return true;                          // multicast
  return false;
}

/*
  The server's own addresses. A public IP on this host routes back to itself, so without this a
  source could reach anything bound to 0.0.0.0 here (other apps, the app itself) even though
  127.0.0.1 is blocked. Read per call: interfaces can change, and the list is tiny.
*/
function OwnAddressKeys()
{
  const tmpKeys = new Set();
  for (const tmpList of Object.values(os.networkInterfaces()))
  {
    for (const tmpIf of tmpList || [])
    {
      const tmpKey = AddressKey(tmpIf.address);
      if (tmpKey) tmpKeys.add(tmpKey);
    }
  }
  return tmpKeys;
}

// Canonical form of an address for comparison (IPv4-mapped IPv6 folds to IPv4), or null.
function AddressKey(pAddress)
{
  const tmpText = String(pAddress).replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const tmpKind = net.isIP(tmpText);
  if (tmpKind === 4) { const tmpB = ParseIPv4(tmpText); return tmpB ? `4:${tmpB.join('.')}` : null; }
  if (tmpKind !== 6) return null;
  const tmpBytes = ParseIPv6(tmpText);
  if (!tmpBytes) return null;
  const tmpMapped = tmpBytes.slice(0, 10).every((pB) => pB === 0) && tmpBytes[10] === 255 && tmpBytes[11] === 255;
  return tmpMapped ? `4:${tmpBytes.slice(12).join('.')}` : `6:${tmpBytes.join(',')}`;
}

// True when the address must not be contacted. Unparseable input is blocked.
function IsBlockedAddress(pAddress, pOwnKeys)
{
  const tmpText = String(pAddress).replace(/^\[|\]$/g, '');
  const tmpKind = net.isIP(tmpText);
  if (tmpKind === 0) return true;
  const tmpOwn = pOwnKeys || OwnAddressKeys();
  if (tmpOwn.has(AddressKey(tmpText))) return true;
  if (tmpKind === 4) return IsBlockedIPv4(ParseIPv4(tmpText) || [0, 0, 0, 0]);
  const tmpBytes = ParseIPv6(tmpText);
  return tmpBytes ? IsBlockedIPv6(tmpBytes) : true;
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

// Appends pChunk to the rolling tail, dropping whole chunks from the front once the rest
// still holds pMax bytes. Memory stays at pMax plus one chunk.
function PushTail(pTail, pChunk, pMax)
{
  pTail.chunks.push(pChunk);
  pTail.size += pChunk.length;
  while (pTail.chunks.length > 1 && pTail.size - pTail.chunks[0].length >= pMax)
  {
    pTail.size -= pTail.chunks.shift().length;
    pTail.dropped = true;
  }
}

function TooLargeError()
{
  return Object.assign(new Error('too large'), { code: 'tooLarge' });
}

// Default transport: GET with no redirects, connection pinned to the vetted address.
// A body over MAX_BYTES rejects with code 'tooLarge', unless pReq.tail is set: then only the
// last MAX_BYTES are kept and the result says { truncated: true }.
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
      const tmpTail = { chunks: [], size: 0, dropped: false };
      pRes.on('data', (pChunk) =>
      {
        if (!pReq.tail && tmpTail.size + pChunk.length > MAX_BYTES)
        {
          pRes.destroy();
          pReject(TooLargeError());
          return;
        }
        PushTail(tmpTail, pChunk, MAX_BYTES);
      });
      pRes.on('end', () =>
      {
        const tmpBody = Buffer.concat(tmpTail.chunks);
        const tmpTruncated = tmpTail.dropped || tmpBody.length > MAX_BYTES;
        pResolve({
          status: pRes.statusCode,
          headers: pRes.headers,
          body: tmpBody.subarray(-MAX_BYTES).toString('utf8'),
          truncated: tmpTruncated
        });
      });
      pRes.on('error', pReject);
    });
    tmpRequest.on('error', pReject);
    tmpRequest.end();
  });
}

// ------------------------------------------------------------------- fetch

// The decrypted key is a plain URL (rest/json) or a JSON object whose fields depend on the type:
//   rest/json  { url, token?, queryParam?, path? }   token -> bearer header, or ?queryParam=token
//   scrape     { url, selector }
//   logs       { url, format, token? }
//   sql        { connection, query }
//   excel      { sheet? }   the file itself is stored separately (sources.file_data)
//   csv        { url, token? }
//   prometheus { url, query, range, token? }   range: instant | 1h | 6h | 24h
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
  if (!tmpTrim.startsWith('{')) return { url: tmpTrim };
  let tmpObj;
  try
  {
    tmpObj = JSON.parse(tmpTrim);
  }
  catch (tmpErr)
  {
    throw new SourceError(REASONS.badKey);
  }
  if (!tmpObj || typeof tmpObj !== 'object' || Array.isArray(tmpObj)) throw new SourceError(REASONS.badKey);
  return tmpObj;
}

const Str = (pValue) => (typeof pValue === 'string' && pValue.trim() !== '' ? pValue.trim() : null);

// GET over the vetted, pinned transport. Returns { status, headers, body, truncated } for a 2xx
// (206 included). pExtra: { headers, tail }. Without tail a body over MAX_BYTES is tooLarge; with
// tail the newest MAX_BYTES are kept, even if a (fake) transport ignored the flag.
async function FetchResponse(pConfig, pAccept, pOpts, pSignal, pExtra)
{
  const tmpExtra = pExtra || {};
  const tmpUrlText = Str(pConfig.url);
  if (!tmpUrlText) throw new SourceError(REASONS.badKey);
  const tmpUrl = ParseSourceUrl(tmpUrlText);
  const tmpHeaders = { ...(tmpExtra.headers || {}), Accept: pAccept, 'User-Agent': 'dashboard-source-connector' };
  const tmpToken = Str(pConfig.token);
  const tmpParam = Str(pConfig.queryParam);
  if (tmpToken)
  {
    if (tmpParam) tmpUrl.searchParams.set(tmpParam, tmpToken);
    else tmpHeaders.Authorization = `Bearer ${tmpToken}`;
  }
  const tmpAddress = await ResolveSafeAddress(tmpUrl, pOpts.resolve);
  let tmpRes;
  try
  {
    tmpRes = await pOpts.transport({ url: tmpUrl.toString(), address: tmpAddress, headers: tmpHeaders, signal: pSignal, tail: Boolean(tmpExtra.tail) });
  }
  catch (tmpErr)
  {
    throw new SourceError(tmpErr && tmpErr.code === 'tooLarge' ? REASONS.tooLarge : REASONS.unreachable);
  }
  const tmpStatus = tmpRes && tmpRes.status;
  if (tmpStatus === 401 || tmpStatus === 403) throw new SourceError(REASONS.rejected);
  if (!Number.isInteger(tmpStatus) || tmpStatus < 200 || tmpStatus >= 300) throw new SourceError(REASONS.upstreamError);
  let tmpBody = typeof tmpRes.body === 'string' ? tmpRes.body : String(tmpRes.body || '');
  let tmpTruncated = Boolean(tmpRes.truncated);
  if (Buffer.byteLength(tmpBody, 'utf8') > MAX_BYTES)
  {
    if (!tmpExtra.tail) throw new SourceError(REASONS.tooLarge);
    tmpBody = Buffer.from(tmpBody, 'utf8').subarray(-MAX_BYTES).toString('utf8');
    tmpTruncated = true;
  }
  const tmpResHeaders = tmpRes.headers && typeof tmpRes.headers === 'object' ? tmpRes.headers : {};
  return { status: tmpStatus, headers: tmpResHeaders, body: tmpBody, truncated: tmpTruncated };
}

async function FetchText(pConfig, pAccept, pOpts, pSignal)
{
  return (await FetchResponse(pConfig, pAccept, pOpts, pSignal)).body;
}

// True when a 206 body starts mid-file. "Content-Range: bytes 0-..." means the whole file fit;
// a 206 without a readable Content-Range is assumed to start mid-file.
function StartsMidFile(pHeaders)
{
  const tmpRange = /^bytes (\d+)-/i.exec(String(pHeaders['content-range'] || ''));
  return !tmpRange || Number(tmpRange[1]) > 0;
}

// Fetches the end of a log. Asks for the last LOG_TAIL_BYTES; a server that ignores Range gets
// its newest MAX_BYTES kept. When the text starts mid-file the first (partial) line is dropped.
async function FetchLogTail(pConfig, pOpts, pSignal)
{
  const tmpRes = await FetchResponse(pConfig, 'text/plain, */*', pOpts, pSignal, {
    headers: { Range: `bytes=-${LOG_TAIL_BYTES}` },
    tail: true
  });
  const tmpPartial = tmpRes.truncated || (tmpRes.status === 206 && StartsMidFile(tmpRes.headers));
  if (!tmpPartial) return tmpRes.body;
  const tmpBreak = tmpRes.body.indexOf('\n');
  return tmpBreak === -1 ? '' : tmpRes.body.slice(tmpBreak + 1);
}

// "data.items" -> pData.data.items. Own properties only.
function WalkPath(pData, pPath)
{
  const tmpPath = Str(pPath);
  if (!tmpPath) return pData;
  let tmpNode = pData;
  for (const tmpPart of tmpPath.split('.'))
  {
    if (!tmpNode || typeof tmpNode !== 'object' || !Object.prototype.hasOwnProperty.call(tmpNode, tmpPart))
    {
      throw new SourceError(REASONS.badPath);
    }
    tmpNode = tmpNode[tmpPart];
  }
  return tmpNode;
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
  // Nested objects/arrays become dotted primitive fields (rules in connectors/flatten.js).
  return tmpList.slice(0, MAX_ROWS).map((pItem) =>
    FlattenRow(pItem && typeof pItem === 'object' && !Array.isArray(pItem) ? pItem : { value: pItem }));
}

// Connector-specific errors (ScrapeError, SheetError, SqlError) carry a code; map it to a reason.
function FromCode(pErr)
{
  if (pErr instanceof SourceError) return pErr;
  if (pErr instanceof ScrapeError || pErr instanceof SheetError || pErr instanceof SqlError)
  {
    return new SourceError(CODE_REASONS[pErr.code] || REASONS.unreachable);
  }
  return new SourceError(REASONS.unreachable);
}

// Like FetchText, but follows up to 3 redirects, re-vetting and re-pinning every hop (csv and
// prometheus only). pStatusCodes maps extra upstream statuses to connector codes.
async function FetchFollowingText(pConfig, pAccept, pOpts, pSignal, pStatusCodes)
{
  const tmpUrlText = Str(pConfig.url);
  if (!tmpUrlText) throw new SourceError(REASONS.badKey);
  const tmpHeaders = { Accept: pAccept, 'User-Agent': 'dashboard-source-connector' };
  const tmpToken = Str(pConfig.token);
  if (tmpToken) tmpHeaders.Authorization = `Bearer ${tmpToken}`;
  let tmpRes;
  try
  {
    tmpRes = await FetchFollowing(tmpUrlText, tmpHeaders, {
      parseUrl: ParseSourceUrl,
      resolveSafe: (pUrl) => ResolveSafeAddress(pUrl, pOpts.resolve),
      transport: pOpts.transport,
      transportError: (pErr) => new SourceError(pErr && pErr.code === 'tooLarge' ? REASONS.tooLarge : REASONS.unreachable)
    }, pSignal);
  }
  catch (tmpErr)
  {
    if (tmpErr instanceof HopError) throw new SourceError(CODE_REASONS[tmpErr.code] || REASONS.unreachable);
    throw tmpErr;
  }
  const tmpStatus = tmpRes && tmpRes.status;
  if (tmpStatus === 401 || tmpStatus === 403) throw new SourceError(REASONS.rejected);
  const tmpCode = pStatusCodes && Object.prototype.hasOwnProperty.call(pStatusCodes, tmpStatus) ? pStatusCodes[tmpStatus] : null;
  if (tmpCode) throw new SourceError(CODE_REASONS[tmpCode]);
  if (!Number.isInteger(tmpStatus) || tmpStatus < 200 || tmpStatus >= 300) throw new SourceError(REASONS.upstreamError);
  const tmpBody = typeof tmpRes.body === 'string' ? tmpRes.body : String(tmpRes.body || '');
  if (Buffer.byteLength(tmpBody, 'utf8') > MAX_BYTES) throw new SourceError(REASONS.tooLarge);
  return tmpBody;
}

const HANDLERS = {
  async rest(pSource, pConfig, pOpts, pSignal)
  {
    const tmpBody = await FetchText(pConfig, 'application/json', pOpts, pSignal);
    let tmpData;
    try
    {
      tmpData = JSON.parse(tmpBody);
    }
    catch (tmpErr)
    {
      throw new SourceError(REASONS.badResponse);
    }
    return ToRows(WalkPath(tmpData, pConfig.path));
  },

  async scrape(pSource, pConfig, pOpts, pSignal)
  {
    const tmpHtml = await FetchText(pConfig, 'text/html,application/xhtml+xml', pOpts, pSignal);
    return ScrapeRows(tmpHtml, pConfig.selector, MAX_ROWS);
  },

  async logs(pSource, pConfig, pOpts, pSignal)
  {
    const tmpText = await FetchLogTail(pConfig, pOpts, pSignal);
    const tmpResult = ParseLogs(tmpText, Str(pConfig.format) || 'json', MAX_ROWS);
    if (tmpResult.rows.length === 0 && tmpResult.lines > 0) throw new SourceError(REASONS.noLogLines);
    return tmpResult.rows;
  },

  async sql(pSource, pConfig, pOpts, pSignal)
  {
    return SqlRows(pConfig, {
      resolveSafeAddress: (pUrl) => ResolveSafeAddress(pUrl, pOpts.resolve),
      mysql: pOpts.mysql,
      maxRows: MAX_ROWS,
      timeoutMs: pOpts.timeoutMs,
      signal: pSignal
    });
  },

  async excel(pSource, pConfig, pOpts)
  {
    const tmpFile = await pOpts.loadFile(pSource);
    return SpreadsheetRows(tmpFile, pConfig.sheet, MAX_ROWS);
  },

  // CSV by URL, e.g. a Google Sheets "Publish to web -> CSV" link (302s to googleusercontent).
  // Parsed exactly like an uploaded .csv.
  async csv(pSource, pConfig, pOpts, pSignal)
  {
    const tmpText = await FetchFollowingText(pConfig, 'text/csv, text/plain;q=0.9, */*;q=0.5', pOpts, pSignal, null);
    if (/^\s*</.test(tmpText)) throw new SourceError(REASONS.notCsv); // an HTML sign-in or error page
    return CsvTextRows(tmpText, MAX_ROWS);
  },

  // PromQL over /api/v1/query (instant) or /api/v1/query_range (1h / 6h / 24h).
  async prometheus(pSource, pConfig, pOpts, pSignal)
  {
    try
    {
      const tmpUrl = BuildPromUrl(pConfig, Date.now(), MAX_ROWS);
      const tmpBody = await FetchFollowingText({ url: tmpUrl, token: pConfig.token }, 'application/json', pOpts, pSignal,
        { 400: 'promRejected', 422: 'promRejected' });
      return PromRows(tmpBody, MAX_ROWS);
    }
    catch (tmpErr)
    {
      if (tmpErr instanceof PromError) throw new SourceError(CODE_REASONS[tmpErr.code] || REASONS.badResponse);
      throw tmpErr;
    }
  }
};
HANDLERS.json = HANDLERS.rest;

async function FetchRows(pSource, pOpts, pSignal)
{
  const tmpHandler = pSource && Object.prototype.hasOwnProperty.call(HANDLERS, pSource.type) ? HANDLERS[pSource.type] : null;
  if (!tmpHandler) throw new SourceError(REASONS.unsupported);
  const tmpConfig = ReadConfig(pSource, pOpts.decrypt);
  try
  {
    const tmpRows = await tmpHandler(pSource, tmpConfig, pOpts, pSignal);
    return Array.isArray(tmpRows) ? tmpRows.slice(0, MAX_ROWS) : [];
  }
  catch (tmpErr)
  {
    throw FromCode(tmpErr);
  }
}

// Excel bytes live in their own column and are only read for excel previews.
function DefaultLoadFile(pSource)
{
  return require('./repos/sources').getFile(pSource.owner_id, pSource.id);
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
    loadFile: tmpOpts.loadFile || DefaultLoadFile,
    mysql: tmpOpts.mysql,
    timeoutMs: Number.isFinite(tmpOpts.timeoutMs) ? tmpOpts.timeoutMs : TIMEOUT_MS
  };
}

function SafeReason(pErr)
{
  return pErr instanceof SourceError ? pErr.reason : REASONS.unreachable;
}

// ------------------------------------------------------------------ public

// pSource is the stored row (id, owner_id, type, key_enc). Never throws.
async function TestSource(pSource, pOptions)
{
  const tmpOpts = BuildOpts(pOptions);
  try
  {
    await WithTimeout((pSignal) => FetchRows(pSource, tmpOpts, pSignal), tmpOpts.timeoutMs);
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
    return await WithTimeout((pSignal) => FetchRows(pSource, tmpOpts, pSignal), tmpOpts.timeoutMs);
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
  ownAddressKeys: OwnAddressKeys,
  defaultTransport: DefaultTransport,
  TIMEOUT_MS,
  MAX_ROWS,
  MAX_BYTES,
  LOG_TAIL_BYTES
};
