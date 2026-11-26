// One-click demo. Loaded on the login page (the "Just looking?" panel) and the dashboards page
// (the "demo account" banner). Both stay hidden unless the server says the demo is on, or the
// signed-in account is a demo one. Built with textContent only, never innerHTML.
(function ()
{
    const DEMO_DOMAIN = "@demo.invalid";

    async function GetJson(pUrl)
    {
        const tmpRes = await fetch(pUrl, { credentials: "same-origin" });
        const tmpBody = await tmpRes.json().catch(() => null);
        return tmpRes.ok && tmpBody && tmpBody.success ? tmpBody.data : null;
    }

    function BoardLink(pBoard)
    {
        const tmpLink = document.createElement("a");
        tmpLink.href = `/view/${encodeURIComponent(pBoard.id)}`;
        tmpLink.textContent = pBoard.name;
        return tmpLink;
    }

    async function StartDemo(pButton, pError)
    {
        pButton.disabled = true;
        pButton.setAttribute("aria-busy", "true");
        pButton.textContent = "Setting up your copy…";
        pError.textContent = "";
        try
        {
            const tmpRes = await fetch("/api/demo", { method: "POST", credentials: "same-origin" });
            const tmpBody = await tmpRes.json().catch(() => null);
            if (!tmpRes.ok || !tmpBody || !tmpBody.success)
            {
                throw new Error((tmpBody && tmpBody.error) || "Couldn't start the demo");
            }
            window.location.href = "/";
        }
        catch (pErr)
        {
            pError.textContent = pErr.message || "Couldn't start the demo";
            pButton.disabled = false;
            pButton.removeAttribute("aria-busy");
            pButton.textContent = "Open the demo";
        }
    }

    // Login page: show the panel only when the demo is on and this isn't a reset/confirm link.
    async function InitEntry(pPanel)
    {
        const tmpParams = new URLSearchParams(window.location.search);
        if (tmpParams.has("reset") || tmpParams.has("token")) return;
        const tmpInfo = await GetJson("/api/demo");
        if (!tmpInfo || !tmpInfo.enabled) return;

        const tmpLinks = pPanel.querySelector("[data-demo-links]");
        tmpInfo.boards.forEach((pBoard, pIndex) =>
        {
            if (pIndex > 0) tmpLinks.append(document.createTextNode(" · "));
            tmpLinks.append(BoardLink(pBoard));
        });
        tmpLinks.closest("[data-demo-links-row]").hidden = tmpInfo.boards.length === 0;

        const tmpButton = pPanel.querySelector("[data-demo-start]");
        const tmpError = pPanel.querySelector("[data-demo-error]");
        tmpButton.addEventListener("click", () => StartDemo(tmpButton, tmpError));
        pPanel.hidden = false;
    }

    // Signs out of the demo account, then goes to the login page. The account itself is left for
    // the hourly cleanup.
    async function LeaveDemo(pEvent)
    {
        pEvent.preventDefault();
        try { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }); }
        catch { /* the cookie dies with the browser anyway */ }
        window.location.href = "/login";
    }

    // Dashboards page: tell a demo visitor what they're in, and give them a way out.
    async function InitBanner(pBanner)
    {
        const tmpProfile = await GetJson("/api/account");
        if (!tmpProfile || typeof tmpProfile.email !== "string") return;
        if (!tmpProfile.email.toLowerCase().endsWith(DEMO_DOMAIN)) return;
        pBanner.querySelectorAll("[data-demo-leave]").forEach((pEl) => pEl.addEventListener("click", LeaveDemo));
        pBanner.hidden = false;
    }

    function Init()
    {
        const tmpPanel = document.querySelector("[data-demo-entry]");
        if (tmpPanel) InitEntry(tmpPanel);
        const tmpBanner = document.querySelector("[data-demo-banner]");
        if (tmpBanner) InitBanner(tmpBanner);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", Init);
    else Init();
})();
