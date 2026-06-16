import { nanoid } from "nanoid";
import { getDb } from "./index";
import type { Annotation } from "../types";
import type {
  CreateAnnotationInput,
  UpdateAnnotationInput,
} from "../types/schemas";

interface AnnotationRow {
  id: string;
  screen_id: string;
  shape: Annotation["shape"];
  x: number;
  y: number;
  w: number | null;
  h: number | null;
  element_id: string | null;
  note: string;
  type: Annotation["type"];
  severity: Annotation["severity"];
  suggestion: string | null;
  status: Annotation["status"];
  created_at: string;
}

function toAnnotation(r: AnnotationRow): Annotation {
  return {
    id: r.id,
    screenId: r.screen_id,
    shape: r.shape,
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    elementId: r.element_id,
    note: r.note,
    type: r.type,
    severity: r.severity,
    suggestion: r.suggestion,
    status: r.status,
    createdAt: r.created_at,
  };
}

export function listAnnotations(screenId: string): Annotation[] {
  const rows = getDb()
    .prepare("SELECT * FROM annotations WHERE screen_id = ? ORDER BY created_at")
    .all(screenId) as AnnotationRow[];
  return rows.map(toAnnotation);
}

export function listAnnotationsForProject(projectId: string): Annotation[] {
  const rows = getDb()
    .prepare(
      `SELECT a.* FROM annotations a
       JOIN screens s ON s.id = a.screen_id
       WHERE s.project_id = ?
       ORDER BY s.ord, a.created_at`,
    )
    .all(projectId) as AnnotationRow[];
  return rows.map(toAnnotation);
}

export function getAnnotation(id: string): Annotation | null {
  const row = getDb()
    .prepare("SELECT * FROM annotations WHERE id = ?")
    .get(id) as AnnotationRow | undefined;
  return row ? toAnnotation(row) : null;
}

export function createAnnotation(
  screenId: string,
  input: CreateAnnotationInput,
): Annotation {
  const id = nanoid(12);
  getDb()
    .prepare(
      `INSERT INTO annotations
         (id, screen_id, shape, x, y, w, h, element_id, note, type, severity, suggestion, status, created_at)
       VALUES
         (@id, @screen_id, @shape, @x, @y, @w, @h, @element_id, @note, @type, @severity, @suggestion, @status, @created_at)`,
    )
    .run({
      id,
      screen_id: screenId,
      shape: input.shape,
      x: input.x,
      y: input.y,
      w: input.w ?? null,
      h: input.h ?? null,
      element_id: input.elementId ?? null,
      note: input.note,
      type: input.type,
      severity: input.severity,
      suggestion: input.suggestion ?? null,
      status: input.status,
      created_at: new Date().toISOString(),
    });
  return getAnnotation(id)!;
}

export function updateAnnotation(
  id: string,
  patch: UpdateAnnotationInput,
): Annotation | null {
  if (!getAnnotation(id)) return null;
  const fields: string[] = [];
  const params: Record<string, unknown> = { id };
  const set = (col: string, val: unknown) => {
    fields.push(`${col} = @${col}`);
    params[col] = val;
  };
  if (patch.x !== undefined) set("x", patch.x);
  if (patch.y !== undefined) set("y", patch.y);
  if (patch.w !== undefined) set("w", patch.w ?? null);
  if (patch.h !== undefined) set("h", patch.h ?? null);
  if (patch.elementId !== undefined) set("element_id", patch.elementId ?? null);
  if (patch.note !== undefined) set("note", patch.note);
  if (patch.type !== undefined) set("type", patch.type);
  if (patch.severity !== undefined) set("severity", patch.severity);
  if (patch.suggestion !== undefined) set("suggestion", patch.suggestion ?? null);
  if (patch.status !== undefined) set("status", patch.status);
  if (fields.length) {
    getDb()
      .prepare(`UPDATE annotations SET ${fields.join(", ")} WHERE id = @id`)
      .run(params);
  }
  return getAnnotation(id);
}

export function deleteAnnotation(id: string): void {
  getDb().prepare("DELETE FROM annotations WHERE id = ?").run(id);
}
