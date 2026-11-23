'use strict';

// Parses a text log into rows. Unparseable lines are skipped; the newest pMax lines are kept.

const LOG_FORMATS = ['json', 'nginx', 'apache', 'syslog'];

// nginx's default "combined" format and Apache's combined/common formats share one shape.
const COMBINED_RE = /^(\S+) \S+ (\S+) \[([^\]]+)\] "(\S+) (\S+)(?: [^"]*)?" (\d{3}) (\d+|-)(?: "([^"]*)" "([^"]*)")?/;
const SYSLOG_RE = /^(?:<\d{1,3}>)?([A-Z][a-z]{2} {1,2}\d{1,2} \d{2}:\d{2}:\d{2}) (\S+) ([^:[\s]+)(?:\[(\d+)\])?: ?(.*)$/;
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// "10/Oct/2026:13:55:36 -0700" -> ISO string, or the raw text if it doesn't parse.
function CombinedTime(pText)
{
  const tmpMatch = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(pText);
  if (!tmpMatch || !(tmpMatch[2] in MONTHS)) return pText;
  const [, tmpD, tmpMon, tmpY, tmpH, tmpMi, tmpS, tmpSign, tmpOh, tmpOm] = tmpMatch;
  const tmpOffset = (tmpSign === '-' ? -1 : 1) * (Number(tmpOh) * 60 + Number(tmpOm));
  const tmpMs = Date.UTC(Number(tmpY), MONTHS[tmpMon], Number(tmpD), Number(tmpH), Number(tmpMi), Number(tmpS)) - tmpOffset * 60000;
  return new Date(tmpMs).toISOString();
}

function ParseCombined(pLine)
{
  const tmpM = COMBINED_RE.exec(pLine);
  if (!tmpM) return null;
  return {
    time: CombinedTime(tmpM[3]),
    ip: tmpM[1],
    user: tmpM[2] === '-' ? null : tmpM[2],
    method: tmpM[4],
    path: tmpM[5],
    status: Number(tmpM[6]),
    bytes: tmpM[7] === '-' ? 0 : Number(tmpM[7]),
    referrer: tmpM[8] === undefined || tmpM[8] === '-' ? null : tmpM[8],
    userAgent: tmpM[9] === undefined || tmpM[9] === '-' ? null : tmpM[9]
  };
}

function ParseSyslog(pLine)
{
  const tmpM = SYSLOG_RE.exec(pLine);
  if (!tmpM) return null;
  return { time: tmpM[1].replace(/ {2}/, ' '), host: tmpM[2], program: tmpM[3], pid: tmpM[4] ? Number(tmpM[4]) : null, message: tmpM[5] };
}

function ParseJsonLine(pLine)
{
  if (!pLine.startsWith('{')) return null;
  try
  {
    const tmpObj = JSON.parse(pLine);
    return tmpObj && typeof tmpObj === 'object' && !Array.isArray(tmpObj) ? tmpObj : null;
  }
  catch (tmpErr)
  {
    return null;
  }
}

const PARSERS = { json: ParseJsonLine, nginx: ParseCombined, apache: ParseCombined, syslog: ParseSyslog };

// Returns { rows, lines }: lines is how many non-empty lines were seen, so callers can tell
// "empty log" from "nothing matched the format".
function ParseLogs(pText, pFormat, pMax)
{
  const tmpParse = PARSERS[pFormat] || PARSERS.json;
  const tmpLines = String(pText).split(/\r?\n/).map((pLine) => pLine.trim()).filter(Boolean);
  const tmpRows = [];
  for (const tmpLine of tmpLines)
  {
    const tmpRow = tmpParse(tmpLine);
    if (tmpRow) tmpRows.push(tmpRow);
  }
  return { rows: tmpRows.slice(-pMax), lines: tmpLines.length };
}

module.exports = { ParseLogs, LOG_FORMATS };
