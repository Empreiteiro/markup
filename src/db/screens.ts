import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { getDb, projectDataDir } from "./index";
import type { ElementInfo, Screen } from "../types";
import type { CaptureRouteResult } from "../capture/crawler";

interface ScreenRow {
  id: string;
  project_id: string;
  kind: "page" | "modal";
  name: string;
  route: string | null;
  source_file: string | null;
  source_line: number | null;
  parent_screen_id: string | null;
  screenshot_path: string | null;
  width: number | null;
  height: number | null;
  pos_x: number | null;
  pos_y: number | null;
  ord: number;
  status: Screen["status"];
  error: string | null;
  created_at: string;
}

interface ElementRow {
  id: string;
  screen_id: string;
  selector: string;
  role: string | null;
  accessible_name: string | null;
  text: string | null;
  tag: string | null;
  bbox_x: number;
  bbox_y: number;
  bbox_w: number;
  bbox_h: number;
  source_file: string | null;
  source_line: number | null;
}

function toScreen(r: ScreenRow): Screen {
  return {
    id: r.id,
    projectId: r.project_id,
    kind: r.kind,
    name: r.name,
    route: r.route,
    sourceFile: r.source_file,
    sourceLine: r.source_line,
    parentScreenId: r.parent_screen_id,
    screenshotPath: r.screenshot_path,
    width: r.width,
    height: r.height,
    pos: r.pos_x != null && r.pos_y != null ? { x: r.pos_x, y: r.pos_y } : null,
    order: r.ord,
    status: r.status,
    error: r.error,
    createdAt: r.created_at,
  };
}

function toElement(r: ElementRow): ElementInfo {
  return {
    id: r.id,
    screenId: r.screen_id,
    selector: r.selector,
    role: r.role,
    accessibleName: r.accessible_name,
    text: r.text,
    tag: r.tag,
    bbox: { x: r.bbox_x, y: r.bbox_y, w: r.bbox_w, h: r.bbox_h },
    sourceFile: r.source_file,
    sourceLine: r.source_line,
  };
}

export function listScreens(projectId: string): Screen[] {
  const rows = getDb()
    .prepare("SELECT * FROM screens WHERE project_id = ? ORDER BY ord, created_at")
    .all(projectId) as ScreenRow[];
  return rows.map(toScreen);
}

export interface ScreenSummary extends Screen {
  elementCount: number;
  annotationCount: number;
}

export function listScreenSummaries(projectId: string): ScreenSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT s.*,
         (SELECT COUNT(*) FROM elements e WHERE e.screen_id = s.id) AS element_count,
         (SELECT COUNT(*) FROM annotations a WHERE a.screen_id = s.id) AS annotation_count
       FROM screens s WHERE s.project_id = ? ORDER BY s.ord, s.created_at`,
    )
    .all(projectId) as (ScreenRow & {
    element_count: number;
    annotation_count: number;
  })[];
  return rows.map((r) => ({
    ...toScreen(r),
    elementCount: r.element_count,
    annotationCount: r.annotation_count,
  }));
}

export function getScreen(id: string): Screen | null {
  const row = getDb()
    .prepare("SELECT * FROM screens WHERE id = ?")
    .get(id) as ScreenRow | undefined;
  return row ? toScreen(row) : null;
}

/**
 * Delete a screen and everything anchored to it. The FK graph cascades to its
 * elements, annotations and nav edges (both directions) via ON DELETE CASCADE;
 * we additionally remove the screenshot file from disk. Returns false if the
 * screen does not exist.
 */
export function deleteScreen(id: string): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT project_id, screenshot_path FROM screens WHERE id = ?")
    .get(id) as
    | { project_id: string; screenshot_path: string | null }
    | undefined;
  if (!row) return false;
  db.prepare("DELETE FROM screens WHERE id = ?").run(id);
  if (row.screenshot_path) {
    try {
      fs.rmSync(path.join(projectDataDir(row.project_id), row.screenshot_path), {
        force: true,
      });
    } catch {
      // best-effort: a missing/locked file must not fail the delete
    }
  }
  return true;
}

export function listElements(screenId: string): ElementInfo[] {
  const rows = getDb()
    .prepare("SELECT * FROM elements WHERE screen_id = ? ORDER BY bbox_y, bbox_x")
    .all(screenId) as ElementRow[];
  return rows.map(toElement);
}

export function updateScreenPosition(id: string, x: number, y: number): void {
  getDb()
    .prepare("UPDATE screens SET pos_x = ?, pos_y = ? WHERE id = ?")
    .run(x, y, id);
}

export function updateScreenPositions(
  items: { id: string; x: number; y: number }[],
): void {
  const db = getDb();
  const stmt = db.prepare("UPDATE screens SET pos_x = ?, pos_y = ? WHERE id = ?");
  const tx = db.transaction((arr: { id: string; x: number; y: number }[]) => {
    for (const it of arr) stmt.run(it.x, it.y, it.id);
  });
  tx(items);
}

/**
 * Persist capture results. Re-captures upsert by (projectId, route) so a page's
 * screen id — and thus its annotations — survive across runs; the element set is
 * always replaced with the latest capture.
 */
export function saveCaptureResults(
  projectId: string,
  results: CaptureRouteResult[],
): void {
  const db = getDb();
  const findByRoute = db.prepare(
    "SELECT id FROM screens WHERE project_id = ? AND route = ? AND kind = 'page'",
  );
  const updateScreen = db.prepare(
    `UPDATE screens
       SET name = ?, screenshot_path = ?, width = ?, height = ?, ord = ?, status = ?, error = ?
     WHERE id = ?`,
  );
  const insertScreen = db.prepare(
    `INSERT INTO screens
       (id, project_id, kind, name, route, screenshot_path, width, height, ord, status, error, created_at)
     VALUES (?, ?, 'page', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const deleteElements = db.prepare("DELETE FROM elements WHERE screen_id = ?");
  const insertElement = db.prepare(
    `INSERT INTO elements
       (id, screen_id, selector, role, accessible_name, text, tag, bbox_x, bbox_y, bbox_w, bbox_h)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const tx = db.transaction((items: CaptureRouteResult[]) => {
    items.forEach((r, idx) => {
      const existing = findByRoute.get(projectId, r.route) as
        | { id: string }
        | undefined;
      let screenId: string;
      if (existing) {
        screenId = existing.id;
        updateScreen.run(
          r.name,
          r.screenshotRelPath,
          r.width,
          r.height,
          idx,
          r.status,
          r.error ?? null,
          screenId,
        );
        deleteElements.run(screenId);
      } else {
        screenId = nanoid(12);
        insertScreen.run(
          screenId,
          projectId,
          r.name,
          r.route,
          r.screenshotRelPath,
          r.width,
          r.height,
          idx,
          r.status,
          r.error ?? null,
          new Date().toISOString(),
        );
      }
      for (const el of r.elements) {
        insertElement.run(
          nanoid(12),
          screenId,
          el.selector,
          el.role,
          el.accessibleName,
          el.text,
          el.tag,
          el.bbox.x,
          el.bbox.y,
          el.bbox.w,
          el.bbox.h,
        );
      }
    });
  });
  tx(results);
}

/** Upsert statically-discovered screens by (projectId, route): sets source
 * mapping and, for not-yet-captured screens, the name; never clobbers an
 * existing screenshot/status. Returns a route → screenId map for edge wiring. */
export function upsertDiscoveredScreens(
  projectId: string,
  screens: {
    route: string;
    name: string;
    sourceFile: string;
    sourceLine: number | null;
  }[],
): Map<string, string> {
  const db = getDb();
  const find = db.prepare(
    "SELECT id FROM screens WHERE project_id = ? AND route = ? AND kind = 'page'",
  );
  const upd = db.prepare(
    `UPDATE screens SET source_file = ?, source_line = ?,
       name = CASE WHEN status = 'discovered' THEN ? ELSE name END
     WHERE id = ?`,
  );
  const ins = db.prepare(
    `INSERT INTO screens
       (id, project_id, kind, name, route, source_file, source_line, ord, status, created_at)
     VALUES (?, ?, 'page', ?, ?, ?, ?, ?, 'discovered', ?)`,
  );
  const map = new Map<string, string>();
  const tx = db.transaction((items: typeof screens) => {
    items.forEach((s, idx) => {
      const ex = find.get(projectId, s.route) as { id: string } | undefined;
      let sid: string;
      if (ex) {
        sid = ex.id;
        upd.run(s.sourceFile, s.sourceLine, s.name, sid);
      } else {
        sid = nanoid(12);
        ins.run(
          sid,
          projectId,
          s.name,
          s.route,
          s.sourceFile,
          s.sourceLine,
          idx,
          new Date().toISOString(),
        );
      }
      map.set(s.route, sid);
    });
  });
  tx(screens);
  return map;
}
