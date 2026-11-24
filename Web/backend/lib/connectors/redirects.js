'use strict';

// GET that follows a few redirects safely. Every hop is re-parsed (http/https only, no
// userinfo), re-resolved and re-pinned through the caller's ResolveSafeAddress, so a redirect
// to a private address is refused exactly like a private URL typed in by the user.

const MAX_HOPS = 3;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

class HopError extends Error
{
  constructor(pCode)
  {
    super(pCode);
    this.code = pCode; // 'tooManyRedirects' | 'badRedirect' | 'insecureRedirect'
  }
}

function LocationOf(pRes)
{
  const tmpHeaders = pRes && pRes.headers;
  if (!tmpHeaders || typeof tmpHeaders !== 'object') return null;
  const tmpValue = tmpHeaders.location !== undefined ? tmpHeaders.location : tmpHeaders.Location;
  const tmpText = Array.isArray(tmpValue) ? tmpValue[0] : tmpValue;
  return typeof tmpText === 'string' && tmpText.trim() !== '' ? tmpText.trim() : null;
}

// pDeps: { parseUrl(text) -> URL, resolveSafe(URL) -> address, transport(req), transportError(err) -> Error }
// The transport must return { status, headers, body }; redirects need headers.location.
// Returns the final { status, body } (status is never a followed 3xx). The bearer header is only
// sent to the origin the user entered, never to the host a redirect points at.
async function FetchFollowing(pUrlText, pHeaders, pDeps, pSignal)
{
  let tmpUrl = pDeps.parseUrl(pUrlText);
  const tmpOrigin = tmpUrl.origin;
  for (let tmpHop = 0; tmpHop <= MAX_HOPS; tmpHop += 1)
  {
    const tmpAddress = await pDeps.resolveSafe(tmpUrl);
    const tmpHeaders = { ...pHeaders };
    if (tmpUrl.origin !== tmpOrigin) delete tmpHeaders.Authorization;
    let tmpRes;
    try
    {
      tmpRes = await pDeps.transport({ url: tmpUrl.toString(), address: tmpAddress, headers: tmpHeaders, signal: pSignal });
    }
    catch (tmpErr)
    {
      throw pDeps.transportError(tmpErr);
    }
    const tmpStatus = tmpRes && tmpRes.status;
    if (!REDIRECT_CODES.has(tmpStatus)) return { status: tmpStatus, body: tmpRes ? tmpRes.body : '' };
    const tmpLocation = LocationOf(tmpRes);
    if (!tmpLocation) throw new HopError('badRedirect');
    let tmpNext;
    try
    {
      tmpNext = new URL(tmpLocation, tmpUrl);
    }
    catch (tmpErr)
    {
      throw new HopError('badRedirect');
    }
    tmpNext.hash = '';
    if (tmpUrl.protocol === 'https:' && tmpNext.protocol !== 'https:') throw new HopError('insecureRedirect');
    tmpUrl = pDeps.parseUrl(tmpNext.toString()); // re-checks scheme and userinfo on every hop
  }
  throw new HopError('tooManyRedirects');
}

module.exports = { FetchFollowing, HopError, MAX_HOPS, REDIRECT_CODES };
