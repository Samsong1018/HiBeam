---
inclusion: fileMatch
fileMatchPattern: ["Web/frontend/**/*.js", "Web/frontend/**/*.css", "Web/frontend/**/*.html"]
---
# Frontend conventions

- **ES modules, camelCase, normal K&R braces.** The backend naming rules don't apply here.
- **Build DOM with `h()` from `scripts/editor/dom.js`.** Never use `innerHTML` with anything that came from a source, a user or the server.
- **Server data is untrusted.** Always pass a loaded dashboard through `normalizeDashboard()` before rendering.
- **Keep logic in pure modules** (`data.js`, `model.js`, `generator.js`, `kpi.js`, `semantic.js`, `quiet.js`, `template.js`), with no DOM, so `tests/` can import them directly. Rendering files stay thin.
- **Colours come from CSS tokens** in `style/style.css` (`--chart-c1…c6`, `--color-ok`, `--color-warn`, `--color-danger`). Charts read the tokens at draw time and redraw on theme change, so never hard-code a hex value in JS.
- **Every new visual has to work in all three themes:** light, dark and `data-theme="kiroween"`.
- **Motion:** animate only `transform`/`opacity`, and respect `prefers-reduced-motion`.
- **Script tags:** a CDN `<script>` needs `integrity` and `crossorigin`, or the CSP and the security review will reject it.

The widget registry. A new widget setting starts in its `defaults`:
#[[file:Web/frontend/scripts/editor/widget-types.js]]
