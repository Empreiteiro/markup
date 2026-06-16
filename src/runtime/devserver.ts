import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { DATA_DIR } from "../db";

// Tracks dev servers started for projects. Detached child processes survive the
// MCP process, so the registry (on disk) lets us stop/inspect them later.

interface ServerRecord {
  projectId: string;
  pid: number;
  url: string | null;
  port: number | null;
  command: string;
  cwd: string;
  logFile: string;
  startedAt: string;
}

type PackageManager = "pnpm" | "yarn" | "bun" | "npm";

const REGISTRY = path.join(DATA_DIR, "servers.json");
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function readRegistry(): Record<string, ServerRecord> {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
  } catch {
    return {};
  }
}
function writeRegistry(r: Record<string, ServerRecord>): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY, JSON.stringify(r, null, 2));
}
function safeRead(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
function tail(s: string, n: number): string {
  return s.length <= n ? s : s.slice(s.length - n);
}
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function detectPackageManager(cwd: string): PackageManager {
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(cwd, "bun.lockb"))) return "bun";
  return "npm";
}

function readScripts(cwd: string): Record<string, string> {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

function probe(url: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

export interface StartOptions {
  cwd: string;
  /** npm script to run. Default: "dev", else "start". */
  script?: string;
  /** Run `<pm> install` before starting. */
  install?: boolean;
  /** Expected port (sets PORT env and is used to verify reachability). */
  port?: number;
  /** Max time to wait for the server to become reachable. Default 60s. */
  waitMs?: number;
}

export interface StartResult {
  url: string | null;
  port: number | null;
  pid: number;
  command: string;
  logFile: string;
  ready: boolean;
}

export async function startApp(
  projectId: string,
  opts: StartOptions,
): Promise<StartResult> {
  const cwd = path.resolve(opts.cwd);
  if (!fs.existsSync(cwd)) throw new Error(`Directory not found: ${cwd}`);

  // Stop any previously tracked server for this project first.
  await stopApp(projectId).catch(() => {});

  const pm = detectPackageManager(cwd);
  const scripts = readScripts(cwd);
  const script =
    opts.script ?? (scripts.dev ? "dev" : scripts.start ? "start" : null);
  if (!script) {
    throw new Error(
      `No "dev" or "start" script in ${path.join(cwd, "package.json")}. Available scripts: ${
        Object.keys(scripts).join(", ") || "(none)"
      }`,
    );
  }
  if (opts.script && !scripts[opts.script]) {
    throw new Error(
      `Script "${opts.script}" not found. Available: ${Object.keys(scripts).join(", ") || "(none)"}`,
    );
  }

  if (opts.install) {
    await new Promise<void>((resolve, reject) => {
      const inst = spawn(pm, ["install"], { cwd, stdio: "ignore" });
      inst.on("error", reject);
      inst.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`${pm} install exited with code ${code}`)),
      );
    });
  }

  fs.mkdirSync(path.join(DATA_DIR, "logs"), { recursive: true });
  const logFile = path.join(DATA_DIR, "logs", `app-${projectId}.log`);
  const out = fs.openSync(logFile, "w");

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BROWSER: "none",
    FORCE_COLOR: "0",
    ...(opts.port ? { PORT: String(opts.port) } : {}),
  };
  const child = spawn(pm, ["run", script], {
    cwd,
    detached: true,
    stdio: ["ignore", out, out],
    env,
  });
  child.unref();
  const pid = child.pid;
  if (!pid) throw new Error("Failed to spawn the dev server process.");
  const command = `${pm} run ${script}`;

  let url: string | null = opts.port ? `http://localhost:${opts.port}` : null;
  let port: number | null = opts.port ?? null;
  let ready = false;
  const deadline = Date.now() + (opts.waitMs ?? 60_000);
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) {
      throw new Error(`Dev server exited early. Last log:\n${tail(safeRead(logFile), 1500)}`);
    }
    const m = safeRead(logFile).match(URL_RE);
    if (m) {
      port = Number(m[1]);
      url = `http://localhost:${port}`;
    }
    if (url && (await probe(url))) {
      ready = true;
      break;
    }
    await sleep(700);
  }

  const reg = readRegistry();
  reg[projectId] = {
    projectId,
    pid,
    url,
    port,
    command,
    cwd,
    logFile,
    startedAt: new Date().toISOString(),
  };
  writeRegistry(reg);

  return { url, port, pid, command, logFile, ready };
}

export async function stopApp(projectId: string): Promise<{ stopped: boolean }> {
  const reg = readRegistry();
  const rec = reg[projectId];
  if (!rec) return { stopped: false };
  try {
    // Detached child is a process-group leader; kill the whole group.
    process.kill(-rec.pid, "SIGTERM");
  } catch {
    try {
      process.kill(rec.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  delete reg[projectId];
  writeRegistry(reg);
  return { stopped: true };
}

export async function appStatus(projectId: string): Promise<{
  running: boolean;
  reachable: boolean;
  url: string | null;
  pid: number | null;
  command?: string;
  startedAt?: string;
}> {
  const rec = readRegistry()[projectId];
  if (!rec) return { running: false, reachable: false, url: null, pid: null };
  const running = pidAlive(rec.pid);
  const reachable = running && rec.url ? await probe(rec.url) : false;
  return {
    running,
    reachable,
    url: rec.url,
    pid: rec.pid,
    command: rec.command,
    startedAt: rec.startedAt,
  };
}
