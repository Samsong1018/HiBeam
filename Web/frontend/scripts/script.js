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
        const tmpCard = document.createElement("div");
        tmpCard.className = "card";
        tmpCard.innerHTML = `
        <a href="edit.html?id=${encodeURIComponent(pDash.id)}">
        <h2>${pDash.name}</h2>
        <p>Last updated: ${pDash.updatedAt ? new Date(pDash.updatedAt).toLocaleDateString() : "—"}</p>
        </a>
        <button type="button" class="card-delete" data-id="${pDash.id}"
            aria-label="Delete ${pDash.name}">Delete</button>
        `;
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
