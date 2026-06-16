import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { projectDataDir } from "../db";
import { extractElements, type RawElement } from "./elements";
import type { Project } from "../types";

export interface CaptureRouteResult {
  route: string;
  name: string;
  /** Path relative to the project's data dir, e.g. "screenshots/index.png". */
  screenshotRelPath: string | null;
  width: number;
  height: number;
  elements: RawElement[];
  status: "captured" | "error";
  error?: string;
}

export type ProgressFn = (index: number, route: string) => void;

function routeToName(route: string): string {
  const clean = route.split("?")[0].replace(/^\/+|\/+$/g, "");
  if (!clean) return "Home";
  return clean
    .split("/")
    .map((s) =>
      s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    )
    .join(" / ");
}

function routeToFileName(route: string): string {
  const clean = route.split("?")[0].replace(/^\/+|\/+$/g, "");
  const base = clean ? clean.replace(/[^a-zA-Z0-9]+/g, "_") : "index";
  return base.slice(0, 80);
}

/** Scroll through the page to trigger lazy-loaded content, then return to top. */
async function autoScroll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let total = 0;
      const step = 700;
      const timer = setInterval(() => {
        const height = document.documentElement.scrollHeight;
        window.scrollBy(0, step);
        total += step;
        if (total >= height || total > 25_000) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 50);
    });
  });
  await page.waitForTimeout(150);
}

/**
 * Wait until the page has likely finished rendering its data, not just loaded
 * its HTML shell: let the network go idle and common loading indicators
 * (skeletons, spinners, `aria-busy`) clear. Without this, data-driven apps
 * (e.g. React Query/SWR fetching on mount) get screenshotted mid-skeleton.
 * Every wait is best-effort and time-boxed so a perpetually-animating element
 * can never block a capture.
 */
async function settle(page: Page): Promise<void> {
  await page
    .waitForLoadState("networkidle", { timeout: 15_000 })
    .catch(() => {});
  await page
    .waitForFunction(
      () => {
        const LOADING =
          '[aria-busy="true"],[data-loading="true"],[data-state="loading"],' +
          ".animate-pulse,.skeleton,[class*='skeleton'],[class*='Skeleton'],[class*='shimmer']";
        return document.querySelectorAll(LOADING).length === 0;
      },
      undefined,
      { timeout: 8_000, polling: 200 },
    )
    .catch(() => {});
  await page.waitForTimeout(300);
}

export async function captureRoutes(
  project: Project,
  routes: string[],
  onProgress?: ProgressFn,
): Promise<CaptureRouteResult[]> {
  const dir = path.join(projectDataDir(project.id), "screenshots");
  fs.mkdirSync(dir, { recursive: true });

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: project.viewport.w, height: project.viewport.h },
      deviceScaleFactor: 1,
      storageState: project.authStorageState
        ? JSON.parse(project.authStorageState)
        : undefined,
    });

    // tsx runs this server through esbuild with `keepNames` enabled, which
    // wraps named functions in `__name(...)` calls and defines that helper at
    // module scope. When we serialize a function into page.evaluate() (e.g.
    // extractElements), those `__name(...)` references travel to the browser
    // but the helper does not → "ReferenceError: __name is not defined", which
    // aborts every capture. Define a no-op `__name` in every page up front.
    // Passed as a string so esbuild can't rewrite this line too.
    await context.addInitScript({
      content: "globalThis.__name = globalThis.__name || ((f) => f);",
    });

    const results: CaptureRouteResult[] = [];
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      onProgress?.(i, route);
      const page = await context.newPage();
      try {
        const url = new URL(route, project.baseUrl).toString();
        await page.goto(url, { waitUntil: "load", timeout: 30_000 });
        await settle(page);
        await autoScroll(page);
        await settle(page);

        const fileName = `${routeToFileName(route)}.png`;
        const filePath = path.join(dir, fileName);
        await page.screenshot({ path: filePath, fullPage: true });

        const dims = await page.evaluate(() => ({
          w: Math.ceil(document.documentElement.scrollWidth),
          h: Math.ceil(document.documentElement.scrollHeight),
        }));
        const elements = await extractElements(page);

        results.push({
          route,
          name: routeToName(route),
          screenshotRelPath: path.relative(projectDataDir(project.id), filePath),
          width: dims.w,
          height: dims.h,
          elements,
          status: "captured",
        });
      } catch (err) {
        results.push({
          route,
          name: routeToName(route),
          screenshotRelPath: null,
          width: 0,
          height: 0,
          elements: [],
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        await page.close();
      }
    }
    return results;
  } finally {
    await browser.close();
  }
}
