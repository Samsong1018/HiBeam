const API_URL = "http://localhost:3000/api/dashboards";

let dashboards = [
    
    {   id: "d_1", name: "Sales", date_updated: "2026-03-12" },
    {   id: "d_2", name: "Salary", date_updated: "2026-03-13"},
    {   id: "d_3", name: "Support Tickets", date_updated: "2026-03-14"},
    {   id: "d_4", name: "Sales2", date_updated: "2026-03-12" },
    {   id: "d_5", name: "Salary2", date_updated: "2026-03-13"},
    {   id: "d_6", name: "Really long ass fucking thing", date_updated: "2026-03-13"},
    {   id: "d_7", name: "Support Tickets2", date_updated: "2026-03-14"}
];

const list = document.getElementById("dashboard-list");

function renderDashboards(items){
    list.innerHTML = "";

    if (items.length === 0){
        list.innerHTML = `<p class="empty-message">You have no dashboards yet.</p>`;
        list.appendChild(createCard());
        return;
    }

    items.forEach((d) => {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `
        <a href="dashboard.html?id=${d.id}">
        <h2>${d.name}</h2>
        <p>Last updated: ${d.date_updated}</p>
        </a>
        <button type="button" class="card-delete" data-id="${d.id}"
            aria-label="Delete ${d.name}">Delete</button>
        `;
        list.appendChild(card);
    });
    list.appendChild(createCard());
}

function deleteDashboard(id) {
    const target = dashboards.find((d) => d.id === id);
    if (!target) return;
    
    if (!confirm(`Delete "${target.name}"? This cannot be undone`)) return;

    dashboards = dashboards.filter((d) => d.id !== id);
    renderDashboards(dashboards);
}

function createCard() {
    const el = document.createElement("div");
    el.className = "card card-create";
    el.innerHTML = `<button type="button" class="card-create-btn">
        <h2> + Create new dashboard</h2>
        </button>
        `;
        return el;
}

async function createDashboard(button) {
    button.disabled = true;

    try {
        const response = await fetch(API_URL, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({name: "Untitled Dashboard"})
        });
        if (!response.ok) throw new Error("Failed to create dashboard: " + response.status);

        const created = await response.json();
        window.location.href = `edit.html?id=${encodeURIComponent(created.id)}`;
    } catch (err) {
        console.error(err);
        alert("Couldn't create new dashboard");
        button.disabled = false;
    }
}

if (list) {
    list.addEventListener("click", (event) => {
        const btn = event.target.closest(".card-delete");
        if (btn) deleteDashboard(btn.dataset.id);

        const create = event.target.closest(".card-create-btn");
        if (create) createDashboard(create);
    });

    renderDashboards(dashboards);
}