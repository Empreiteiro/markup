#!/usr/bin/env node
/**
 * Markup MCP server (stdio).
 *
 * Exposes the Markup platform's operations as MCP tools so that Claude Code,
 * Cursor or any MCP client can assist with screen discovery and read/write
 * annotations. It reuses the web app's data layer (better-sqlite3) and works
 * on the same ./data directory — no HTTP server required.
 *
 * Run: `npm run mcp` (or `npx tsx src/mcp/server.ts`).
 * Point MARKUP_DATA_DIR at the project's data dir, or run with cwd = repo root.
 */

import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { projectDataDir } from "../db";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "../db/projects";
import {
  deleteScreen,
  getScreen,
  listElements,
  listScreenSummaries,
  saveCaptureResults,
} from "../db/screens";
import {
  createAnnotation,
  deleteAnnotation,
  getAnnotation,
  listAnnotations,
  listAnnotationsForProject,
  updateAnnotation,
} from "../db/annotations";
import { listEdges } from "../db/edges";
import { runDiscovery } from "../discovery";
import { captureRoutes } from "../capture/crawler";
import { buildReviewDoc, renderMarkdown, writeExport } from "../export/build";
import { cloneRepo } from "../runtime/clone";
import { appStatus, startApp, stopApp } from "../runtime/devserver";

const CHARACTER_LIMIT = 25_000;
const MAX_IMAGE_BYTES = 4_000_000;

type ToolResult = {
  content: (
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  )[];
  isError?: boolean;
};

function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return (
    text.slice(0, CHARACTER_LIMIT) +
    `\n…[response truncated at ${CHARACTER_LIMIT} characters — refine the filters or query specific items]`
  );
}

function ok(data: unknown): ToolResult {
  const text =
    typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text: truncate(text) }] };
}

function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

const server = new McpServer({ name: "markup-mcp-server", version: "0.1.0" });

/* ------------------------------------------------------------------ Projects */

server.registerTool(
  "markup_list_projects",
  {
    title: "List Markup projects",
    description:
      "Lists all review projects (each points to a target app: baseUrl + optional repo). Returns JSON with id, name, baseUrl, repoPath, viewport, createdAt. Start here to get the project IDs used by the other tools.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (): Promise<ToolResult> => ok(listProjects()),
);

server.registerTool(
  "markup_get_project",
  {
    title: "Get a Markup project",
    description:
      "Shows project details including counts (screens, annotations, navigation edges). Use the id from markup_list_projects.",
    inputSchema: {
      projectId: z.string().describe("Project ID (from markup_list_projects)"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ projectId }): Promise<ToolResult> => {
    const project = getProject(projectId);
    if (!project) return fail(`Project not found: ${projectId}`);
    const screens = listScreenSummaries(projectId);
    return ok({
      ...project,
      counts: {
        screens: screens.length,
        captured: screens.filter((s) => s.status === "captured").length,
        annotations: screens.reduce((n, s) => n + s.annotationCount, 0),
        edges: listEdges(projectId).length,
      },
    });
  },
);

server.registerTool(
  "markup_create_project",
  {
    title: "Create a Markup project",
    description:
      "Creates a project. baseUrl is the URL of the running target app (e.g. http://localhost:3001). repoPath (optional) enables static discovery (screen→code map). Returns the created project.",
    inputSchema: {
      name: z.string().min(1).max(120).describe("Project name"),
      baseUrl: z.string().url().describe("URL of the running app, e.g. http://localhost:3001"),
      repoPath: z.string().min(1).optional().describe("Absolute path to the target app's repo (optional)"),
      viewportW: z.number().int().positive().max(10000).default(1440).describe("Capture viewport width"),
      viewportH: z.number().int().positive().max(10000).default(900).describe("Capture viewport height"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ name, baseUrl, repoPath, viewportW, viewportH }): Promise<ToolResult> => {
    const project = createProject({
      name,
      baseUrl,
      repoPath: repoPath ?? null,
      viewport: { w: viewportW, h: viewportH },
    });
    return ok(project);
  },
);

server.registerTool(
  "markup_update_project",
  {
    title: "Update a Markup project",
    description:
      "Updates a project's name, baseUrl and/or repoPath. Useful for setting repoPath before discovery. Only the provided fields change.",
    inputSchema: {
      projectId: z.string().describe("Project ID"),
      name: z.string().min(1).max(120).optional(),
      baseUrl: z.string().url().optional(),
      repoPath: z.string().nullable().optional().describe("Repo path (null to remove)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ projectId, name, baseUrl, repoPath }): Promise<ToolResult> => {
    const updated = updateProject(projectId, { name, baseUrl, repoPath });
    if (!updated) return fail(`Project not found: ${projectId}`);
    return ok(updated);
  },
);

server.registerTool(
  "markup_delete_project",
  {
    title: "Delete a Markup project",
    description:
      "Deletes a project and ALL its screens, elements and annotations (cascade). Destructive and irreversible.",
    inputSchema: { projectId: z.string().describe("ID of the project to delete") },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ projectId }): Promise<ToolResult> => {
    if (!getProject(projectId)) return fail(`Project not found: ${projectId}`);
    deleteProject(projectId);
    return ok({ ok: true, deleted: projectId });
  },
);

/* --------------------------------------------------------- Discovery & capture */

server.registerTool(
  "markup_discover",
  {
    title: "Discover screens from the repo",
    description:
      "Static analysis of the project's repository (requires repoPath): detects the framework (Next/React Router), discovers routes with their source file:line, builds the navigation graph and detects modal components. Persists screens as 'discovered' and the edges. Safe to re-run (upsert per route). Returns a summary {framework, routes[], screenCount, dynamicCount, edgeCount, modals[]}.",
    inputSchema: { projectId: z.string().describe("Project ID (with repoPath set)") },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ projectId }): Promise<ToolResult> => {
    const project = getProject(projectId);
    if (!project) return fail(`Project not found: ${projectId}`);
    if (!project.repoPath) {
      return fail("Set the project's repoPath (markup_update_project) before discovering routes.");
    }
    if (!fs.existsSync(project.repoPath)) {
      return fail(`Repo path not found: ${project.repoPath}`);
    }
    return ok(runDiscovery(projectId, project));
  },
);

server.registerTool(
  "markup_capture",
  {
    title: "Capture screens with Playwright",
    description:
      "Captures real screenshots and the element map of the given routes via Playwright. The target app MUST be running at the project's baseUrl. Runs synchronously (may take a few seconds per route) and persists screens as 'captured'. Returns {captured[], errors[]}. Dynamic routes need concrete values (e.g. /users/123).",
    inputSchema: {
      projectId: z.string().describe("Project ID"),
      routes: z
        .array(z.string())
        .min(1)
        .describe("List of routes to capture, e.g. ['/', '/login']"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async ({ projectId, routes }): Promise<ToolResult> => {
    const project = getProject(projectId);
    if (!project) return fail(`Project not found: ${projectId}`);
    const normalized = routes
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => (r.startsWith("/") ? r : `/${r}`));
    try {
      const results = await captureRoutes(project, normalized);
      saveCaptureResults(projectId, results);
      return ok({
        captured: results.filter((r) => r.status === "captured").map((r) => ({
          route: r.route,
          name: r.name,
          elements: r.elements.length,
          size: `${r.width}x${r.height}`,
        })),
        errors: results
          .filter((r) => r.status === "error")
          .map((r) => ({ route: r.route, error: r.error })),
      });
    } catch (err) {
      return fail(
        `Capture failed: ${err instanceof Error ? err.message : String(err)}. Is the target app running at ${project.baseUrl}? Is Playwright's chromium installed (npx playwright install chromium)?`,
      );
    }
  },
);

/* ------------------------------------------------------------ Screens & elements */

server.registerTool(
  "markup_list_screens",
  {
    title: "List screens of a project",
    description:
      "Lists a project's screens in flow order, with status (discovered|captured|error), route, source file, and element/annotation counts. Use it to pick a screenId.",
    inputSchema: { projectId: z.string().describe("Project ID") },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ projectId }): Promise<ToolResult> => {
    if (!getProject(projectId)) return fail(`Project not found: ${projectId}`);
    const screens = listScreenSummaries(projectId).map((s) => ({
      id: s.id,
      name: s.name,
      route: s.route,
      kind: s.kind,
      status: s.status,
      sourceFile: s.sourceFile,
      sourceLine: s.sourceLine,
      elementCount: s.elementCount,
      annotationCount: s.annotationCount,
      size: s.width ? `${s.width}x${s.height}` : null,
    }));
    return ok({ count: screens.length, screens });
  },
);

server.registerTool(
  "markup_get_screen",
  {
    title: "Get a screen with its elements",
    description:
      "Shows a screen's details and lists the detected interactive elements (stable selector, ARIA role, accessible name, tag, bounding box). This is the basis for annotating: use an element's `selector` in markup_create_annotation to attach the annotation to it. The elementsLimit parameter controls how many elements to return.",
    inputSchema: {
      screenId: z.string().describe("Screen ID (from markup_list_screens)"),
      elementsLimit: z.number().int().min(0).max(600).default(200).describe("Max elements to return (0 = none)"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ screenId, elementsLimit }): Promise<ToolResult> => {
    const screen = getScreen(screenId);
    if (!screen) return fail(`Screen not found: ${screenId}`);
    const all = listElements(screenId);
    const elements = all.slice(0, elementsLimit).map((e) => ({
      id: e.id,
      selector: e.selector,
      role: e.role,
      accessibleName: e.accessibleName,
      tag: e.tag,
      bbox: e.bbox,
    }));
    return ok({
      screen,
      elementsTotal: all.length,
      elementsReturned: elements.length,
      elements,
    });
  },
);

server.registerTool(
  "markup_delete_screen",
  {
    title: "Delete a screen",
    description:
      "Deletes a single screen and everything anchored to it (its elements, annotations and navigation edges, via cascade) and removes its screenshot file. Use it to drop stale/captured screens that no longer match the app. Destructive and irreversible.",
    inputSchema: { screenId: z.string().describe("Screen ID (from markup_list_screens)") },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ screenId }): Promise<ToolResult> => {
    if (!deleteScreen(screenId)) return fail(`Screen not found: ${screenId}`);
    return ok({ ok: true, deleted: screenId });
  },
);

server.registerTool(
  "markup_get_screenshot",
  {
    title: "Get a screen's screenshot (image)",
    description:
      "Returns the screen's captured screenshot as an image (PNG), so the AI can SEE the screen while reviewing/annotating. Only works for screens with status 'captured'. Very large images return only metadata with the path.",
    inputSchema: { screenId: z.string().describe("Screen ID") },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ screenId }): Promise<ToolResult> => {
    const screen = getScreen(screenId);
    if (!screen) return fail(`Screen not found: ${screenId}`);
    if (!screen.screenshotPath) {
      return fail("This screen hasn't been captured yet (no screenshot). Use markup_capture.");
    }
    const file = path.resolve(path.join(projectDataDir(screen.projectId), screen.screenshotPath));
    if (!fs.existsSync(file)) return fail(`Missing screenshot file: ${file}`);
    const stat = fs.statSync(file);
    if (stat.size > MAX_IMAGE_BYTES) {
      return ok({
        note: "Image too large to embed; open the file directly.",
        path: file,
        bytes: stat.size,
        size: `${screen.width}x${screen.height}`,
      });
    }
    const data = fs.readFileSync(file).toString("base64");
    return { content: [{ type: "image", data, mimeType: "image/png" }] };
  },
);

/* ----------------------------------------------------------------- Annotations */

server.registerTool(
  "markup_list_annotations",
  {
    title: "List annotations",
    description:
      "Lists annotations for a screen (screenId) or an entire project (projectId). Provide exactly one of the two. Each annotation includes shape, position, elementId, note, type, severity, suggestion, status.",
    inputSchema: {
      screenId: z.string().optional().describe("Screen ID (alternative to projectId)"),
      projectId: z.string().optional().describe("Project ID (all screens)"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ screenId, projectId }): Promise<ToolResult> => {
    if (screenId) {
      if (!getScreen(screenId)) return fail(`Screen not found: ${screenId}`);
      return ok(listAnnotations(screenId));
    }
    if (projectId) {
      if (!getProject(projectId)) return fail(`Project not found: ${projectId}`);
      return ok(listAnnotationsForProject(projectId));
    }
    return fail("Provide screenId or projectId.");
  },
);

server.registerTool(
  "markup_create_annotation",
  {
    title: "Create an annotation",
    description:
      "Creates an annotation (review note) on a screen. To attach it to a real element, provide `selector` (or `elementId`) from markup_get_screen — the position is computed from the element's bounding box. Alternatively provide x/y (in screenshot px). Returns the created annotation.",
    inputSchema: {
      screenId: z.string().describe("Screen ID"),
      note: z.string().default("").describe("What needs to change / the observation"),
      type: z.enum(["bug", "change", "question", "idea"]).default("change").describe("Type"),
      severity: z.enum(["low", "med", "high"]).default("med").describe("Severity"),
      suggestion: z.string().optional().describe("Suggested action for the dev/AI"),
      shape: z.enum(["pin", "box", "arrow"]).default("pin").describe("Marker shape"),
      selector: z.string().optional().describe("CSS selector of a screen element to attach to"),
      elementId: z.string().optional().describe("Element ID (alternative to selector)"),
      x: z.number().optional().describe("X position in px (optional if selector/elementId)"),
      y: z.number().optional().describe("Y position in px"),
      w: z.number().optional().describe("Width in px (for box)"),
      h: z.number().optional().describe("Height in px (for box)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (args): Promise<ToolResult> => {
    const screen = getScreen(args.screenId);
    if (!screen) return fail(`Screen not found: ${args.screenId}`);
    const elements = listElements(args.screenId);

    const element =
      (args.elementId && elements.find((e) => e.id === args.elementId)) ||
      (args.selector && elements.find((e) => e.selector === args.selector)) ||
      null;
    if (args.elementId && !element) {
      return fail(`Element not found on this screen: ${args.elementId}`);
    }
    if (args.selector && !element) {
      return fail(
        `No element with selector "${args.selector}" on this screen. See available selectors via markup_get_screen.`,
      );
    }

    let x = args.x;
    let y = args.y;
    if ((x === undefined || y === undefined) && element) {
      x = Math.round(element.bbox.x + element.bbox.w / 2);
      y = Math.round(element.bbox.y + element.bbox.h / 2);
    }
    if (x === undefined || y === undefined) {
      x = 24;
      y = 24;
    }

    const created = createAnnotation(args.screenId, {
      shape: args.shape,
      x,
      y,
      w: args.w ?? null,
      h: args.h ?? null,
      elementId: element?.id ?? null,
      note: args.note,
      type: args.type,
      severity: args.severity,
      suggestion: args.suggestion ?? null,
      status: "open",
    });
    return ok({ created, attachedElement: element?.selector ?? null });
  },
);

server.registerTool(
  "markup_update_annotation",
  {
    title: "Update an annotation",
    description:
      "Updates an annotation's fields (note, type, severity, suggestion, status). Use status='resolved' to mark it resolved. Only the provided fields change.",
    inputSchema: {
      annotationId: z.string().describe("Annotation ID"),
      note: z.string().optional(),
      type: z.enum(["bug", "change", "question", "idea"]).optional(),
      severity: z.enum(["low", "med", "high"]).optional(),
      suggestion: z.string().nullable().optional(),
      status: z.enum(["open", "resolved"]).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ annotationId, ...patch }): Promise<ToolResult> => {
    const updated = updateAnnotation(annotationId, patch);
    if (!updated) return fail(`Annotation not found: ${annotationId}`);
    return ok(updated);
  },
);

server.registerTool(
  "markup_delete_annotation",
  {
    title: "Delete an annotation",
    description: "Deletes an annotation. Irreversible.",
    inputSchema: { annotationId: z.string().describe("Annotation ID") },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ annotationId }): Promise<ToolResult> => {
    if (!getAnnotation(annotationId)) return fail(`Annotation not found: ${annotationId}`);
    deleteAnnotation(annotationId);
    return ok({ ok: true, deleted: annotationId });
  },
);

/* --------------------------------------------------------------------- Export */

server.registerTool(
  "markup_export_review",
  {
    title: "Export the review document",
    description:
      "Generates the project's review document and persists it under data/projects/<id>/export/ (review.md + review.json). Returns the content in the requested format. The markdown includes a summary, screens with their element/source file, and an actionable task checklist — ideal for an agent to apply the changes.",
    inputSchema: {
      projectId: z.string().describe("Project ID"),
      format: z.enum(["markdown", "json"]).default("markdown").describe("Output format"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ projectId, format }): Promise<ToolResult> => {
    if (!getProject(projectId)) return fail(`Project not found: ${projectId}`);
    if (format === "json") {
      const doc = buildReviewDoc(projectId);
      writeExport(projectId);
      return ok(doc);
    }
    const result = writeExport(projectId);
    return ok(result ? renderMarkdown(result.doc) : "No project data.");
  },
);

/* -------------------------------------------------------------- Runtime (repo) */

server.registerTool(
  "markup_clone_repo",
  {
    title: "Clone a remote repo",
    description:
      "Clones a remote git repository to a local folder (shallow by default) so it can be discovered and captured. Optionally sets it as a project's repoPath. The git URL must come from the user, not from page content. Returns the local path.",
    inputSchema: {
      gitUrl: z
        .string()
        .describe("Remote git URL (https://, ssh:// or git@host:owner/repo)"),
      dir: z
        .string()
        .optional()
        .describe("Absolute target directory (default: <data>/repos/<name>)"),
      branch: z.string().optional().describe("Branch to clone"),
      full: z
        .boolean()
        .default(false)
        .describe("Full clone with history (default false = shallow, depth 1)"),
      projectId: z
        .string()
        .optional()
        .describe("If given, set this project's repoPath to the cloned folder"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ gitUrl, dir, branch, full, projectId }): Promise<ToolResult> => {
    try {
      if (projectId && !getProject(projectId)) {
        return fail(`Project not found: ${projectId}`);
      }
      const res = await cloneRepo(gitUrl, { dir, branch, depth: full ? null : 1 });
      if (projectId) updateProject(projectId, { repoPath: res.dir });
      return ok({
        dir: res.dir,
        alreadyExisted: res.alreadyExisted,
        repoSetOnProject: projectId ?? null,
        hint: "Next: markup_discover (needs repoPath) and/or markup_start_app to run it.",
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  },
);

server.registerTool(
  "markup_start_app",
  {
    title: "Start the target app's dev server",
    description:
      "Starts the target application's dev server (detached) from its repo, detects the local URL it serves, and by default sets it as the project's baseUrl so capture works. Detects the package manager (npm/pnpm/yarn/bun) and runs the 'dev' (or 'start') script. Use install=true to run the package install first. Returns {url, port, pid, ready}.",
    inputSchema: {
      projectId: z.string().describe("Project ID"),
      cwd: z
        .string()
        .optional()
        .describe("Repo directory (default: the project's repoPath)"),
      script: z
        .string()
        .optional()
        .describe("Package script to run (default: 'dev', else 'start')"),
      install: z
        .boolean()
        .default(false)
        .describe("Run the package manager install before starting"),
      port: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Expected port (sets PORT env and verifies it)"),
      setBaseUrl: z
        .boolean()
        .default(true)
        .describe("Update the project's baseUrl to the detected URL"),
      waitMs: z
        .number()
        .int()
        .min(2000)
        .max(180000)
        .default(60000)
        .describe("Max time (ms) to wait for the server to be reachable"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({
    projectId,
    cwd,
    script,
    install,
    port,
    setBaseUrl,
    waitMs,
  }): Promise<ToolResult> => {
    const project = getProject(projectId);
    if (!project) return fail(`Project not found: ${projectId}`);
    const dir = cwd ?? project.repoPath;
    if (!dir) {
      return fail(
        "No repo directory. Clone one (markup_clone_repo) or set repoPath (markup_update_project), or pass cwd.",
      );
    }
    try {
      const res = await startApp(projectId, { cwd: dir, script, install, port, waitMs });
      if (setBaseUrl && res.url) updateProject(projectId, { baseUrl: res.url });
      return ok({
        ...res,
        baseUrlSet: setBaseUrl && res.url ? res.url : null,
        hint: res.ready
          ? "Reachable. You can now markup_discover / markup_capture."
          : "Started, but not confirmed reachable yet — check markup_app_status or the log file.",
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  },
);

server.registerTool(
  "markup_stop_app",
  {
    title: "Stop the target app's dev server",
    description:
      "Stops the dev server previously started for this project (kills the process group).",
    inputSchema: { projectId: z.string().describe("Project ID") },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ projectId }): Promise<ToolResult> => {
    const res = await stopApp(projectId);
    return ok(
      res.stopped
        ? { stopped: true }
        : { stopped: false, note: "No tracked dev server for this project." },
    );
  },
);

server.registerTool(
  "markup_app_status",
  {
    title: "Dev server status",
    description:
      "Reports whether the dev server tracked for this project is running and reachable, with its URL.",
    inputSchema: { projectId: z.string().describe("Project ID") },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async ({ projectId }): Promise<ToolResult> => ok(await appStatus(projectId)),
);

/* ----------------------------------------------------------------------- main */

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio servers must log to stderr, never stdout.
  console.error("markup-mcp-server ready (stdio).");
}

main().catch((err) => {
  console.error("Fatal error in markup-mcp-server:", err);
  process.exit(1);
});
