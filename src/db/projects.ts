import { nanoid } from "nanoid";
import { getDb } from "./index";
import type { Project } from "../types";
import type { CreateProjectInput } from "../types/schemas";

interface ProjectRow {
  id: string;
  name: string;
  repo_path: string | null;
  base_url: string;
  viewport_w: number;
  viewport_h: number;
  auth_storage_state: string | null;
  created_at: string;
}

function toProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    repoPath: r.repo_path,
    baseUrl: r.base_url,
    viewport: { w: r.viewport_w, h: r.viewport_h },
    authStorageState: r.auth_storage_state,
    createdAt: r.created_at,
  };
}

export function listProjects(): Project[] {
  const rows = getDb()
    .prepare("SELECT * FROM projects ORDER BY created_at DESC")
    .all() as ProjectRow[];
  return rows.map(toProject);
}

export function getProject(id: string): Project | null {
  const row = getDb()
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(id) as ProjectRow | undefined;
  return row ? toProject(row) : null;
}

export function createProject(input: CreateProjectInput): Project {
  const id = nanoid(12);
  const createdAt = new Date().toISOString();
  const vp = input.viewport ?? { w: 1440, h: 900 };
  getDb()
    .prepare(
      `INSERT INTO projects
         (id, name, repo_path, base_url, viewport_w, viewport_h, auth_storage_state, created_at)
       VALUES
         (@id, @name, @repo_path, @base_url, @viewport_w, @viewport_h, @auth_storage_state, @created_at)`,
    )
    .run({
      id,
      name: input.name,
      repo_path: input.repoPath ?? null,
      base_url: input.baseUrl,
      viewport_w: vp.w,
      viewport_h: vp.h,
      auth_storage_state: input.authStorageState ?? null,
      created_at: createdAt,
    });
  return getProject(id)!;
}

export function updateProject(
  id: string,
  patch: { name?: string; baseUrl?: string; repoPath?: string | null },
): Project | null {
  if (!getProject(id)) return null;
  const fields: string[] = [];
  const params: Record<string, unknown> = { id };
  if (patch.name !== undefined) {
    fields.push("name = @name");
    params.name = patch.name;
  }
  if (patch.baseUrl !== undefined) {
    fields.push("base_url = @base_url");
    params.base_url = patch.baseUrl;
  }
  if (patch.repoPath !== undefined) {
    fields.push("repo_path = @repo_path");
    params.repo_path = patch.repoPath ?? null;
  }
  if (fields.length) {
    getDb()
      .prepare(`UPDATE projects SET ${fields.join(", ")} WHERE id = @id`)
      .run(params);
  }
  return getProject(id);
}

export function deleteProject(id: string): void {
  getDb().prepare("DELETE FROM projects WHERE id = ?").run(id);
}
