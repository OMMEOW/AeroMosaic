// End-to-end test of the UAV dashboard against the live backend (Playwright 1.60, Chromium).
// Usage: node e2e.cjs
const { chromium } = require(process.env.HOME + "/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const WEB = "http://localhost:3100";
const API = "http://127.0.0.1:8000";
const BACKEND = path.join(process.env.HOME, "My Stuff/Major/uav-dashboard/backend");
const OUT = path.join(__dirname, "e2e");
fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const results = [];
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  log(ok ? "PASS" : "FAIL", name, detail);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p) => (await fetch(API + p)).json();

function stopBackend() {
  try { execSync(`pkill -f "uvicorn server.app:app"`); } catch {}
}
function startBackend() {
  const out = fs.openSync(path.join(OUT, "server.log"), "a");
  spawn(`${BACKEND}/.venv/bin/uvicorn`, ["server.app:app", "--host", "127.0.0.1", "--port", "8000"], {
    cwd: BACKEND, detached: true, stdio: ["ignore", out, out],
  }).unref();
}
async function waitBackend(ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const h = await api("/api/health"); if (h.state === "ready") return h; } catch {}
    await sleep(1000);
  }
  throw new Error("backend did not come up");
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && (downWindow && /ERR_CONNECTION_REFUSED/.test(m.text()) ? downErrors : consoleErrors).push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
  const conn = () => page.locator("[role=status]").filter({ hasText: /^(Live|Connecting|Connection lost|Reconnecting|Disconnected|Stream closed)/ }).first();
  let downWindow = false;
  const downErrors = [];
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + ".png"), fullPage: true });

  try {
    await waitBackend();
    // ---------------------------------------------------------------- 1. new run
    await page.goto(WEB + "/new");
    await page.getByRole("button", { name: /dirt_path13/ }).first().waitFor({ timeout: 30000 });
    const nVideos = await page.locator("ul li button[aria-pressed]").count();
    check("New run lists videos from the data root", nVideos > 50, `${nVideos} videos`);
    await page.getByRole("button", { name: /dirt_path13/ }).first().click();
    await page.getByText("Frames (decoded)").waitFor();
    const framesTxt = await page.locator("dt:has-text('Frames (decoded)') + dd").first().innerText();
    check("Video panel shows the decoded frame count", /200/.test(framesTxt), framesTxt.replace(/\n/g, " "));
    const fwChecked = await page.getByRole("radio", { name: /firstwins/ }).isChecked();
    check("firstwins is the (temporary) default variant", fwChecked);
    await shot("01-new-run");
    await page.getByRole("button", { name: "Start run" }).click();
    await page.waitForURL(/\/runs\/[^/]+$/, { timeout: 20000 });
    const runId = page.url().split("/runs/")[1];
    log("run", runId);
    check("Start run navigates to the live view", !!runId, runId);

    // ---------------------------------------------------------------- 2. live progress over WS
    await page.waitForFunction(() => [...document.querySelectorAll("span,div")].some((e) => e.childElementCount <= 1 && e.textContent.trim() === "Live" && e.closest("[role=status]")), null, { timeout: 20000 }).catch(() => null);
    const c0 = await conn().innerText().catch(() => "");
    check("WebSocket connected (indicator 'Live')", /^Live/i.test(c0.trim()), c0);
    await page.getByText(/compose\s*firstwins/).first().waitFor();
    check("Variant badge shows firstwins on the live run", true);
    await page.getByText(/Stage 1 · [\d,]+ candidate edges · [\d,]+ pass/).waitFor({ timeout: 180000 });
    const s1title = await page.getByText(/Stage 1 · [\d,]+ candidate edges/).innerText();
    check("Stage-1 edge records arrived over the WS", /1,273 candidate edges · 979 pass/i.test(s1title), s1title);
    const causes = await page.locator("button:has-text('IoU gate'), button:has-text('f_m gate'), button:has-text('Proxy fit failed')").allInnerTexts();
    check("Stage-1 reject causes are separate filters", causes.length === 3, causes.join(" | ").replace(/\n/g, " "));
    // IoU-rejected row text must differ from f_m-rejected row text
    await page.getByRole("button", { name: /^IoU gate/ }).click();
    const iouRow = await page.locator("text=/IoU 0\\.\\d\\d < 0\\.40/").first().innerText();
    await page.getByRole("button", { name: /^f_m gate/ }).click();
    const fmRow = await page.locator("text=/f_m 0\\.\\d{3} < 0\\.164/").first().innerText();
    check("IoU rejection reads differently from f_m rejection", iouRow !== fmRow && /IoU/.test(iouRow) && /^f_m/.test(fmRow), `"${iouRow}" vs "${fmRow}"`);
    await page.getByRole("button", { name: /^All/ }).click();
    // wait for DKM attempts
    await page.getByText(/Stage 2 · DKM attempts · \d+/).waitFor({ timeout: 240000 });
    await sleep(4000);
    const before = await page.getByText(/Stage 2 · DKM attempts · \d+/).innerText();
    await shot("02-live-dkm");
    check("Stage-2 DKM attempts stream in live", /· \d+/.test(before), before);
    // ---- per-pair visualisation, live
    await page.getByText(/SIFT putatives \(stage 1\) · \d+/).first().waitFor({ timeout: 30000 });
    const putBtn = await page.getByText(/SIFT putatives \(stage 1\) · \d+/).first().innerText();
    check("Live pair panel shows the stage-1 SIFT putatives", /· [1-9]\d*/.test(putBtn), putBtn);
    await page.getByText("Stage-1 evidence (cheap)").first().waitFor();
    const gateTxt = await page.getByText("Stage-1 evidence (cheap)").first().locator("..").locator("..").innerText();
    check("Gate evidence shown for the pair (f_m, IoU, passed)", /f_m/.test(gateTxt) && /proxy IoU/.test(gateTxt) && /passed the gate/.test(gateTxt), gateTxt.replace(/\n/g, " ").slice(0, 160));
    await page.waitForFunction(() => /DKM forward pass[\s\S]*?\d+ ms/.test(document.body.innerText), null, { timeout: 60000 });
    check("Sub-stage stepper shows measured DKM forward time", true);
    const noPct = !/\d+\s?%/.test(await page.locator("section:has-text('DKM + dual layer (measured)')").first().innerText().catch(() => ""));
    check("No percentage/progress figure inside the DKM stepper", noPct);
    await shot("02b-live-pair");
    const chipsBefore = await page.locator("[aria-label='Attempted pairs'] li").count();
    const hdr = await page.locator("h1").first().locator("xpath=../..").innerText();
    check("Live header shows device and estimator", /device mps/.test(hdr) && /estimator magsac/.test(hdr), hdr.split("\n").slice(-1)[0]);

    // ---------------------------------------------------------------- 3. refresh mid-run
    await page.reload();
    await page.getByText(/Stage 1 · 1,273 candidate edges · 979 pass/i).waitFor({ timeout: 30000 });
    const after = await page.getByText(/Stage 2 · DKM attempts · \d+/).innerText();
    const nb = +before.match(/(\d+)$/)[1], na = +after.match(/(\d+)$/)[1];
    check("Refresh mid-run recovers state from the event log", na >= nb, `${before} → after reload ${after}`);
    await page.locator("[aria-label='Attempted pairs'] li").first().waitFor({ timeout: 20000 });
    const chipsAfter = await page.locator("[aria-label='Attempted pairs'] li").count();
    check("Pair filmstrip recovers after refresh", chipsAfter >= chipsBefore && chipsAfter > 0, `${chipsBefore} → ${chipsAfter}`);
    await shot("03-after-refresh");

    // ---------------------------------------------------------------- 4. kill backend mid-run
    const status0 = (await api(`/api/runs/${runId}`)).status;
    downWindow = true;
    stopBackend();
    log("backend killed (run status was", status0 + ")");
    await page.getByText(/Connection lost · retry in \d+s|Reconnecting · attempt/).first().waitFor({ timeout: 30000 });
    const connTxt = await page.getByText(/Connection lost · retry in \d+s|Reconnecting · attempt \d+/).first().innerText();
    check("UI shows a clear disconnected state", true, connTxt);
    await page.getByText("backend unreachable").first().waitFor({ timeout: 20000 });
    check("Top bar shows 'backend unreachable'", true);
    await shot("04-backend-down");
    startBackend();
    await waitBackend();
    log("backend restarted");
    await page.waitForFunction(() => { const s = [...document.querySelectorAll("[role=status]")].map((e) => e.textContent.trim()); return s.some((t) => /^live/i.test(t)); }, null, { timeout: 30000 });
    downWindow = false;
    check("UI reconnects when the backend comes back", /^Live/i.test((await conn().innerText()).trim()), (await conn().innerText()).trim());
    const adopted = await api(`/api/runs/${runId}`);
    check("Worker survived the server restart and was re-adopted", adopted.status === "running", adopted.status);

    // ---------------------------------------------------------------- 5. completion + results
    await page.getByText("Run complete", { exact: true }).waitFor({ timeout: 600000 });
    const banner = await page.getByText("Run complete", { exact: true }).locator("..").innerText();
    check("Run completes and the live view says so", true, banner.replace(/\n/g, " ").slice(0, 200));
    await shot("05-live-complete");
    await page.getByRole("link", { name: /Open results/ }).first().click();
    await page.waitForURL(/\/results$/);
    await page.getByText("Absolute coverage").first().waitFor({ timeout: 30000 });
    const mosaicOk = await page.waitForFunction(() => {
      const im = [...document.images].find((i) => i.src.includes("/mosaic.png"));
      return im && im.complete && im.naturalWidth > 0 ? im.naturalWidth : false;
    }, null, { timeout: 60000 });
    check("Mosaic loads in the results viewer", true, `naturalWidth ${await mosaicOk.jsonValue()}`);
    const cov = await page.locator(".num.mt-1.text-\\[3rem\\]").innerText();
    const m = await api(`/api/runs/${runId}`);
    check("Displayed coverage equals metrics.json", cov.includes((m.metrics.absoluteCoverage * 100).toFixed(2)), `${cov} vs ${(m.metrics.absoluteCoverage * 100).toFixed(4)}%`);
    const bodyTxt = await page.locator("main, body").first().innerText();
    check("No fill metric anywhere on results", !/\bfill ratio\b|\bFill\b|canvas fill/i.test(bodyTxt.replace(/seam fallback|fills only/gi, "")));
    check("No PSNR/SSIM on results", !/PSNR|SSIM/.test(bodyTxt));
    check("Results config line shows device and estimator", /variant=firstwins estimator=magsac device=mps seed=0/.test(bodyTxt));
    check("Savings panel names N=fps as the baseline", /N=fps baseline/.test(bodyTxt) && /candidate edges evaluated/.test(bodyTxt));
    await shot("06-results");

    // pairs tab (after the run, from disk)
    await page.getByRole("link", { name: "Pairs" }).click();
    await page.locator("[aria-label='Attempted pairs'] li").first().waitFor({ timeout: 30000 });
    const nChips = await page.locator("[aria-label='Attempted pairs'] li").count();
    await page.locator("[aria-label='Attempted pairs'] li button").first().click();
    await page.getByText(/DKM inliers \(stage 2\) · \d+ shown/).waitFor({ timeout: 20000 });
    const canvasOk = await page.waitForFunction(() => { const im = [...document.images].find((i) => i.src.includes("canvas.jpg")); return im && im.complete && im.naturalWidth > 0; }, null, { timeout: 20000 }).then(() => true, () => false);
    const cap = await page.getByText(/DKM inlier correspondences, evenly subsampled/).first().innerText().catch(() => "");
    check("Pairs tab re-opens a past pair from disk (inliers, caption, canvas)", nChips === 14 && canvasOk && /evenly subsampled/.test(cap), `${nChips} pairs · ${cap.slice(0, 90)}`);
    await shot("06b-pairs-tab");
    const pruneRun = fs.readFileSync(path.join(__dirname, "prune_run.txt"), "utf8").trim();
    await page.goto(WEB + `/runs/${pruneRun}/pairs`);
    await page.getByText(/Overlays pruned for 9 older accepted pairs/).waitFor({ timeout: 30000 });
    await page.locator("[aria-label='Attempted pairs'] li button").first().click();
    await page.getByText(/were pruned by the retention cap/).waitFor({ timeout: 10000 });
    check("Pruned overlays are noted in the UI", true, "keep=5 run: 9 pruned");
    await page.goto(WEB + `/runs/${runId}/results`);
    await page.getByText("Absolute coverage").first().waitFor({ timeout: 30000 });

    // selection inspector
    await page.getByRole("link", { name: "Frame selection" }).click();
    await page.getByText("Stage 1 summary").waitFor({ timeout: 30000 });
    await page.getByText("Candidate edges by gap and outcome").waitFor();
    const rows = await page.locator("text=/\\d+ of 1,273 candidate edges/").innerText();
    check("Frame selection inspector opens with all edges", /1,273 of 1,273/.test(rows), rows);
    await shot("07-selection");
    await page.getByRole("link", { name: "Diagnostics" }).click();
    await page.getByText("Environment (manifest.json)").waitFor({ timeout: 30000 });
    await page.getByText(/max rel err/).waitFor({ timeout: 20000 });
    check("Diagnostics shows environment from manifest.json", true);
    await shot("08-diagnostics");

    // zip download
    await page.getByRole("button", { name: /Run files/ }).click();
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByRole("button", { name: /Whole run \(\.zip\)/ }).click()]);
    const zipPath = path.join(OUT, await dl.suggestedFilename());
    await dl.saveAs(zipPath);
    const size = fs.statSync(zipPath).size;
    const listing = execSync(`unzip -l "${zipPath}"`).toString();
    const need = ["manifest.json", "steps.jsonl", "events.jsonl", "metrics.json", "mosaic.png", "observed_area.json", "run.log", "artifacts/"];
    check("Run zip downloads, is non-empty and opens", size > 1e6 && need.every((n) => listing.includes(n)), `${path.basename(zipPath)} ${(size / 1e6).toFixed(1)} MB`);
    execSync(`unzip -t "${zipPath}"`);
    check("unzip -t passes", true);

    // ---------------------------------------------------------------- 5b. single-pair mode
    await page.goto(WEB + "/new?video=dirt_path13");
    await page.getByRole("radio", { name: "Single pair" }).click();
    await page.getByLabel("Frame i (reference)").fill("0");
    await page.getByLabel("Frame j (new)").fill("64");
    await page.getByRole("button", { name: "Start run" }).click();
    await page.waitForURL(/\/runs\/[^/]+$/, { timeout: 20000 });
    await page.getByText(/Single pair 0→64: (accepted|rejected)/).waitFor({ timeout: 120000 });
    const spBanner = await page.getByText(/Single pair 0→64: (accepted|rejected)/).locator("..").innerText();
    check("Single-pair run completes with gate verdict and DKM verdict", /would have rejected it \(IoU 0\.\d\d < 0\.40\)/.test(spBanner) && /ratio 0\.\d{3}/.test(spBanner), spBanner.replace(/\n/g, " "));
    await page.getByText(/DKM inliers \(stage 2\) · \d+ shown/).waitFor({ timeout: 20000 });
    check("Single-pair run shows the full pair panel", true);
    await shot("06c-single-pair");

    // ---------------------------------------------------------------- 6. failing case
    await page.goto(WEB + "/new?video=dirt_path13&variant=semantic");
    await page.getByText("This run will fail at preflight").waitFor({ timeout: 30000 });
    check("New run warns that semantic will fail (checkpoint missing)", true);
    await page.getByRole("button", { name: "Start run" }).click();
    await page.waitForURL(/\/runs\/[^/]+$/);
    await page.getByText(/Failed during PREFLIGHT/).waitFor({ timeout: 60000 });
    const failTxt = await page.locator("section[role=alert]").first().innerText();
    check("Failure renders with its reason", /SemanticStitch checkpoint not found at .*epoch090_model\.pth/.test(failTxt), failTxt.split("\n").slice(0, 3).join(" | "));
    check("Failed semantic run is labelled semantic, not firstwins", /compose\s*SemanticStitch/.test(await page.locator("body").innerText()));
    await shot("09-failure");

    // ---------------------------------------------------------------- 7. disk + restart listing
    const dir = path.join(BACKEND, "runs", runId);
    const files = ["manifest.json", "steps.jsonl", "events.jsonl", "metrics.json", "mosaic.png", "observed_area.json", "run.log", "artifacts"];
    const missing = files.filter((f) => !fs.existsSync(path.join(dir, f)));
    check("runs/<id>/ contains every listed file", missing.length === 0, missing.length ? "missing " + missing.join(",") : files.join(", "));
    stopBackend();
    await sleep(1000);
    startBackend();
    await waitBackend();
    const list = await api("/api/runs");
    const mine = list.find((r) => r.id === runId);
    check("GET /runs after a server restart lists the run correctly", mine && mine.status === "succeeded" && mine.metrics, mine ? `${mine.status}, coverage ${mine.metrics.absoluteCoverage}` : "not listed");
    await page.goto(WEB + "/history");
    await page.getByText(runId).first().waitFor({ timeout: 30000 });
    check("History lists the run after restart", true);
    await shot("10-history");

    // narrow viewport
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(WEB + `/runs/${runId}/results`);
    await page.getByText("Absolute coverage").first().waitFor({ timeout: 30000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("Results at 390 px has no horizontal page scroll", overflow <= 1, `overflow ${overflow}px`);
    await shot("11-results-390");

    fs.writeFileSync(path.join(OUT, "run_id.txt"), runId);
  } catch (e) {
    check("UNEXPECTED ERROR", false, e.message.split("\n")[0]);
    await shot("zz-error").catch(() => {});
  } finally {
    const errs = [...new Set(consoleErrors)];
    check("Browser console free of errors (outside the deliberate backend-down window)", errs.length === 0, errs.slice(0, 5).join(" || ").slice(0, 600));
    log(`console errors during the deliberate backend-down window: ${downErrors.length} (all ERR_CONNECTION_REFUSED)`);
    await browser.close();
    const pass = results.filter((r) => r.ok).length;
    console.log(`\n${pass}/${results.length} checks passed`);
    fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 1));
    process.exit(pass === results.length ? 0 : 1);
  }
})();
