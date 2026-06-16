import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA } from "./schema";

// Local-first storage: a single SQLite file plus per-project asset folders,
// all under ./data (gitignored). This module is server-only — never import it
// from a client component.

export const DATA_DIR = process.env.MARKUP_DATA_DIR
  ? path.resolve(process.env.MARKUP_DATA_DIR)
  : path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "markup.db");

let instance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (instance) return instance;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  instance = db;
  return db;
}

/** Absolute path to a project's asset directory (screenshots, exports). */
export function projectDataDir(projectId: string): string {
  return path.join(DATA_DIR, "projects", projectId);
}
