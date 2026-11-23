'use strict';

const cheerio = require('cheerio');
const { ToValue, HeaderNames, RowObject } = require('./values');

const MAX_SELECTOR = 500;

class ScrapeError extends Error
{
  constructor(pCode)
  {
    super(pCode);
    this.code = pCode; // 'badSelector'
  }
}

function CellTexts($, pRow)
{
  // HTML whitespace is layout, not data
  return $(pRow).children('th, td').toArray().map((pCell) => $(pCell).text().replace(/\s+/g, ' ').trim());
}

// Table rows -> objects keyed by the header row (a <thead> row or a leading all-<th> row).
function TableRows($, pRows, pMax)
{
  let tmpRows = pRows;
  let tmpHeader = null;
  const tmpFirst = tmpRows[0];
  const tmpTable = $(tmpFirst).closest('table');
  const tmpHead = tmpTable.find('thead tr').first();
  if (tmpHead.length)
  {
    tmpHeader = CellTexts($, tmpHead);
    tmpRows = tmpRows.filter((pRow) => pRow !== tmpHead[0]);
  }
  else if ($(tmpFirst).children('td').length === 0 && $(tmpFirst).children('th').length > 0)
  {
    tmpHeader = CellTexts($, tmpFirst);
    tmpRows = tmpRows.slice(1);
  }
  const tmpWidth = Math.max(tmpHeader ? tmpHeader.length : 0, ...tmpRows.map((pRow) => $(pRow).children('th, td').length));
  const tmpNames = HeaderNames(tmpHeader || Array.from({ length: tmpWidth }, () => ''));
  return tmpRows
    .filter((pRow) => $(pRow).children('td').length > 0)
    .slice(0, pMax)
    .map((pRow) => RowObject(tmpNames, CellTexts($, pRow).map(ToValue)));
}

// Any other element -> { text, value, href? }.
function ElementRows($, pEls, pMax)
{
  return pEls.slice(0, pMax).map((pEl) =>
  {
    const tmpText = $(pEl).text().replace(/\s+/g, ' ').trim();
    const tmpRow = { text: tmpText, value: ToValue(tmpText) };
    const tmpHref = $(pEl).attr('href');
    if (typeof tmpHref === 'string') tmpRow.href = tmpHref;
    return tmpRow;
  });
}

// pHtml: page body; pSelector: user CSS selector. A selector matching <table> uses its rows.
function ScrapeRows(pHtml, pSelector, pMax)
{
  if (typeof pSelector !== 'string' || pSelector.trim() === '' || pSelector.length > MAX_SELECTOR)
  {
    throw new ScrapeError('badSelector');
  }
  const $ = cheerio.load(pHtml);
  let tmpEls;
  try
  {
    tmpEls = $(pSelector.trim()).toArray();
  }
  catch (tmpErr)
  {
    throw new ScrapeError('badSelector');
  }
  if (tmpEls.length === 0) return [];
  if (tmpEls.every((pEl) => pEl.tagName === 'table'))
  {
    tmpEls = $(tmpEls[0]).find('tr').toArray();
    if (tmpEls.length === 0) return [];
  }
  return tmpEls.every((pEl) => pEl.tagName === 'tr') ? TableRows($, tmpEls, pMax) : ElementRows($, tmpEls, pMax);
}

module.exports = { ScrapeRows, ScrapeError };
