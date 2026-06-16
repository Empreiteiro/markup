import fs from "node:fs";
import path from "node:path";
import { replaceEdges } from "../db/edges";
import { upsertDiscoveredScreens } from "../db/screens";
import type { Project } from "../types";

export type Framework = "next" | "react-router" | "unknown";

export interface FrameworkInfo {
  framework: Framework;
  repoPath: string;
  appDir: string | null;
  pagesDir: string | null;
}

export interface DiscoveredScreen {
  route: string;
  name: string;
  /** Path relative to the repo root. */
  sourceFile: string;
  sourceLine: number | null;
  dynamic: boolean;
}

export interface DiscoveredEdge {
  fromRoute: string;
  toRoute: string;
}

export interface DiscoverySummary {
  framework: Framework;
  routes: { route: string; dynamic: boolean }[];
  screenCount: number;
  dynamicCount: number;
  edgeCount: number;
  modals: string[];
}

const IGNORE_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".turbo",
  ".vercel",
]);

function firstExisting(paths: string[]): string | null {
  return paths.find((p) => fs.existsSync(p)) ?? null;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function walkFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  const visit = (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name)) visit(path.join(d, e.name));
      } else if (exts.some((x) => e.name.endsWith(x))) {
        out.push(path.join(d, e.name));
      }
    }
  };
  visit(dir);
  return out;
}

export function detectFramework(repoPath: string): FrameworkInfo {
  const pkg = readJson(path.join(repoPath, "package.json"));
  const deps = {
    ...((pkg?.dependencies as Record<string, string>) ?? {}),
    ...((pkg?.devDependencies as Record<string, string>) ?? {}),
  };
  const appDir = firstExisting([
    path.join(repoPath, "app"),
    path.join(repoPath, "src", "app"),
  ]);
  const pagesDir = firstExisting([
    path.join(repoPath, "pages"),
    path.join(repoPath, "src", "pages"),
  ]);
  let framework: Framework = "unknown";
  if (deps.next) framework = "next";
  else if (deps["react-router-dom"] || deps["react-router"])
    framework = "react-router";
  else if (appDir || pagesDir) framework = "next";
  return { framework, repoPath, appDir, pagesDir };
}

function nameFromRoute(route: string): string {
  const clean = route.replace(/^\/+|\/+$/g, "");
  if (!clean) return "Home";
  return clean
    .split("/")
    .map((s) =>
      s
        .replace(/^\[\.{0,3}(.+?)\]$/, "$1")
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase()),
    )
    .join(" / ");
}

function exportLine(content: string): number | null {
  const lines = content.split("\n");
  const idx = lines.findIndex((l) => /export\s+default/.test(l));
  return idx >= 0 ? idx + 1 : null;
}

function appRoute(appDir: string, file: string): DiscoveredScreen | null {
  const rel = path.relative(appDir, path.dirname(file));
  const rawSegments = rel ? rel.split(path.sep) : [];
  // Skip parallel/intercepting routes.
  if (rawSegments.some((s) => s.startsWith("@") || s.startsWith("(.")))
    return null;
  const segments = rawSegments.filter(
    (s) => !(s.startsWith("(") && s.endsWith(")")),
  );
  const route = "/" + segments.join("/");
  const normalized = route === "/" ? "/" : route.replace(/\/+$/, "");
  return {
    route: normalized,
    name: nameFromRoute(normalized),
    sourceFile: "",
    sourceLine: null,
    dynamic: segments.some((s) => s.includes("[")),
  };
}

function pagesRoute(pagesDir: string, file: string): DiscoveredScreen | null {
  const rel = path.relative(pagesDir, file).replace(/\.(t|j)sx?$/, "");
  const segments = rel.split(path.sep);
  if (segments[0] === "api") return null;
  if (segments.some((s) => s.startsWith("_"))) return null;
  if (segments[segments.length - 1] === "index") segments.pop();
  const route = "/" + segments.join("/");
  const normalized = route === "/" ? "/" : route.replace(/\/+$/, "");
  return {
    route: normalized,
    name: nameFromRoute(normalized),
    sourceFile: "",
    sourceLine: null,
    dynamic: segments.some((s) => s.includes("[")),
  };
}

function discoverNextScreens(info: FrameworkInfo): DiscoveredScreen[] {
  const byRoute = new Map<string, DiscoveredScreen>();
  const add = (s: DiscoveredScreen | null, file: string) => {
    if (!s || byRoute.has(s.route)) return;
    const content = (() => {
      try {
        return fs.readFileSync(file, "utf8");
      } catch {
        return "";
      }
    })();
    s.sourceFile = path.relative(info.repoPath, file);
    s.sourceLine = exportLine(content);
    byRoute.set(s.route, s);
  };

  if (info.appDir) {
    for (const file of walkFiles(info.appDir, [
      "page.tsx",
      "page.jsx",
      "page.ts",
      "page.js",
    ])) {
      if (/[/\\]page\.(t|j)sx?$/.test(file)) add(appRoute(info.appDir, file), file);
    }
  }
  if (info.pagesDir) {
    for (const file of walkFiles(info.pagesDir, [
      ".tsx",
      ".jsx",
      ".ts",
      ".js",
    ])) {
      if (file.endsWith(".d.ts")) continue;
      add(pagesRoute(info.pagesDir, file), file);
    }
  }
  return [...byRoute.values()];
}

function discoverReactRouterScreens(info: FrameworkInfo): DiscoveredScreen[] {
  const files = walkFiles(info.repoPath, [".tsx", ".jsx"]);
  const byRoute = new Map<string, DiscoveredScreen>();
  const re = /<Route\b[^>]*\bpath\s*=\s*["'`]([^"'`]+)["'`]/g;
  for (const file of files) {
    let content = "";
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      let route = m[1];
      if (!route.startsWith("/")) route = "/" + route;
      route = route === "/" ? "/" : route.replace(/\/+$/, "");
      if (byRoute.has(route)) continue;
      const line = content.slice(0, m.index).split("\n").length;
      byRoute.set(route, {
        route,
        name: nameFromRoute(route),
        sourceFile: path.relative(info.repoPath, file),
        sourceLine: line,
        dynamic: /:|\*/.test(route),
      });
    }
  }
  return [...byRoute.values()];
}

function normalizeSegments(route: string): string[] {
  return route
    .split("?")[0]
    .split("#")[0]
    .replace(/^\//, "")
    .split("/")
    .filter(Boolean)
    .map((seg) =>
      /^\[.*\]$/.test(seg) || /\$\{.*\}$/.test(seg) || /^:.+/.test(seg)
        ? "*"
        : seg,
    );
}

function routeMatches(target: string, route: string): boolean {
  const a = normalizeSegments(target);
  const b = normalizeSegments(route);
  if (a.length !== b.length) return false;
  return a.every((seg, i) => seg === b[i] || seg === "*" || b[i] === "*");
}

function extractLinkTargets(content: string): string[] {
  const targets = new Set<string>();
  const patterns = [
    /(?:href|to)\s*=\s*\{?\s*[`'"]([^`'"]+)[`'"]/g,
    /(?:router\.(?:push|replace)|redirect|navigate)\(\s*[`'"]([^`'"]+)[`'"]/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const t = m[1];
      if (t.startsWith("/") && !t.startsWith("/api")) targets.add(t);
    }
  }
  return [...targets];
}

function discoverEdges(
  repoPath: string,
  screens: DiscoveredScreen[],
): DiscoveredEdge[] {
  const edges = new Map<string, DiscoveredEdge>();
  for (const screen of screens) {
    if (!screen.sourceFile) continue;
    let content = "";
    try {
      content = fs.readFileSync(path.join(repoPath, screen.sourceFile), "utf8");
    } catch {
      continue;
    }
    for (const target of extractLinkTargets(content)) {
      const match = screens.find((s) => routeMatches(target, s.route));
      if (!match || match.route === screen.route) continue;
      const key = `${screen.route}|${match.route}`;
      if (!edges.has(key))
        edges.set(key, { fromRoute: screen.route, toRoute: match.route });
    }
  }
  return [...edges.values()];
}

function detectModals(info: FrameworkInfo): string[] {
  const dirs = [
    info.appDir,
    info.pagesDir,
    firstExisting([
      path.join(info.repoPath, "components"),
      path.join(info.repoPath, "src", "components"),
    ]),
  ].filter(Boolean) as string[];
  const found = new Set<string>();
  for (const dir of dirs) {
    for (const file of walkFiles(dir, [".tsx", ".jsx"])) {
      const base = path.basename(file).replace(/\.(t|j)sx?$/, "");
      if (/(modal|dialog)/i.test(base)) found.add(base);
    }
  }
  return [...found].sort();
}

export function runDiscovery(
  projectId: string,
  project: Project,
): DiscoverySummary {
  const repoPath = project.repoPath!;
  const info = detectFramework(repoPath);
  const screens =
    info.framework === "react-router"
      ? discoverReactRouterScreens(info)
      : discoverNextScreens(info);
  const edges = discoverEdges(repoPath, screens);
  const modals = detectModals(info);

  const routeToId = upsertDiscoveredScreens(projectId, screens);
  const edgeInputs = edges
    .filter((e) => routeToId.has(e.fromRoute) && routeToId.has(e.toRoute))
    .map((e) => ({
      fromScreenId: routeToId.get(e.fromRoute)!,
      toScreenId: routeToId.get(e.toRoute)!,
      kind: "navigate" as const,
    }));
  replaceEdges(projectId, edgeInputs);

  return {
    framework: info.framework,
    routes: screens
      .map((s) => ({ route: s.route, dynamic: s.dynamic }))
      .sort((a, b) => a.route.localeCompare(b.route)),
    screenCount: screens.length,
    dynamicCount: screens.filter((s) => s.dynamic).length,
    edgeCount: edgeInputs.length,
    modals,
  };
}
