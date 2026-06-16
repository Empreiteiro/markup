import { nanoid } from "nanoid";
import { getDb } from "./index";
import type { NavEdge } from "../types";

interface EdgeRow {
  id: string;
  project_id: string;
  from_screen_id: string;
  to_screen_id: string;
  trigger: string | null;
  kind: NavEdge["kind"];
}

function toEdge(r: EdgeRow): NavEdge {
  return {
    id: r.id,
    projectId: r.project_id,
    fromScreenId: r.from_screen_id,
    toScreenId: r.to_screen_id,
    trigger: r.trigger,
    kind: r.kind,
  };
}

export function listEdges(projectId: string): NavEdge[] {
  const rows = getDb()
    .prepare("SELECT * FROM nav_edges WHERE project_id = ?")
    .all(projectId) as EdgeRow[];
  return rows.map(toEdge);
}

export interface NewEdge {
  fromScreenId: string;
  toScreenId: string;
  trigger?: string | null;
  kind?: NavEdge["kind"];
}

/** Replace all edges for a project (used by discovery in Phase 4). */
export function replaceEdges(projectId: string, edges: NewEdge[]): void {
  const db = getDb();
  const del = db.prepare("DELETE FROM nav_edges WHERE project_id = ?");
  const ins = db.prepare(
    `INSERT INTO nav_edges (id, project_id, from_screen_id, to_screen_id, trigger, kind)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((items: NewEdge[]) => {
    del.run(projectId);
    for (const e of items) {
      ins.run(
        nanoid(12),
        projectId,
        e.fromScreenId,
        e.toScreenId,
        e.trigger ?? null,
        e.kind ?? "navigate",
      );
    }
  });
  tx(edges);
}
