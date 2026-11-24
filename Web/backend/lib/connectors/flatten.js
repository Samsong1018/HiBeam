'use strict';

/*
  Flattens one REST/JSON row so every value is a primitive the editor can bind to a field.

  Rules:
  - Nested plain objects become dotted keys: { user: { name: 'x' } } -> { 'user.name': 'x' }.
    Keys hold at most MAX_DEPTH segments ('a.b.c'); an object still left at that depth becomes
    a short JSON string (capped at MAX_TEXT characters).
  - An array of primitives (string / number / boolean / null) becomes one comma-joined string,
    capped at MAX_TEXT characters: tags: ['a', 'b'] -> tags: 'a, b'. An empty array becomes ''.
  - An array holding any object or nested array becomes its length: items: [{..}, {..}] -> items: 2.
    A count is chartable and stays readable in a table; the items themselves don't fit one cell.
  - Key segments named __proto__, constructor or prototype are skipped, with everything under them.
  - The first value written for a key wins ({ 'a.b': 1, a: { b: 2 } } -> 'a.b': 1).
  - A row keeps at most MAX_KEYS keys; the rest are dropped.
  The input is never mutated.
*/

const MAX_DEPTH = 3;
const MAX_KEYS = 100;
const MAX_TEXT = 200;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function IsPlainObject(pValue)
{
  if (pValue === null || typeof pValue !== 'object' || Array.isArray(pValue)) return false;
  const tmpProto = Object.getPrototypeOf(pValue);
  return tmpProto === Object.prototype || tmpProto === null;
}

function IsPrimitive(pValue)
{
  return pValue === null || ['string', 'number', 'boolean'].includes(typeof pValue);
}

function Cap(pText)
{
  return pText.length > MAX_TEXT ? `${pText.slice(0, MAX_TEXT - 1)}…` : pText;
}

function ShortJson(pValue)
{
  try
  {
    return Cap(String(JSON.stringify(pValue)));
  }
  catch (tmpErr)
  {
    return '';
  }
}

function FlattenArray(pList)
{
  if (pList.every(IsPrimitive)) return Cap(pList.map((pItem) => (pItem === null ? '' : String(pItem))).join(', '));
  return pList.length;
}

function Put(pOut, pKey, pValue)
{
  if (Object.keys(pOut).length >= MAX_KEYS || Object.prototype.hasOwnProperty.call(pOut, pKey)) return;
  pOut[pKey] = pValue;
}

function Walk(pOut, pObject, pPrefix, pDepth)
{
  for (const tmpName of Object.keys(pObject))
  {
    if (Object.keys(pOut).length >= MAX_KEYS) return;
    if (UNSAFE_KEYS.has(tmpName)) continue;
    const tmpKey = pPrefix ? `${pPrefix}.${tmpName}` : tmpName;
    const tmpValue = pObject[tmpName];
    if (IsPrimitive(tmpValue)) Put(pOut, tmpKey, tmpValue);
    else if (Array.isArray(tmpValue)) Put(pOut, tmpKey, FlattenArray(tmpValue));
    else if (IsPlainObject(tmpValue) && pDepth < MAX_DEPTH) Walk(pOut, tmpValue, tmpKey, pDepth + 1);
    else if (tmpValue !== undefined && typeof tmpValue !== 'function') Put(pOut, tmpKey, ShortJson(tmpValue));
  }
}

// pRow is a plain object; returns a new plain object whose values are all primitives.
function FlattenRow(pRow)
{
  const tmpOut = {};
  if (IsPlainObject(pRow)) Walk(tmpOut, pRow, '', 1);
  return tmpOut;
}

module.exports = { FlattenRow, MAX_DEPTH, MAX_KEYS, MAX_TEXT };
