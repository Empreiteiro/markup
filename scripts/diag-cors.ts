// One-off diagnostic: load an idp route in a real browser and report whether the
// frontend's XHRs to the backend (:8000) succeed or get blocked (CORS), to explain
// why captured screens show no records.
import { chromium } from "playwright";

async function main() {
  const base = process.argv[2] || "http://localhost:3001";
  const route = process.argv[3] || "/documents";
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const apiResponses: string[] = [];
  const failed: string[] = [];
  const consoleErrors: string[] = [];

  page.on("response", (res) => {
    if (res.url().includes(":8000/api/"))
      apiResponses.push(`${res.status()} ${res.request().method()} ${res.url()}`);
  });
  page.on("requestfailed", (r) => {
    if (r.url().includes(":8000/api/"))
      failed.push(`${r.method()} ${r.url()} -> ${r.failure()?.errorText}`);
  });
  page.on("console", (m) => {
    if (/cors|blocked|error|failed/i.test(m.text())) consoleErrors.push(m.text());
  });

  await page.goto(base + route, { waitUntil: "load", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(1_500);

  console.log(`### ${base}${route}`);
  console.log("\n[API responses to :8000]\n" + (apiResponses.join("\n") || "(none reached)"));
  console.log("\n[Failed requests to :8000]\n" + (failed.join("\n") || "(none)"));
  console.log("\n[Console errors/CORS]\n" + (consoleErrors.slice(0, 6).join("\n") || "(none)"));

  await browser.close();
}

main();
