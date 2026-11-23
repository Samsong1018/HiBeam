const _apiUrl = "/api/dashboards";

let _dashboards = [];
let _pendingDeleteId = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const _elGrid    = document.getElementById("dashboard-grid");
const _elLoading = document.getElementById("dashboard-loading");
const _elEmpty   = document.getElementById("dashboard-empty");
const _elError   = document.getElementById("dashboard-error");
const _elToast   = document.getElementById("toast");

// Delete dialog refs (may not exist on pages that only use script.js for sign-out)
const _elDeleteDialog = document.getElementById("delete-dialog");
const _elDeleteDesc   = document.getElementById("delete-dialog-desc");
const _elDeleteCancel = document.getElementById("delete-cancel-btn");
const _elDeleteOk     = document.getElementById("delete-confirm-btn");

// ── Relative time ─────────────────────────────────────────────────────────────
function RelativeTime(pDateStr)
{
    if (!pDateStr) return "—";

    const tmpMs   = Date.now() - new Date(pDateStr).getTime();
    const tmpSecs = Math.floor(tmpMs / 1000);
    const tmpMins = Math.floor(tmpSecs / 60);
    const tmpHrs  = Math.floor(tmpMins / 60);
    const tmpDays = Math.floor(tmpHrs  / 24);

    if (tmpDays > 30)  return "over a month ago";
    if (tmpDays > 1)   return `${tmpDays} days ago`;
    if (tmpDays === 1) return "yesterday";
    if (tmpHrs  > 1)   return `${tmpHrs} hours ago`;
    if (tmpHrs  === 1) return "1 hour ago";
    if (tmpMins > 1)   return `${tmpMins} minutes ago`;
    if (tmpMins === 1) return "1 minute ago";
    return "just now";
}

function FullDate(pDateStr)
{
    if (!pDateStr) return "";
    return new Date(pDateStr).toLocaleString();
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let _toastTimer = null;

function ShowToast(pMsg, pIsError = false)
{
    if (!_elToast) return;
    clearTimeout(_toastTimer);

    _elToast.textContent = pMsg;
    _elToast.classList.toggle("is-error", pIsError);
    _elToast.classList.add("is-visible");

    _toastTimer = setTimeout(() =>
    {
        _elToast.classList.remove("is-visible");
    }, 3500);
}

// ── Visibility helpers ────────────────────────────────────────────────────────
function ShowState(pState)
{
    // pState: "loading" | "empty" | "error" | "grid"
    if (_elLoading) _elLoading.hidden = pState !== "loading";
    if (_elEmpty)   _elEmpty.hidden   = pState !== "empty";
    if (_elError)   _elError.hidden   = pState !== "error";
    if (_elGrid)    _elGrid.hidden    = pState !== "grid";
}

// ── Build a single card ───────────────────────────────────────────────────────
function BuildCard(pDash)
{
    const tmpLi = document.createElement("li");

    // Clickable body → view.html
    const tmpLink = document.createElement("a");
    tmpLink.className  = "card-body";
    tmpLink.href       = `view.html?id=${encodeURIComponent(pDash.id)}`;

    const tmpName = document.createElement("h2");
    tmpName.className  = "card-name";
    tmpName.textContent = pDash.name;

    const tmpMeta = document.createElement("div");
    tmpMeta.className  = "card-meta";

    const tmpUpdated = document.createElement("span");
    tmpUpdated.className   = "card-updated";
    tmpUpdated.textContent = `Updated ${RelativeTime(pDash.updatedAt)}`;
    tmpUpdated.title       = FullDate(pDash.updatedAt);

    tmpMeta.appendChild(tmpUpdated);

    // Public/private badge (only when the API provides the field)
    if (typeof pDash.isPublic === "boolean")
    {
        const tmpBadge = document.createElement("span");
        tmpBadge.className         = "card-badge";
        tmpBadge.dataset.public    = String(pDash.isPublic);
        tmpBadge.textContent       = pDash.isPublic ? "Public" : "Private";
        tmpMeta.appendChild(tmpBadge);
    }

    tmpLink.append(tmpName, tmpMeta);

    // Footer: Edit button + Delete icon
    const tmpFooter = document.createElement("div");
    tmpFooter.className = "card-footer";

    const tmpEdit = document.createElement("a");
    tmpEdit.className   = "btn btn-ghost card-edit";
    tmpEdit.href        = `edit.html?id=${encodeURIComponent(pDash.id)}`;
    tmpEdit.textContent = "Edit";
    tmpEdit.setAttribute("aria-label", `Edit ${pDash.name}`);

    const tmpDelete = document.createElement("button");
    tmpDelete.type      = "button";
    tmpDelete.className = "card-delete";
    tmpDelete.dataset.id = pDash.id;
    tmpDelete.setAttribute("aria-label", `Delete ${pDash.name}`);

    // Inline SVG trash icon (no external library)
    const tmpSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    tmpSvg.setAttribute("viewBox", "0 0 24 24");
    tmpSvg.setAttribute("fill", "none");
    tmpSvg.setAttribute("stroke", "currentColor");
    tmpSvg.setAttribute("stroke-width", "1.75");
    tmpSvg.setAttribute("stroke-linecap", "round");
    tmpSvg.setAttribute("stroke-linejoin", "round");
    tmpSvg.setAttribute("aria-hidden", "true");
    tmpSvg.innerHTML =
        '<polyline points="3 6 5 6 21 6"/>' +
        '<path d="M19 6l-1 14H6L5 6"/>' +
        '<path d="M10 11v6M14 11v6"/>' +
        '<path d="M9 6V4h6v2"/>';
    tmpDelete.appendChild(tmpSvg);

    tmpFooter.append(tmpEdit, tmpDelete);
    tmpLi.className = "card";
    tmpLi.append(tmpLink, tmpFooter);

    return tmpLi;
}

// ── Render list ───────────────────────────────────────────────────────────────
function RenderDashboards(pItems)
{
    if (!_elGrid) return;

    if (pItems.length === 0)
    {
        ShowState("empty");
        return;
    }

    _elGrid.textContent = ""; // clear safely

    pItems.forEach((pDash) =>
    {
        _elGrid.appendChild(BuildCard(pDash));
    });

    ShowState("grid");
}

// ── Delete flow (dialog-based) ────────────────────────────────────────────────
function OpenDeleteDialog(pId)
{
    const tmpTarget = _dashboards.find((pDash) => pDash.id === pId);
    if (!tmpTarget || !_elDeleteDialog) return;

    _pendingDeleteId = pId;

    if (_elDeleteDesc)
    {
        // Set description text safely via textContent
        _elDeleteDesc.textContent = "";
        const tmpStrong = document.createElement("strong");
        tmpStrong.textContent = tmpTarget.name;
        _elDeleteDesc.append("Delete \u201C", tmpStrong, "\u201D? This cannot be undone.");
    }

    _elDeleteDialog.showModal();
    _elDeleteCancel && _elDeleteCancel.focus();
}

function CloseDeleteDialog()
{
    _pendingDeleteId = null;
    if (_elDeleteDialog) _elDeleteDialog.close();
}

async function ConfirmDelete()
{
    const tmpId = _pendingDeleteId;
    if (!tmpId) return;

    CloseDeleteDialog();

    try
    {
        const tmpRes = await fetch(`${_apiUrl}/${encodeURIComponent(tmpId)}`, {
            method: "DELETE",
            credentials: "same-origin"
        });
        if (!tmpRes.ok) throw new Error("Delete failed: " + tmpRes.status);

        _dashboards = _dashboards.filter((pDash) => pDash.id !== tmpId);
        RenderDashboards(_dashboards);
        ShowToast("Dashboard deleted.");
    }
    catch (tmpErr)
    {
        console.error(tmpErr);
        ShowToast("Couldn't delete that dashboard.", true);
    }
}

// ── Create dashboard ──────────────────────────────────────────────────────────
async function CreateDashboard(pButton)
{
    if (pButton) pButton.disabled = true;

    try
    {
        const tmpRes = await fetch(_apiUrl, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Untitled Dashboard", widgets: [], grid: { columns: 24, showGrid: false } })
        });

        if (!tmpRes.ok) throw new Error("Failed to create dashboard: " + tmpRes.status);

        const tmpPayload = await tmpRes.json();
        const tmpId = tmpPayload.data?.id ?? tmpPayload.id;
        window.location.href = `edit.html?id=${encodeURIComponent(tmpId)}`;
    }
    catch (tmpErr)
    {
        console.error(tmpErr);
        ShowToast("Couldn't create a new dashboard.", true);
        if (pButton) pButton.disabled = false;
    }
}

// ── Load dashboards ───────────────────────────────────────────────────────────
async function LoadDashboards()
{
    ShowState("loading");

    try
    {
        const tmpRes = await fetch(_apiUrl, { credentials: "same-origin" });

        if (tmpRes.status === 401)
        {
            window.location.href = "login.html";
            return;
        }

        if (!tmpRes.ok) throw new Error("Failed to load dashboards: " + tmpRes.status);

        const tmpPayload = await tmpRes.json();
        _dashboards = Array.isArray(tmpPayload.data) ? tmpPayload.data : [];
        RenderDashboards(_dashboards);
    }
    catch (tmpErr)
    {
        console.error(tmpErr);
        ShowState("error");
    }
}

// ── Sign out ──────────────────────────────────────────────────────────────────
async function SignOut()
{
    try
    {
        await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    }
    catch (tmpErr)
    {
        // best-effort
    }
    window.location.href = "login.html";
}

// ── Wire events ───────────────────────────────────────────────────────────────

// "New dashboard" header button
const _elNewBtn = document.getElementById("new-dashboard-btn");
if (_elNewBtn)
{
    _elNewBtn.addEventListener("click", () => CreateDashboard(_elNewBtn));
}

// "Create your first dashboard" empty-state button
const _elEmptyCreateBtn = document.getElementById("empty-create-btn");
if (_elEmptyCreateBtn)
{
    _elEmptyCreateBtn.addEventListener("click", () => CreateDashboard(_elEmptyCreateBtn));
}

// Retry button in error state
const _elRetryBtn = document.getElementById("retry-btn");
if (_elRetryBtn)
{
    _elRetryBtn.addEventListener("click", LoadDashboards);
}

// Delete icon on each card (event delegation on the grid)
if (_elGrid)
{
    _elGrid.addEventListener("click", (tmpEv) =>
    {
        const tmpBtn = tmpEv.target.closest(".card-delete");
        if (tmpBtn) OpenDeleteDialog(tmpBtn.dataset.id);
    });
}

// Delete dialog buttons
if (_elDeleteCancel) _elDeleteCancel.addEventListener("click", CloseDeleteDialog);
if (_elDeleteOk)     _elDeleteOk.addEventListener("click", ConfirmDelete);

// Close dialog on backdrop click
if (_elDeleteDialog)
{
    _elDeleteDialog.addEventListener("click", (tmpEv) =>
    {
        if (tmpEv.target === _elDeleteDialog) CloseDeleteDialog();
    });
}

// Sign out buttons (shared across all pages)
document.querySelectorAll(".nav-signout").forEach((pBtn) =>
{
    pBtn.addEventListener("click", SignOut);
});

// ── Boot ──────────────────────────────────────────────────────────────────────
if (_elGrid)
{
    LoadDashboards();
}
