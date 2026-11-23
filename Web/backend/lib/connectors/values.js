'use strict';

// Shared cell/text helpers for the tabular connectors (scrape, excel, csv).

const NUMERIC_RE = /^[-+]?[$€£¥]?\s?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?%?$/;

// "1,299.50" -> 1299.5, "$12" -> 12, "45%" -> 45. Anything else stays a trimmed string.
function ToValue(pText)
{
  const tmpText = String(pText).trim();
  if (tmpText === '' || !/\d/.test(tmpText) || !NUMERIC_RE.test(tmpText)) return tmpText;
  const tmpNum = Number(tmpText.replace(/[$€£¥,%\s]/g, ''));
  return Number.isFinite(tmpNum) ? tmpNum : tmpText;
}

// Unique, non-empty column names: blanks become column_N, repeats get _2, _3.
function HeaderNames(pCells)
{
  const tmpSeen = new Map();
  return pCells.map((pCell, pIndex) =>
  {
    const tmpBase = String(pCell === null || pCell === undefined ? '' : pCell).replace(/\s+/g, ' ').trim().slice(0, 120)
      || `column_${pIndex + 1}`;
    const tmpCount = (tmpSeen.get(tmpBase) || 0) + 1;
    tmpSeen.set(tmpBase, tmpCount);
    return tmpCount === 1 ? tmpBase : `${tmpBase}_${tmpCount}`;
  });
}

// Plain object without a prototype-polluting key path: header names come from untrusted files.
function RowObject(pHeaders, pCells)
{
  const tmpRow = {};
  pHeaders.forEach((pName, pIndex) =>
  {
    if (pName === '__proto__' || pName === 'constructor' || pName === 'prototype') return;
    tmpRow[pName] = pCells[pIndex] === undefined ? null : pCells[pIndex];
  });
  return tmpRow;
}

module.exports = { ToValue, HeaderNames, RowObject };
