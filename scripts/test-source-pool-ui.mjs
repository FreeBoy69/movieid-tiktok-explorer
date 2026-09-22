import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), "autoyt-pool-ui-"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const [width, dark] of [[1440, false], [390, true]]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const errors = [];
    page.on("pageerror", (err) => { errors.push(err.message); console.error(err.message); });
    const sources = [
      { url: "https://www.tiktok.com/@football.hattrick", title: "Football Hattrick", primary: true },
      { url: "https://www.tiktok.com/@james.jaan7", title: "James Jaan — Premier League collection with a long name" },
      { url: "https://www.tiktok.com/@new", title: "New source" },
    ];
    let fail = false;
    await page.route("**/api/automation/agents/test/source-pool", (route) => route.fulfill({ status: fail ? 503 : 200, contentType: "application/json", body: JSON.stringify(fail ? { error: "Could not load source usage. Try refreshing." } : {
      sources: sources.map((s, i) => ({ ...s, key: s.url.replace("https://www.", ""), used: i === 0 ? 8 : i === 1 ? 24 : 0, total: i === 0 ? 80 : i === 1 ? 24 : 0, remaining: i === 0 ? 72 : 0, posts: i === 0 ? 8 : i === 1 ? 24 : 0, percent: i === 0 ? 10 : i === 1 ? 100 : 0, status: i === 0 ? "ready" : i === 1 ? "exhausted" : "not_scanned" })), scanIssues: [],
    }) }));
    await page.route("**/pool-ui-test*", (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><style>body{margin:0;background:${dark ? "#181818" : "#F9F8F6"}}main{max-width:650px;padding:24px;margin:auto}h1{font:700 20px Inter,sans-serif;color:${dark ? "#F8F5E8" : "#1A1A1A"}}</style></head><body><main><h1>Source pool</h1><div id="root"></div></main><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
await import('/src/index.css'); await import('/src/components/AutomationAgents.css');
const React = (await import('/node_modules/.vite/deps/react.js')).default; const {createRoot} = (await import('/node_modules/.vite/deps/react-dom_client.js')).default; const {SourcePoolUsage} = await import('/src/components/SourcePoolUsage.tsx');
function App(){const [sources,setSources]=React.useState(${JSON.stringify(sources)});return React.createElement(SourcePoolUsage,{agentId:'test',sources,dark:${dark},active:true,revision:'1',onRemove:url=>setSources(prev=>prev.filter(s=>s.url!==url))})}; createRoot(document.getElementById('root')).render(React.createElement(App));
</script></body></html>` }));
    await page.goto(`${process.env.UI_BASE_URL || "http://127.0.0.1:4176"}/pool-ui-test`);
    await page.getByRole("progressbar").first().waitFor();
    assert.equal(await page.getByRole("progressbar").count(), 3);
    assert.equal(await page.locator(".source-pool-source-count").count(), 3);
    assert.equal(await page.getByRole("progressbar", { name: "Football Hattrick usage" }).getAttribute("aria-valuenow"), "10");
    assert.equal(await page.getByRole("progressbar", { name: "New source usage" }).getAttribute("aria-valuenow"), null);
    assert.ok(await page.getByText("Known videos exhausted").isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(artifacts, `${width}-${dark ? "dark" : "light"}.png`), fullPage: true });
    fail = true;
    await page.getByRole("button", { name: "Refresh source usage" }).click();
    await page.getByText("Could not load source usage. Try refreshing.").waitFor();
    assert.ok((await page.locator(".source-pool-source-count").first().textContent()).includes("8 / 80 used"));
    fail = false;
    await page.getByRole("button", { name: "Refresh source usage" }).click();
    await page.getByText("Source usage", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Remove New source" }).click();
    assert.equal(await page.getByRole("progressbar").count(), 2);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`Source usage bars, refresh, errors, removal and responsive checks passed: ${artifacts}`);
} finally { await browser.close(); }
