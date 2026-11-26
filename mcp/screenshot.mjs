// ============================================================
// Board screenshots for the MCP server
// Opens /view/<id> in headless Chromium with the MCP session's cookie,
// lets the real client code fetch the data and draw every widget, then
// captures the #board element as a PNG. Nothing is re-rendered on the
// server: the agent sees exactly what a person opening the link sees.
//
// Playwright is an optional dependency, loaded only when a screenshot is
// asked for, so the rest of the MCP server works without it.
// ============================================================

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 375, height: 812 } };
const RENDER_TIMEOUT_MS = 30000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

async function LoadChromium()
{
    try
    {
        const { chromium } = await import('playwright');
        return chromium;
    }
    catch
    {
        throw new Error('Screenshots need Playwright. Run: npm install playwright && npx playwright install --only-shell chromium');
    }
}

// pOpts: { baseUrl, cookie: 'sid=...' | null, id, viewport: 'desktop'|'mobile', colorScheme: 'light'|'dark', scale: 1|2 }
// Returns { png: Buffer, notes: string[] }.
export async function ScreenshotBoard({ baseUrl, cookie, id, viewport = 'desktop', colorScheme = 'light', scale = 1 })
{
    if (!ID_RE.test(id)) throw new Error('That is not a valid dashboard id.');

    const tmpChromium = await LoadChromium();
    let tmpBrowser;
    try
    {
        tmpBrowser = await tmpChromium.launch({ headless: true });
    }
    catch (pErr)
    {
        throw new Error(`Couldn't start headless Chromium (${pErr.message.split('\n')[0]}). Run: npx playwright install --only-shell chromium`);
    }

    try
    {
        const tmpContext = await tmpBrowser.newContext({
            viewport: VIEWPORTS[viewport],
            deviceScaleFactor: scale,
            colorScheme,
            // charts and tile entrances skip their animations, so the first paint is the final one
            reducedMotion: 'reduce',
        });
        if (cookie)
        {
            const [tmpName, ...tmpRest] = cookie.split('=');
            await tmpContext.addCookies([{ name: tmpName, value: tmpRest.join('='), url: baseUrl }]);
        }

        const tmpPage = await tmpContext.newPage();
        const tmpNotes = [];
        tmpPage.on('pageerror', (pErr) => tmpNotes.push(`Page error: ${pErr.message}`));

        await tmpPage.goto(`${baseUrl}/view/${encodeURIComponent(id)}`, { waitUntil: 'domcontentloaded', timeout: RENDER_TIMEOUT_MS });
        await tmpPage.waitForFunction(
            () => document.documentElement.dataset.boardRendered === 'true' || location.pathname === '/login',
            null,
            { timeout: RENDER_TIMEOUT_MS },
        ).catch(() => { throw new Error(`The board didn't finish rendering within ${RENDER_TIMEOUT_MS / 1000}s.`); });

        if (new URL(tmpPage.url()).pathname === '/login') throw new Error('The viewer sent the session to the login page. Check HIBEAM_USERNAME/HIBEAM_PASSWORD.');
        const tmpFatal = await tmpPage.locator('.view-fatal h1').textContent({ timeout: 500 }).catch(() => null);
        if (tmpFatal) throw new Error(`The viewer shows "${tmpFatal}" for ${id}.`);

        // web fonts and Chart.js's resize pass settle before the capture. The sticky site
        // header (and any toast) is hidden, or the scrolling capture paints it over the board.
        await tmpPage.evaluate(async () =>
        {
            for (const tmpEl of document.querySelectorAll('body *'))
            {
                const tmpPos = getComputedStyle(tmpEl).position;
                if ((tmpPos === 'fixed' || tmpPos === 'sticky') && !tmpEl.closest('#board')) tmpEl.style.visibility = 'hidden';
            }
            await document.fonts.ready;
            await new Promise((pResolve) => requestAnimationFrame(() => requestAnimationFrame(pResolve)));
        });

        // widgets showing an error or empty state, so the agent doesn't have to spot them in the image
        const tmpProblems = await tmpPage.$$eval('#board .widget-message', (pEls) => pEls.map((pEl) =>
        {
            const tmpLabel = pEl.closest('article.widget')?.getAttribute('aria-label') || 'Widget';
            const tmpText = pEl.innerText.replace(/\s*Try again\s*$/, '').replace(/\s+/g, ' ').trim();
            return `${tmpLabel}: ${tmpText}`;
        }));

        const tmpPng = await tmpPage.locator('#board').screenshot({ type: 'png', animations: 'disabled' });
        return { png: tmpPng, notes: [...tmpProblems, ...tmpNotes] };
    }
    finally
    {
        await tmpBrowser.close();
    }
}
