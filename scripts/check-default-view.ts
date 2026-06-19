// Quick check: the project view should default to the GRID view (not canvas).
import { chromium } from "playwright";

async function main() {
  const url =
    process.argv[2] || "http://localhost:3900/projects/nEcgEYQ34PyR";
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(800);

  const res = await page.evaluate(() => {
    const toggle = Array.from(document.querySelectorAll("button")).filter((b) =>
      b.className.includes("rounded px-3 py-1 font-medium"),
    );
    const grid = toggle.find((b) => b.textContent?.trim() === "Grid");
    const canvas = toggle.find((b) => b.textContent?.trim() === "Canvas");
    return {
      gridActive: grid ? grid.className.includes("bg-accent") : null,
      canvasActive: canvas ? canvas.className.includes("bg-accent") : null,
      reactFlowPresent: !!document.querySelector(".react-flow"),
      gridCardLinks: document.querySelectorAll('a[href*="/screens/"]').length,
    };
  });

  const ok =
    res.gridActive === true &&
    res.canvasActive === false &&
    res.reactFlowPresent === false &&
    res.gridCardLinks > 0;
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"} default view = GRID`);
  console.log(JSON.stringify(res, null, 2));
  await browser.close();
  if (!ok) process.exitCode = 1;
}

main();
