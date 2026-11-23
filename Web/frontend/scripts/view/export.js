// ============================================================
// EXPORT
// Captures the live #board element as a PNG or PDF using
// html2canvas (DOM → canvas) and jsPDF (canvas → PDF).
// Both libraries are loaded from CDN in view.html. It's
// html2canvas-pro, not html2canvas 1.4.1: the original can't parse
// the color() values Chrome computes for color-mix(), which the
// table widget's borders use, and the export fails.
// ============================================================

import { toast } from '../editor/dom.js';

// Wait for html2canvas and jsPDF to be available on window.
// They're classic <script> tags ahead of this module, so they're
// normally ready already; this guards against a slow CDN.
function WaitForLibs()
{
    return new Promise((pResolve, pReject) =>
    {
        const tmpMax = 50;
        let tmpTries = 0;

        function Check()
        {
            if (window.html2canvas && window.jspdf?.jsPDF)
            {
                pResolve();
            }
            else if (++tmpTries >= tmpMax)
            {
                pReject(new Error('Export libraries did not load in time.'));
            }
            else
            {
                setTimeout(Check, 100);
            }
        }

        Check();
    });
}

// Capture the board element to a canvas.
// Returns a HTMLCanvasElement at 2× device-pixel density for sharp output.
async function CaptureBoard(pBoard)
{
    return window.html2canvas(pBoard, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        backgroundColor: getComputedStyle(document.documentElement)
            .getPropertyValue('--color-bg').trim() || '#f5f1ec',
        logging: false,
        // Include the full scrollable height so off-screen widgets aren't clipped.
        height: pBoard.scrollHeight,
        windowHeight: pBoard.scrollHeight,
        onclone: FreezeAnimations,
    });
}

// html2canvas renders a cloned copy of the page, and CSS animations restart
// in the clone. Without this the tileIn entrance animation is caught at its
// first frame and tiles come out faded or missing.
function FreezeAnimations(pDoc)
{
    const tmpStyle = pDoc.createElement('style');
    tmpStyle.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
    pDoc.head.append(tmpStyle);
}

// Download a canvas as a PNG file.
function DownloadPng(pCanvas, pName)
{
    const tmpLink = document.createElement('a');
    tmpLink.download = `${pName}.png`;
    tmpLink.href = pCanvas.toDataURL('image/png');
    tmpLink.click();
}

// Download a canvas wrapped in a PDF page sized to fit the image.
function DownloadPdf(pCanvas, pName)
{
    const { jsPDF } = window.jspdf;
    const tmpPxW = pCanvas.width;
    const tmpPxH = pCanvas.height;

    // Convert px → mm at 96 dpi * scale(2) = 192 dpi effective.
    // We used scale:2 when capturing, so divide by 2 first to get logical px.
    const tmpMmW = (tmpPxW / 2) * 25.4 / 96;
    const tmpMmH = (tmpPxH / 2) * 25.4 / 96;

    const tmpOrientation = tmpMmW >= tmpMmH ? 'l' : 'p';
    const tmpDoc = new jsPDF({ orientation: tmpOrientation, unit: 'mm', format: [tmpMmW, tmpMmH] });
    const tmpImgData = pCanvas.toDataURL('image/png');
    tmpDoc.addImage(tmpImgData, 'PNG', 0, 0, tmpMmW, tmpMmH, '', 'FAST');
    tmpDoc.save(`${pName}.pdf`);
}

// ------------------------------------------------------------
// Public API: wire up the Export button.
//
// pBtnEl   - the <button> element to attach the click handler to
// pBoardEl - the #board section to capture
// GetName  - function that returns the current dashboard name string
// ------------------------------------------------------------
export function WireExportButton(pBtnEl, pBoardEl, GetName)
{
    pBtnEl.addEventListener('click', () => ShowExportMenu(pBtnEl, pBoardEl, GetName));
}

let _closeMenu = null;

function ShowExportMenu(pBtnEl, pBoardEl, GetName)
{
    // Second click on the button closes the open menu.
    if (_closeMenu)
    {
        _closeMenu();
        return;
    }

    const tmpMenu = document.createElement('div');
    tmpMenu.id = 'export-menu';
    tmpMenu.className = 'export-menu';
    tmpMenu.setAttribute('role', 'menu');
    tmpMenu.setAttribute('aria-label', 'Export format');

    const tmpPng = document.createElement('button');
    tmpPng.type = 'button';
    tmpPng.className = 'export-menu-item';
    tmpPng.setAttribute('role', 'menuitem');
    tmpPng.textContent = 'Export as PNG';

    const tmpPdf = document.createElement('button');
    tmpPdf.type = 'button';
    tmpPdf.className = 'export-menu-item';
    tmpPdf.setAttribute('role', 'menuitem');
    tmpPdf.textContent = 'Export as PDF';

    tmpMenu.append(tmpPng, tmpPdf);
    document.body.append(tmpMenu);

    // Position below the trigger button.
    PositionMenu(tmpMenu, pBtnEl);

    function CloseMenu()
    {
        _closeMenu = null;
        pBtnEl.setAttribute('aria-expanded', 'false');
        tmpMenu.remove();
        document.removeEventListener('click', OnDocClick, true);
        document.removeEventListener('keydown', OnKey);
    }

    function OnDocClick(pEvt)
    {
        if (!tmpMenu.contains(pEvt.target) && pEvt.target !== pBtnEl)
        {
            CloseMenu();
        }
    }

    function OnKey(pEvt)
    {
        if (pEvt.key === 'Escape') CloseMenu();
    }

    _closeMenu = CloseMenu;
    pBtnEl.setAttribute('aria-expanded', 'true');

    // Delay so the opening click doesn't immediately close the menu.
    setTimeout(() =>
    {
        document.addEventListener('click', OnDocClick, true);
        document.addEventListener('keydown', OnKey);
    }, 0);

    tmpPng.addEventListener('click', async () =>
    {
        CloseMenu();
        await RunExport('png', pBtnEl, pBoardEl, GetName);
    });

    tmpPdf.addEventListener('click', async () =>
    {
        CloseMenu();
        await RunExport('pdf', pBtnEl, pBoardEl, GetName);
    });
}

function PositionMenu(pMenuEl, pAnchorEl)
{
    const tmpRect = pAnchorEl.getBoundingClientRect();
    const tmpScrollY = window.scrollY;
    const tmpScrollX = window.scrollX;

    pMenuEl.style.position = 'absolute';
    pMenuEl.style.top = `${tmpRect.bottom + tmpScrollY + 6}px`;
    pMenuEl.style.left = `${tmpRect.left + tmpScrollX}px`;
    pMenuEl.style.minWidth = `${Math.max(tmpRect.width, 160)}px`;
}

async function RunExport(pFormat, pBtnEl, pBoardEl, GetName)
{
    pBtnEl.disabled = true;
    pBtnEl.classList.add('is-loading');

    try
    {
        await WaitForLibs();

        const tmpCanvas = await CaptureBoard(pBoardEl);
        const tmpName = (GetName() || 'dashboard').replace(/[/\\:*?"<>|]/g, '-');

        if (pFormat === 'png')
        {
            DownloadPng(tmpCanvas, tmpName);
            toast('PNG downloaded');
        }
        else
        {
            DownloadPdf(tmpCanvas, tmpName);
            toast('PDF downloaded');
        }
    }
    catch (tmpErr)
    {
        console.error('Export failed:', tmpErr);
        toast('Export failed · try again', true);
    }
    finally
    {
        pBtnEl.disabled = false;
        pBtnEl.classList.remove('is-loading');
    }
}
