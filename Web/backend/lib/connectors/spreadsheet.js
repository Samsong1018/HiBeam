'use strict';

const { ToValue, HeaderNames, RowObject } = require('./values');

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2000;

class SheetError extends Error
{
  constructor(pCode)
  {
    super(pCode);
    this.code = pCode; // 'badFile' | 'noSheet'
  }
}

const IsZip = (pBuf) => pBuf.length >= 4 && pBuf.readUInt32LE(0) === 0x04034b50;

// Text files (CSV) have no NUL bytes; this is how an upload is told apart from a binary blob.
function LooksLikeText(pBuf)
{
  return !pBuf.subarray(0, 8192).includes(0);
}

// Reads the zip central directory and sums declared uncompressed sizes, so a small .xlsx
// that inflates to gigabytes is refused before it is unpacked. ZIP64 archives are refused.
function CheckZipBudget(pBuf)
{
  const tmpMin = Math.max(0, pBuf.length - 65557);
  let tmpEocd = -1;
  for (let tmpI = pBuf.length - 22; tmpI >= tmpMin; tmpI -= 1)
  {
    if (pBuf.readUInt32LE(tmpI) === 0x06054b50) { tmpEocd = tmpI; break; }
  }
  if (tmpEocd < 0) throw new SheetError('badFile');
  const tmpCount = pBuf.readUInt16LE(tmpEocd + 10);
  let tmpPos = pBuf.readUInt32LE(tmpEocd + 16);
  if (tmpCount === 0xffff || tmpPos === 0xffffffff || tmpCount > MAX_ZIP_ENTRIES) throw new SheetError('badFile');
  let tmpTotal = 0;
  for (let tmpI = 0; tmpI < tmpCount; tmpI += 1)
  {
    if (tmpPos + 46 > pBuf.length || pBuf.readUInt32LE(tmpPos) !== 0x02014b50) throw new SheetError('badFile');
    const tmpSize = pBuf.readUInt32LE(tmpPos + 24);
    if (tmpSize === 0xffffffff) throw new SheetError('badFile');
    tmpTotal += tmpSize;
    if (tmpTotal > MAX_UNZIPPED_BYTES) throw new SheetError('badFile');
    tmpPos += 46 + pBuf.readUInt16LE(tmpPos + 28) + pBuf.readUInt16LE(tmpPos + 30) + pBuf.readUInt16LE(tmpPos + 32);
  }
}

// ------------------------------------------------------------------ CSV

function DetectDelimiter(pLine)
{
  const tmpCounts = [',', ';', '\t'].map((pD) => [pD, pLine.split(pD).length]);
  tmpCounts.sort((pA, pB) => pB[1] - pA[1]);
  return tmpCounts[0][1] > 1 ? tmpCounts[0][0] : ',';
}

// RFC 4180: quoted fields, "" escapes, newlines inside quotes. Stops after pMaxRecords.
function ParseCsvRecords(pText, pMaxRecords)
{
  const tmpText = pText.replace(/^﻿/, '');
  const tmpDelim = DetectDelimiter(tmpText.slice(0, tmpText.search(/\r?\n|$/)));
  const tmpRecords = [];
  let tmpField = '';
  let tmpRecord = [];
  let tmpQuoted = false;
  for (let tmpI = 0; tmpI < tmpText.length && tmpRecords.length < pMaxRecords; tmpI += 1)
  {
    const tmpCh = tmpText[tmpI];
    if (tmpQuoted)
    {
      if (tmpCh === '"' && tmpText[tmpI + 1] === '"') { tmpField += '"'; tmpI += 1; }
      else if (tmpCh === '"') tmpQuoted = false;
      else tmpField += tmpCh;
    }
    else if (tmpCh === '"' && tmpField === '') tmpQuoted = true;
    else if (tmpCh === tmpDelim) { tmpRecord.push(tmpField); tmpField = ''; }
    else if (tmpCh === '\n' || tmpCh === '\r')
    {
      if (tmpCh === '\r' && tmpText[tmpI + 1] === '\n') tmpI += 1;
      tmpRecord.push(tmpField);
      tmpRecords.push(tmpRecord);
      tmpField = '';
      tmpRecord = [];
    }
    else tmpField += tmpCh;
  }
  if ((tmpField !== '' || tmpRecord.length > 0) && tmpRecords.length < pMaxRecords)
  {
    tmpRecord.push(tmpField);
    tmpRecords.push(tmpRecord);
  }
  return tmpRecords.filter((pRec) => pRec.some((pCell) => pCell.trim() !== ''));
}

function CsvRows(pBuf, pMax)
{
  const tmpRecords = ParseCsvRecords(pBuf.toString('utf8'), pMax + 1);
  if (tmpRecords.length === 0) return [];
  const tmpNames = HeaderNames(tmpRecords[0]);
  return tmpRecords.slice(1).map((pRec) => RowObject(tmpNames, pRec.map(ToValue)));
}

// ----------------------------------------------------------------- XLSX

// exceljs cell values can be rich objects; flatten them to something a chart can use.
function CellValue(pValue)
{
  if (pValue === null || pValue === undefined) return null;
  if (pValue instanceof Date) return pValue.toISOString();
  if (typeof pValue !== 'object') return typeof pValue === 'string' ? ToValue(pValue) : pValue;
  if ('result' in pValue) return CellValue(pValue.result);
  if (Array.isArray(pValue.richText)) return pValue.richText.map((pPart) => pPart.text).join('');
  if ('text' in pValue) return CellValue(pValue.text);
  if ('error' in pValue) return null;
  return null;
}

async function XlsxRows(pBuf, pSheetName, pMax)
{
  CheckZipBudget(pBuf);
  const ExcelJS = require('exceljs');
  const tmpBook = new ExcelJS.Workbook();
  try
  {
    await tmpBook.xlsx.load(pBuf);
  }
  catch (tmpErr)
  {
    throw new SheetError('badFile');
  }
  const tmpWanted = typeof pSheetName === 'string' ? pSheetName.trim().toLowerCase() : '';
  const tmpSheet = tmpWanted
    ? tmpBook.worksheets.find((pWs) => pWs.name.toLowerCase() === tmpWanted)
    : tmpBook.worksheets[0];
  if (!tmpSheet) throw new SheetError('noSheet');

  const tmpRecords = [];
  tmpSheet.eachRow({ includeEmpty: false }, (pRow) =>
  {
    if (tmpRecords.length > pMax) return;
    // row.values is 1-based with a hole at [0]
    tmpRecords.push(Array.from(pRow.values).slice(1).map(CellValue));
  });
  if (tmpRecords.length === 0) return [];
  const tmpNames = HeaderNames(tmpRecords[0].map((pV) => (pV === null ? '' : String(pV))));
  return tmpRecords.slice(1, pMax + 1).map((pRec) => RowObject(tmpNames, pRec));
}

// pBuf: uploaded bytes (.xlsx or .csv). pSheetName applies to .xlsx only.
async function SpreadsheetRows(pBuf, pSheetName, pMax)
{
  if (!Buffer.isBuffer(pBuf) || pBuf.length === 0) throw new SheetError('noFile');
  if (IsZip(pBuf)) return XlsxRows(pBuf, pSheetName, pMax);
  if (LooksLikeText(pBuf)) return CsvRows(pBuf, pMax);
  throw new SheetError('badFile');
}

// Upload check: accepts .xlsx (zip) or CSV-looking text within the size limit.
function CheckUpload(pBuf)
{
  if (!Buffer.isBuffer(pBuf) || pBuf.length === 0) return 'missing';
  if (pBuf.length > MAX_FILE_BYTES) return 'too_large';
  if (IsZip(pBuf) || LooksLikeText(pBuf)) return null;
  return 'unsupported';
}

module.exports = { SpreadsheetRows, CheckUpload, SheetError, ParseCsvRecords, MAX_FILE_BYTES };
