// ============================================================
// APP2 MONTHLY REPORT · pure, no I/O
// BuildReport: workbook rows -> month, totals and the "This month" caption,
// by fixed rules so every sentence can be checked against the sheet.
// ApplyReport: board definition + report -> new definition, touching only
// the month-specific widgets. Spec: .kiro/specs/app2-monthly-import/
// ============================================================

export const SHEETS = {
    budget: { name: 'Budget vs Actual', columns: ['Category', 'Budget ($)', 'Actual ($)'] },
    spending: { name: 'Monthly Spending', columns: ['Month', 'Spending ($)'] },
    networth: { name: 'Net Worth', columns: ['Month', 'Net Worth ($)'] },
    accounts: { name: 'Accounts', columns: ['Account', 'Balance ($)'] },
    debts: { name: 'Debts', columns: ['Debt', 'Balance ($)', 'APR (%)'] },
    profile: { name: 'Profile', columns: ['Field', 'Value'], optional: true },
};

export const MAX_CAPTION = 4000;
const WARN_SHARE = 0.95;
const MAX_OVER_NAMED = 2;
const IS_SAVINGS = /saving|invest|retire|401|\bira\b/i;

function Num(pValue)
{
    if (typeof pValue === 'number') return Number.isFinite(pValue) ? pValue : null;
    if (typeof pValue !== 'string' || pValue.trim() === '') return null;
    const tmpN = Number(pValue.replace(/[,$%\s]/g, ''));
    return Number.isFinite(tmpN) ? tmpN : null;
}

function Money(pValue)
{
    const tmpRounded = Math.round(Math.abs(pValue));
    return `$${tmpRounded.toLocaleString('en-US')}`;
}

function Text(pValue, pMax = 60)
{
    return String(pValue ?? '').trim().slice(0, pMax);
}

function RowsOf(pSheets, pKey)
{
    const tmpRows = pSheets?.[SHEETS[pKey].name];
    return Array.isArray(tmpRows) ? tmpRows.filter((pR) => pR && typeof pR === 'object') : [];
}

export function IsSavings(pCategory)
{
    return IS_SAVINGS.test(String(pCategory ?? ''));
}

// ------------------------------------------------------------
// Caption sentences, each null when its data isn't there
// ------------------------------------------------------------
export function OverBudget(pBudgetRows)
{
    return pBudgetRows
        .map((pR, pI) => ({ category: Text(pR.Category), over: (Num(pR['Actual ($)']) ?? 0) - (Num(pR['Budget ($)']) ?? 0), index: pI }))
        .filter((pC) => pC.category && !IsSavings(pC.category) && pC.over > 0)
        .sort((pA, pB) => pB.over - pA.over || pA.index - pB.index);
}

function OverSentence(pBudgetRows)
{
    const tmpOver = OverBudget(pBudgetRows).slice(0, MAX_OVER_NAMED);
    if (!pBudgetRows.length) return null;
    if (!tmpOver.length) return 'Every category stayed within budget.';
    const tmpNames = tmpOver.map((pC) => `${pC.category} (+${Money(pC.over)})`);
    return tmpNames.length === 1
        ? `${tmpNames[0]} went furthest over budget.`
        : `${tmpNames[0]} and ${tmpNames[1]} went furthest over budget.`;
}

function SavingsSentence(pBudgetRows)
{
    const tmpRow = pBudgetRows.find((pR) => IsSavings(pR.Category));
    if (!tmpRow) return null;
    const tmpBudget = Num(tmpRow['Budget ($)']);
    const tmpActual = Num(tmpRow['Actual ($)']);
    if (tmpBudget === null || tmpActual === null) return null;
    const tmpName = Text(tmpRow.Category);
    if (tmpActual >= tmpBudget) return `${tmpName} hit the ${Money(tmpBudget)} target${tmpActual > tmpBudget ? ` with ${Money(tmpActual - tmpBudget)} to spare` : ''}.`;
    return `${tmpName} came in ${Money(tmpBudget - tmpActual)} under the ${Money(tmpBudget)} target.`;
}

function ChangeSentence(pRows, pField, pBuild)
{
    if (pRows.length < 2) return null;
    const tmpNow = Num(pRows[pRows.length - 1][pField]);
    const tmpBefore = Num(pRows[pRows.length - 2][pField]);
    if (tmpNow === null || tmpBefore === null) return null;
    return pBuild(tmpNow - tmpBefore, tmpNow, Text(pRows[pRows.length - 2].Month, 20));
}

function NetWorthSentence(pRows)
{
    return ChangeSentence(pRows, 'Net Worth ($)', (pDelta, pNow) =>
    {
        if (pDelta === 0) return `Net worth held at ${Money(pNow)}.`;
        return `Net worth ${pDelta > 0 ? 'rose' : 'fell'} ${Money(pDelta)} to ${pNow < 0 ? '-' : ''}${Money(pNow)}.`;
    });
}

function SpendingSentence(pRows)
{
    return ChangeSentence(pRows, 'Spending ($)', (pDelta, pNow, pPrevMonth) =>
    {
        const tmpVs = pPrevMonth ? ` than ${pPrevMonth}` : ' than last month';
        if (pDelta === 0) return `Total spending was the same as ${pPrevMonth || 'last month'}.`;
        return `Total spending was ${Money(pDelta)} ${pDelta > 0 ? 'higher' : 'lower'}${tmpVs}.`;
    });
}

function DebtSentence(pDebtRows)
{
    const tmpWithApr = pDebtRows
        .map((pR) => ({ name: Text(pR.Debt), apr: Num(pR['APR (%)']), balance: Num(pR['Balance ($)']) }))
        .filter((pD) => pD.name && pD.apr !== null && (pD.balance ?? 1) > 0);
    if (!tmpWithApr.length) return null;
    const tmpTop = tmpWithApr.reduce((pBest, pD) => (pD.apr > pBest.apr ? pD : pBest));
    return `The ${tmpTop.name} is the ${tmpTop.apr}% APR one, so it's first in line for extra payments.`;
}

// ------------------------------------------------------------
// Report
// ------------------------------------------------------------

/**
 * @param {Record<string, object[]>} pSheets  rows keyed by sheet name
 * @param {{ year?: number, name?: string }} [pOptions]
 */
export function BuildReport(pSheets, pOptions = {})
{
    const tmpBudget = RowsOf(pSheets, 'budget');
    const tmpSpending = RowsOf(pSheets, 'spending');
    const tmpNetWorth = RowsOf(pSheets, 'networth');
    const tmpDebts = RowsOf(pSheets, 'debts');

    const tmpYear = Number.isInteger(pOptions.year) ? pOptions.year : new Date().getFullYear();
    const tmpMonth = Text(tmpSpending[tmpSpending.length - 1]?.Month, 20) || 'This month';
    const tmpProfileName = RowsOf(pSheets, 'profile').find((pR) => /^name$/i.test(String(pR.Field)))?.Value;
    const tmpName = Text(pOptions.name || tmpProfileName || 'Monthly report', 40);

    const tmpBudgetTotal = tmpBudget.reduce((pSum, pR) => pSum + (Num(pR['Budget ($)']) ?? 0), 0);
    const tmpSpentTotal = tmpBudget.reduce((pSum, pR) => pSum + (Num(pR['Actual ($)']) ?? 0), 0);

    const tmpCaption = [
        OverSentence(tmpBudget),
        SavingsSentence(tmpBudget),
        NetWorthSentence(tmpNetWorth),
        SpendingSentence(tmpSpending),
        DebtSentence(tmpDebts),
    ].filter(Boolean).join(' ').slice(0, MAX_CAPTION);

    return {
        name: tmpName,
        month: tmpMonth,
        year: tmpYear,
        monthNumber: MonthNumber(tmpMonth),
        budgetTotal: Math.round(tmpBudgetTotal),
        spentTotal: Math.round(tmpSpentTotal),
        caption: tmpCaption,
    };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function MonthNumber(pMonth)
{
    const tmpI = MONTHS.indexOf(String(pMonth).trim().slice(0, 3).toLowerCase());
    return tmpI === -1 ? null : tmpI + 1;
}

/** money-report-2026-11.pdf, or money-report-2026.pdf when the month isn't a month name */
export function PdfName(pReport)
{
    const tmpMm = pReport.monthNumber ? `-${String(pReport.monthNumber).padStart(2, '0')}` : '';
    return `money-report-${pReport.year}${tmpMm}.pdf`;
}

// ------------------------------------------------------------
// Board update
// ------------------------------------------------------------
const PATCHES = {
    w_title: (pR) => ({ text: `${pR.name} · ${pR.month} ${pR.year}`.slice(0, 80) }),
    w_where: (pR) => ({ title: `Where ${pR.month} went`.slice(0, 80) }),
    w_note: (pR) => ({ body: pR.caption }),
    w_spent: (pR) => ({ alertAt: pR.budgetTotal, warnAt: Math.round(pR.budgetTotal * WARN_SHARE), higherIs: 'bad' }),
};

/**
 * New definition with the month-specific widgets updated. Never mutates.
 * @returns {{ definition: object, warnings: string[] }}
 */
export function ApplyReport(pDefinition, pReport)
{
    const tmpWidgets = Array.isArray(pDefinition?.widgets) ? pDefinition.widgets : [];
    const tmpFound = new Set();
    const tmpNext = tmpWidgets.map((pW) =>
    {
        const tmpPatch = PATCHES[pW?.id];
        if (!tmpPatch) return pW;
        tmpFound.add(pW.id);
        return { ...pW, config: { ...pW.config, ...tmpPatch(pReport) } };
    });
    const tmpWarnings = Object.keys(PATCHES)
        .filter((pId) => !tmpFound.has(pId))
        .map((pId) => `Board has no widget "${pId}", so it wasn't updated.`);
    return { definition: { ...pDefinition, widgets: tmpNext }, warnings: tmpWarnings };
}
