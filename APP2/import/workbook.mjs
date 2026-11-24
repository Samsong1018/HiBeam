// ============================================================
// APP2 WORKBOOK READER
// ReadWorkbook: .xlsx -> { [sheetName]: rows keyed by the header row }.
// CheckSheets: fail fast, naming the missing sheet or column, before
// anything is uploaded. Spec: .kiro/specs/app2-monthly-import/ (Req 1)
// ============================================================

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
import { SHEETS } from './report.mjs';

const require = createRequire(import.meta.url);
const libExcel = require('exceljs');

export const MAX_BYTES = 5 * 1024 * 1024;

// A cell as a plain value: formula -> cached result, rich text -> text, hyperlink -> text.
export function CellValue(pValue)
{
    if (pValue === null || pValue === undefined) return null;
    if (pValue instanceof Date) return pValue.toISOString().slice(0, 10);
    if (typeof pValue !== 'object') return pValue;
    if ('result' in pValue) return CellValue(pValue.result);
    if (Array.isArray(pValue.richText)) return pValue.richText.map((pPart) => pPart.text).join('');
    if ('text' in pValue) return CellValue(pValue.text);
    if ('error' in pValue) return null;
    return null;
}

function SheetRows(pSheet)
{
    const tmpHeader = [];
    const tmpRows = [];
    pSheet.eachRow({ includeEmpty: false }, (pRow, pIndex) =>
    {
        const tmpValues = pRow.values.slice(1).map(CellValue);
        if (pIndex === 1 || !tmpHeader.length)
        {
            tmpValues.forEach((pV, pI) => { tmpHeader[pI] = pV === null ? '' : String(pV).trim(); });
            return;
        }
        const tmpObj = {};
        tmpHeader.forEach((pKey, pI) => { if (pKey) tmpObj[pKey] = tmpValues[pI] ?? null; });
        if (Object.values(tmpObj).some((pV) => pV !== null && pV !== '')) tmpRows.push(tmpObj);
    });
    return tmpRows;
}

export async function ReadWorkbook(pFile)
{
    if (path.extname(pFile).toLowerCase() !== '.xlsx') throw new Error(`${pFile} is not an .xlsx workbook`);
    const tmpStat = await fs.stat(pFile);
    if (tmpStat.size > MAX_BYTES) throw new Error(`${pFile} is larger than 5 MB, the HiBeam upload limit`);
    const tmpBook = new libExcel.Workbook();
    await tmpBook.xlsx.readFile(pFile);
    const tmpSheets = {};
    tmpBook.eachSheet((pSheet) => { tmpSheets[pSheet.name] = SheetRows(pSheet); });
    return tmpSheets;
}

/** Throws one error listing every missing sheet or column. */
export function CheckSheets(pSheets)
{
    const tmpProblems = [];
    for (const tmpDef of Object.values(SHEETS))
    {
        if (tmpDef.optional) continue;
        const tmpRows = pSheets?.[tmpDef.name];
        if (!Array.isArray(tmpRows))
        {
            tmpProblems.push(`missing sheet "${tmpDef.name}"`);
            continue;
        }
        const tmpHave = new Set(tmpRows.flatMap((pR) => Object.keys(pR)));
        tmpDef.columns.filter((pC) => !tmpHave.has(pC))
            .forEach((pC) => tmpProblems.push(`sheet "${tmpDef.name}" has no "${pC}" column`));
    }
    if (tmpProblems.length) throw new Error(`Workbook doesn't match the APP2 layout: ${tmpProblems.join('; ')}`);
}
