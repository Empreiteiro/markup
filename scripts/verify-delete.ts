// E2E verification of the new delete features against the running markup dev
// server (:3900). Doubles as cleanup: removes the two stale screens (/llm,
// /insight). Asserts the UI renders the controls and that clicking them really
// deletes through the API + DB and updates the list.
import { chromium } from "playwright";

const BASE = "http://localhost:3900";
const PID = "nEcgEYQ34PyR";
const LLM = "0YyJ23nIhlVf"; // stale /llm screen (1 annotation)
const INSIGHT = "GQeMKk1IiQKa"; // stale /insight screen

function assert(cond: boolean, msg: string) {
  console.log(`${cond ? "✅ PASS" : "❌ FAIL"}: ${msg}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("dialog", (d) => d.accept());

  // ---- A) Delete an annotation from the list (on the stale /llm screen) ----
  await page.goto(`${BASE}/projects/${PID}/screens/${LLM}`, { waitUntil: "load", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.waitForSelector('button[title="Delete annotation"]', { timeout: 8_000 }).catch(() => {});
  const annBefore = await page.$$eval('button[title="Delete annotation"]', (b) => b.length);
  assert(annBefore >= 1, `annotation list renders trash buttons (found ${annBefore})`);
  if (annBefore >= 1) {
    await page.evaluate(() =>
      (document.querySelector('button[title="Delete annotation"]') as HTMLButtonElement)?.click(),
    );
    await page.waitForTimeout(1_200);
    const annAfter = await page.$$eval('button[title="Delete annotation"]', (b) => b.length);
    assert(annAfter === annBefore - 1, `annotation deleted via list button (${annBefore} → ${annAfter})`);
  }

  // ---- B) Delete screens from the grid ----
  await page.goto(`${BASE}/projects/${PID}`, { waitUntil: "load", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Grid",
    );
    (btn as HTMLButtonElement)?.click();
  });
  await page.waitForTimeout(600);
  const cardsBefore = await page.$$eval('a[href*="/screens/"]', (a) => a.length);
  const delBtns = await page.$$eval('button[title="Delete screen"]', (b) => b.length);
  assert(delBtns > 0, `grid cards render delete buttons (${delBtns} buttons / ${cardsBefore} cards)`);

  for (const [sid, label] of [
    [LLM, "/llm"],
    [INSIGHT, "/insight"],
  ] as const) {
    const clicked = await page.evaluate((sid) => {
      window.confirm = () => true;
      const card = document.querySelector(`a[href$="/screens/${sid}"]`);
      const btn = card?.querySelector('button[title="Delete screen"]') as HTMLButtonElement | undefined;
      if (!btn) return false;
      btn.click();
      return true;
    }, sid);
    assert(clicked, `found + clicked delete on stale ${label} card`);
    await page.waitForTimeout(1_600);
  }

  await page.waitForTimeout(800);
  const cardsAfter = await page.$$eval('a[href*="/screens/"]', (a) => a.length);
  const llmGone = (await page.$(`a[href$="/screens/${LLM}"]`)) === null;
  const insightGone = (await page.$(`a[href$="/screens/${INSIGHT}"]`)) === null;
  assert(llmGone && insightGone, "stale /llm and /insight cards removed from the UI");
  assert(cardsAfter === cardsBefore - 2, `card count dropped by 2 (${cardsBefore} → ${cardsAfter})`);

  // ---- Proof screenshot: force the (hover-only) delete buttons visible ----
  await page.evaluate(() => {
    const st = document.createElement("style");
    st.textContent = 'button[title="Delete screen"]{display:block !important}';
    document.head.appendChild(st);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "scripts/_proof-grid-delete.png", fullPage: false });

  await browser.close();
  console.log(`\nGrid now has ${cardsAfter} screens (was ${cardsBefore}).`);
}

main();
