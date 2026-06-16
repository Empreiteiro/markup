import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { DATA_DIR } from "../db";

const execFileAsync = promisify(execFile);

// Accept https/ssh/git URLs and scp-like git@host:owner/repo form.
const GIT_URL_RE = /^(https?:\/\/|ssh:\/\/|git:\/\/|git@[^\s/]+:)/i;

export interface CloneOptions {
  /** Absolute target directory. Default: <DATA_DIR>/repos/<repoName>. */
  dir?: string;
  branch?: string;
  /** Clone depth; null = full history. Default 1 (shallow). */
  depth?: number | null;
}

function repoNameFromUrl(url: string): string {
  const cleaned = url.replace(/\.git$/i, "").replace(/\/+$/, "");
  const last = cleaned.split(/[/:]/).pop() ?? "repo";
  return last.replace(/[^a-zA-Z0-9._-]/g, "-") || "repo";
}

/** Clone a remote git repository to a local folder (shallow by default). */
export async function cloneRepo(
  gitUrl: string,
  opts: CloneOptions = {},
): Promise<{ dir: string; alreadyExisted: boolean }> {
  const url = gitUrl.trim();
  if (!GIT_URL_RE.test(url)) {
    throw new Error(
      `Invalid git URL: "${gitUrl}". Use https://, ssh:// or git@host:owner/repo.`,
    );
  }
  const target = opts.dir
    ? path.resolve(opts.dir)
    : path.join(DATA_DIR, "repos", repoNameFromUrl(url));

  if (fs.existsSync(path.join(target, ".git"))) {
    return { dir: target, alreadyExisted: true };
  }
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    throw new Error(`Target directory exists and is not empty: ${target}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const args = ["clone"];
  if (opts.depth !== null) args.push("--depth", String(opts.depth ?? 1));
  if (opts.branch) args.push("--branch", opts.branch);
  args.push("--", url, target);

  try {
    await execFileAsync("git", args, {
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === "ENOENT") throw new Error("git is not installed or not on PATH.");
    throw new Error(`git clone failed: ${(e.stderr || e.message || "").trim()}`);
  }
  return { dir: target, alreadyExisted: false };
}
