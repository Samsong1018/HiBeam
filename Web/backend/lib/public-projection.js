'use strict';

/*
  Anonymous viewers of a public dashboard only get the columns its widgets display, not every
  column a source returns. A chart or KPI shows its binding's xField / yField; a table shows its
  chosen `columns`, or every column when none are chosen (the owner picked "show all", so all
  columns are already on screen). A widget with a "gone quiet" check also gets its `quietField`,
  the timestamp column the check reads (only its age is shown, but the value has to reach the page).
  An uptime strip (`status`) also gets its `timeField`, the column its checks are ordered by.

  AllowedFields(def) -> Map<sourceId, Set<string> | null>   null = all columns allowed
  ProjectRows(rows, fields) -> new rows holding only the allowed keys (input is not mutated)
*/

const ALL = null;

function IsPlainObject(pValue)
{
  return pValue !== null && typeof pValue === 'object' && !Array.isArray(pValue);
}

function AddField(pSet, pField)
{
  if (typeof pField === 'string' && pField !== '') pSet.add(pField);
}

function AllowedFields(pDef)
{
  const tmpAllowed = new Map();
  const tmpWidgets = IsPlainObject(pDef) && Array.isArray(pDef.widgets) ? pDef.widgets : [];

  for (const tmpWidget of tmpWidgets)
  {
    const tmpConfig = IsPlainObject(tmpWidget) && IsPlainObject(tmpWidget.config) ? tmpWidget.config : {};
    const tmpBindings = Array.isArray(tmpConfig.bindings) ? tmpConfig.bindings : [];
    const tmpColumns = Array.isArray(tmpConfig.columns) ? tmpConfig.columns.filter((pCol) => typeof pCol === 'string' && pCol !== '') : [];
    const tmpShowsAll = tmpWidget.type === 'table' && tmpColumns.length === 0;

    for (const tmpBinding of tmpBindings)
    {
      if (!IsPlainObject(tmpBinding) || typeof tmpBinding.sourceId !== 'string' || tmpBinding.sourceId === '') continue;
      const tmpId = tmpBinding.sourceId;
      if (tmpAllowed.get(tmpId) === ALL) continue; // undefined (unseen) !== null (all)
      if (tmpShowsAll)
      {
        tmpAllowed.set(tmpId, ALL);
        continue;
      }
      const tmpSet = tmpAllowed.get(tmpId) || new Set();
      AddField(tmpSet, tmpBinding.xField);
      AddField(tmpSet, tmpBinding.yField);
      if (Number(tmpConfig.quietAfter) > 0) AddField(tmpSet, tmpConfig.quietField);
      if (tmpWidget.type === 'status') AddField(tmpSet, tmpConfig.timeField);
      if (tmpWidget.type === 'table') tmpColumns.forEach((pCol) => tmpSet.add(pCol));
      tmpAllowed.set(tmpId, tmpSet);
    }
  }
  return tmpAllowed;
}

function ProjectRows(pRows, pFields)
{
  if (!Array.isArray(pRows)) return [];
  if (pFields === ALL) return pRows.map((pRow) => (IsPlainObject(pRow) ? { ...pRow } : {}));
  const tmpFields = pFields instanceof Set ? [...pFields] : [];
  return pRows.map((pRow) =>
  {
    const tmpOut = {};
    if (!IsPlainObject(pRow)) return tmpOut;
    for (const tmpField of tmpFields)
    {
      if (Object.prototype.hasOwnProperty.call(pRow, tmpField)) tmpOut[tmpField] = pRow[tmpField];
    }
    return tmpOut;
  });
}

module.exports = { AllowedFields, ProjectRows };
