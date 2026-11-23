const _apiUrl = "/api/dashboards";

let _dashboards = [];

const list = document.getElementById("dashboard-list");

function RenderDashboards(pItems)
{
    list.innerHTML = "";

    if (pItems.length === 0)
    {
        list.innerHTML = `<p class="empty-message">You have no dashboards yet.</p>`;
        list.appendChild(CreateCard());
        return;
    }

    pItems.forEach((pDash) =>
    {
        // built with textContent so a dashboard name can't inject markup
        const tmpCard = document.createElement("div");
        tmpCard.className = "card";

        const tmpEditHref = `edit.html?id=${encodeURIComponent(pDash.id)}`;
        const tmpLink = document.createElement("a");
        tmpLink.href = tmpEditHref;
        const tmpTitle = document.createElement("h2");
        tmpTitle.textContent = pDash.name;
        const tmpUpdated = document.createElement("p");
        tmpUpdated.textContent = `Last updated: ${pDash.updatedAt ? new Date(pDash.updatedAt).toLocaleDateString() : "—"}`;
        tmpLink.append(tmpTitle, tmpUpdated);

        const tmpDelete = document.createElement("button");
        tmpDelete.type = "button";
        tmpDelete.className = "card-delete";
        tmpDelete.dataset.id = pDash.id;
        tmpDelete.setAttribute("aria-label", `Delete ${pDash.name}`);
        tmpDelete.textContent = "Delete";

        // the card body opens the editor; this row adds a read-only Open next to Edit
        const tmpActions = document.createElement("div");
        tmpActions.className = "card-actions";
        const tmpOpen = document.createElement("a");
        tmpOpen.className = "btn btn-primary card-action";
        tmpOpen.href = `view.html?id=${encodeURIComponent(pDash.id)}`;
        tmpOpen.textContent = "Open";
        tmpOpen.setAttribute("aria-label", `Open ${pDash.name}`);
        const tmpEdit = document.createElement("a");
        tmpEdit.className = "btn btn-ghost card-action";
        tmpEdit.href = tmpEditHref;
        tmpEdit.textContent = "Edit";
        tmpEdit.setAttribute("aria-label", `Edit ${pDash.name}`);
        tmpActions.append(tmpOpen, tmpEdit);

        tmpCard.append(tmpLink, tmpActions, tmpDelete);
        list.appendChild(tmpCard);
    });
    list.appendChild(CreateCard());
}

async function DeleteDashboard(pId)
{
    const tmpTarget = _dashboards.find((pDash) => pDash.id === pId);
    if (!tmpTarget) return;

    if (!confirm(`Delete "${tmpTarget.name}"? This cannot be undone.`)) return;

    try
    {
        const tmpRes = await fetch(`${_apiUrl}/${encodeURIComponent(pId)}`, {
            method: "DELETE",
            credentials: "same-origin"
        });
        if (!tmpRes.ok) throw new Error("Delete failed: " + tmpRes.status);

        _dashboards = _dashboards.filter((pDash) => pDash.id !== pId);
        RenderDashboards(_dashboards);
    }
    catch (tmpErr)
    {
        console.error(tmpErr);
        alert("Couldn't delete that dashboard.");
    }
}

function CreateCard()
{
    const tmpEl = document.createElement("div");
    tmpEl.className = "card card-create";
    tmpEl.innerHTML = `<button type="button" class="card-create-btn">
        <h2> + Create new dashboard</h2>
        </button>
        `;
    return tmpEl;
}

async function CreateDashboard(pButton)
{
    pButton.disabled = true;

    try
    {
        const tmpResponse = await fetch(_apiUrl, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Untitled Dashboard", widgets: [], grid: { columns: 24, showGrid: false } })
        });
        if (!tmpResponse.ok) throw new Error("Failed to create dashboard: " + tmpResponse.status);

        const tmpPayload = await tmpResponse.json();
        const tmpId = tmpPayload.data?.id ?? tmpPayload.id;
        window.location.href = `edit.html?id=${encodeURIComponent(tmpId)}`;
    }
    catch (tmpErr)
    {
        console.error(tmpErr);
        alert("Couldn't create new dashboard.");
        pButton.disabled = false;
    }
}

async function LoadDashboards()
{
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
        list.innerHTML = `<p class="empty-message">Couldn't load dashboards. Please refresh.</p>`;
    }
}

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

if (list)
{
    list.addEventListener("click", (tmpEvent) =>
    {
        const tmpDeleteBtn = tmpEvent.target.closest(".card-delete");
        if (tmpDeleteBtn) DeleteDashboard(tmpDeleteBtn.dataset.id);

        const tmpCreateBtn = tmpEvent.target.closest(".card-create-btn");
        if (tmpCreateBtn) CreateDashboard(tmpCreateBtn);
    });

    LoadDashboards();
}

document.querySelectorAll(".nav-signout").forEach((pBtn) =>
{
    pBtn.addEventListener("click", SignOut);
});
