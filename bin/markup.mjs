#!/usr/bin/env node
// markup CLI — runs the web UI and the MCP server from an installed package, so
// the tool can be used without cloning (e.g. `npm i -g github:Empreiteiro/markup`).
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cmd = process.argv[2];
const rest = process.argv.slice(3);
const port = process.env.PORT || "3900";

// UI and MCP must share one data dir (SQLite + screenshots). Default to a stable
// per-user location; override with MARKUP_DATA_DIR.
const dataDir =
  process.env.MARKUP_DATA_DIR || path.join(os.homedir(), ".markup", "data");
fs.mkdirSync(dataDir, { recursive: true });
const env = { ...process.env, MARKUP_DATA_DIR: dataDir };

const binPath = (name) => path.join(root, "node_modules", ".bin", name);

function run(name, args) {
  const file = binPath(name);
  if (!fs.existsSync(file)) {
    console.error(
      `Missing dependency "${name}". Run \`npm install\` inside ${root}.`,
    );
    process.exit(1);
  }
  const child = spawn(file, args, { cwd: root, stdio: "inherit", env });
  child.on("exit", (code) => process.exit(code ?? 0));
}

function help() {
  console.log(`markup — visual screen review

Usage:
  markup ui        Start the web UI at http://localhost:${port}
  markup mcp       Run the MCP server (stdio) for Claude Code / Cursor
  markup setup     Install the Playwright Chromium browser (needed for capture)

Data dir: ${dataDir}
  (override with the MARKUP_DATA_DIR env var; UI and MCP must use the same one)

Register the MCP in Claude Code:
  claude mcp add markup -- markup mcp`);
}

switch (cmd) {
  case "ui":
  case "up":
  case "dev":
    run("next", ["dev", "-p", port, ...rest]);
    break;
  case "mcp":
    run("tsx", [path.join(root, "src", "mcp", "server.ts"), ...rest]);
    break;
  case "setup":
    run("playwright", ["install", "chromium", ...rest]);
    break;
  case undefined:
  case "help":
  case "-h":
  case "--help":
    help();
    break;
  default:
    console.error(`Unknown command: ${cmd}\n`);
    help();
    process.exit(1);
}
