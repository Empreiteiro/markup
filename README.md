# Markup — visual screen review

A tool that **reads a target application, discovers and captures all of its screens/modals, lays them out on a flow-ordered (UX) canvas, lets you add visual annotations anchored to real elements and to the source code, and exports a review document** consumable by an AI (Claude Code, Cursor, IBM Bob) or a developer.

## Demo

https://github.com/user-attachments/assets/3e7c55af-5879-42c9-adbe-c70d7f62169e

## How it works

1. **Install Markup & start the MCP server** — install the CLI and register `markup mcp` in your IDE (see [Installation](#installation)).
2. **Start the app you want to review** — any running URL works (e.g. `http://localhost:3000`).
3. **Discover the screens from your favourite IDE** — ask the MCP server (Claude Code, Cursor, VS Code, Bob…) to run discovery and capture, giving it your app's URL. It maps the routes, screenshots each screen and extracts its element map.
4. **Open the Markup UI to review & annotate** — go through the screens on the grid/canvas and drop annotations (pins, boxes, arrows), auto-anchored to the real element and to `file:line`.
5. **Ship the result** — export the final `review.md` / `review.json` with every annotation, **or** let your AI pull the annotations through the MCP and apply all the fixes to your codebase in one pass.

> Capture works against an **already-running URL**. The MCP can also clone a repo and boot its dev server for you (`markup_clone_repo`, `markup_start_app`).

## Demo 2

https://github.com/user-attachments/assets/f14a40ca-7709-48e4-8873-d8584c463255

## Installation

### Without cloning (via npm + GitHub) — fastest

Installs the `markup` CLI straight from the repo, no `git clone`:

```bash
npm i -g github:Empreiteiro/markup
markup setup      # one-time: downloads the Playwright Chromium browser (for capture)
markup ui         # UI at http://localhost:3900
```

Register the MCP in Claude Code:

```bash
claude mcp add markup -- markup mcp
```

> Data lives in `~/.markup/data` (SQLite + screenshots), shared by the UI and the MCP. Override with `MARKUP_DATA_DIR`.

### Cloning (development)

```bash
git clone https://github.com/Empreiteiro/markup.git
cd markup
make init          # npm install + Playwright Chromium
make dev           # UI at http://localhost:3900
make mcp           # MCP server (stdio)
```

Data in `./data` (gitignored).

## MCP integration (Claude Code / Claude Desktop / Cursor / VS Code / IBM Bob)

The platform is exposed as an **MCP server (stdio)** in [src/mcp/server.ts](src/mcp/server.ts), reusing the same SQLite store (`./data`) — the web server does **not** need to be running. So Claude Code, Cursor, IBM Bob or any MCP client can **run discovery, view screens/elements and create/edit annotations** programmatically.

Run it manually: `markup mcp` (installed via npm) or `npm run mcp` (in a cloned repo).

All clients share the same JSON shape — an `mcpServers` object. The simplest entry (after `npm i -g github:Empreiteiro/markup`):

```json
{
  "mcpServers": {
    "markup": { "command": "markup", "args": ["mcp"] }
  }
}
```

> **Cloned repo instead of the global CLI?** Point at the local `tsx`:
> ```json
> {
>   "mcpServers": {
>     "markup": {
>       "command": "<repo>/node_modules/.bin/tsx",
>       "args": ["<repo>/src/mcp/server.ts"],
>       "env": { "MARKUP_DATA_DIR": "<repo>/data" }
>     }
>   }
> }
> ```

> **GUI apps and `PATH`:** desktop clients (Claude Desktop, Cursor, VS Code, Bob) don't always inherit your shell `PATH`, so the bare `markup` command may not resolve. If the server fails to start, replace `"command": "markup"` with the absolute path from `which markup` (e.g. `/usr/local/bin/markup` or an nvm path like `~/.nvm/versions/node/<v>/bin/markup`).

### Claude Code

```bash
claude mcp add markup -- markup mcp
```

Or edit `.mcp.json` (project) / `~/.claude.json` (global) with the `mcpServers` block above.

### Claude Desktop

Open **Settings → Developer → Edit Config** (or edit the file directly), add the server, and restart Claude Desktop:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "markup": { "command": "markup", "args": ["mcp"] }
  }
}
```

### Cursor

Add the server to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "markup": { "command": "markup", "args": ["mcp"] }
  }
}
```

Or via the UI: **Settings → Tools & Integrations → New MCP Server**, then make sure the `markup` toggle is enabled. Cursor loads `mcpServers` on startup; reload the window after editing.

### VS Code

VS Code uses the `servers` key with an explicit `type` (**not** the `mcpServers` shape used by the other clients). Add to `.vscode/mcp.json` (workspace, shareable) or run **MCP: Open User Configuration** from the Command Palette (user profile):

```json
{
  "servers": {
    "markup": {
      "type": "stdio",
      "command": "markup",
      "args": ["mcp"]
    }
  }
}
```

Start it from the `mcp.json` editor (a **Start** code lens appears above the server) or via the **MCP: List Servers** command. Requires agent mode in Copilot Chat.

### IBM Bob

Bob uses the same `mcpServers` format. Add it through the UI — **settings icon in the Bob panel → `MCP` tab → `Edit Global MCP`** (or `Edit Project MCP`) — or edit the file directly:

- Global: `~/.bob/mcp_settings.json`
- Project: `.bob/mcp.json` (shareable via version control; takes precedence over global)

```json
{
  "mcpServers": {
    "markup": {
      "command": "markup",
      "args": ["mcp"],
      "alwaysAllow": ["markup_list_projects", "markup_list_screens", "markup_get_screenshot"],
      "disabled": false
    }
  }
}
```

Bob also supports `cwd` and `env` per server (e.g. `"env": { "MARKUP_DATA_DIR": "/abs/path/data" }`).

> `MARKUP_DATA_DIR` points to the same `data/` folder the web UI uses — the AI and the UI share data in real time (SQLite WAL).

### Tools (21)

- **Projects:** `markup_list_projects`, `markup_get_project`, `markup_create_project`, `markup_update_project`, `markup_delete_project`
- **Discovery & capture:** `markup_discover` (reads the repo → routes + `file:line` + navigation graph + modals), `markup_capture` (Playwright; the target app must be running at the baseUrl)
- **Screens:** `markup_list_screens`, `markup_get_screen` (screen + elements with `selector`/ARIA/bbox), `markup_get_screenshot` (PNG, so the AI can **see** the screen), `markup_delete_screen`
- **Annotations:** `markup_list_annotations`, `markup_create_annotation` (anchors by `selector` or `elementId`, position computed from the bbox), `markup_update_annotation`, `markup_delete_annotation`
- **Fix suggestions:** `markup_suggest_fixes` — read mode returns a worklist of open annotations needing a fix (note + anchored element + screen + source `file:line`); write mode saves the AI-generated suggestions in one batch
- **Export:** `markup_export_review` (`review.md` / `review.json`)
- **Runtime (repo):** `markup_clone_repo` (clones a remote repo), `markup_start_app` (starts the dev server, detects the URL and sets it as baseUrl), `markup_stop_app`, `markup_app_status`

### Typical AI flow

`markup_create_project` → `markup_clone_repo` (if remote) → `markup_start_app` (boots the app) → `markup_discover` → `markup_capture` → `markup_get_screen` / `markup_get_screenshot` → `markup_create_annotation` (by `selector`) → `markup_export_review`.

## Structure

```
app/            # Next routes (UI + API)
components/      # UI components
src/
  db/           # schema + SQLite access (better-sqlite3)
  types/        # domain types + Zod schemas
  capture/      # (Phase 1) Playwright crawler + element extraction
  discovery/    # (Phase 4) static route/modal analysis
  sequence/     # (Phase 2) flow layout
  export/       # (Phase 5) review.md / review.json generation
  lib/          # utilities
data/           # local: sqlite + screenshots + exports (gitignored)
```

## Stack

- **Next.js 16 (App Router) + TypeScript** — single full-stack app; API routes host the pipeline.
- **Tailwind CSS v4** — styling.
- **@xyflow/react + dagre** — canvas and flow auto-layout.
- **Playwright (chromium)** — screen capture + element extraction.
- **ts-morph** — static route/modal analysis with `file:line`.
- **better-sqlite3** — local storage; screenshots on disk (`./data`).
- **TanStack Query + Zustand + Zod**.
