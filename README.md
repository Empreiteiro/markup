# Markup — revisão visual de telas

Ferramenta que **lê uma aplicação-alvo, descobre e captura todas as suas telas/modais, mostra tudo num canvas em ordem de fluxo (UX), permite anotações visuais ancoradas a elementos reais e ao código de origem, e exporta um documento de revisão** consumível por IA (Claude Code/Cursor) ou por um desenvolvedor.

## Como funciona (visão geral)

1. **Descobre** (análise estática do repo): rotas, telas, modais e o grafo de navegação — mapeando cada tela ao arquivo/componente de origem. Foco inicial em **React / Next.js**.
2. **Captura** (Playwright): navega a URL da app rodando, tira screenshots reais e extrai o mapa de elementos de cada tela (seletor, papel/ARIA, nome acessível, bounding box).
3. **Canvas** (React Flow): telas como nós conectados pelo fluxo de navegação, em layout sequencial.
4. **Anota**: pins / caixas / setas sobre a screenshot, auto-atreladas ao elemento real (e ao `arquivo:linha` quando disponível).
5. **Exporta**: `review.md` (humano + IA, com checklist de tarefas) e `review.json` (canônico, tipado).

> No v1, a captura funciona apontando para uma **URL já rodando** (robusto). Subir o dev server do repo automaticamente vem na fase de polish.

## Stack

- **Next.js 16 (App Router) + TypeScript** — app full-stack único; API routes hospedam o pipeline.
- **Tailwind CSS v4** — estilos.
- **@xyflow/react + dagre** — canvas e auto-layout do fluxo.
- **Playwright (chromium)** — captura de telas + extração de elementos.
- **ts-morph** — análise estática de rotas/modais com `arquivo:linha`.
- **better-sqlite3** — armazenamento local; screenshots em disco (`./data`).
- **TanStack Query + Zustand + Zod**.

## Instalação

### Sem clonar (via npm + GitHub) — mais rápido

Instala o CLI `markup` direto do repositório, sem `git clone`:

```bash
npm i -g github:Empreiteiro/markup
markup setup      # uma vez: baixa o Chromium do Playwright (para captura)
markup ui         # UI em http://localhost:3900
```

Registrar o MCP no Claude Code:

```bash
claude mcp add markup -- markup mcp
```

> Dados em `~/.markup/data` (SQLite + screenshots), compartilhados por UI e MCP. Override com `MARKUP_DATA_DIR`.

### Clonando (desenvolvimento)

```bash
git clone https://github.com/Empreiteiro/markup.git
cd markup
make init          # npm install + Chromium do Playwright
make dev           # UI em http://localhost:3900
make mcp           # servidor MCP (stdio)
```

Dados em `./data` (gitignored).

### Fluxo de uso

1. Suba a aplicação-alvo que você quer revisar (ex.: `http://localhost:3000`).
2. Crie um projeto (MCP `markup_create_project`) com essa **URL base** e, opcionalmente, o **caminho do repo** para o mapeamento tela→código.
3. **Discovery e captura são via MCP** (`markup_discover` / `markup_capture`) → veja as telas no **grid/canvas** → **anote** → **exporte** o `review.md`.

## Integração MCP (Claude Code / Cursor / outras IAs)

A plataforma é exposta como um **servidor MCP (stdio)** em [src/mcp/server.ts](src/mcp/server.ts), reaproveitando a mesma base SQLite (`./data`) — **não precisa** do servidor web rodando. Assim, Claude Code, Cursor ou outra IA podem **rodar o discovery, ver telas/elementos e criar/editar anotações** programaticamente.

Rodar manualmente: `markup mcp` (instalado via npm) ou `npm run mcp` (no repo clonado).

### Configuração

**Instalado via npm** (`npm i -g github:Empreiteiro/markup`) — o jeito simples (Claude Code: `claude mcp add markup -- markup mcp`):

```json
{
  "mcpServers": {
    "markup": { "command": "markup", "args": ["mcp"] }
  }
}
```

**Repo clonado** — aponte para o `tsx` local:

```json
{
  "mcpServers": {
    "markup": {
      "command": "<repo>/node_modules/.bin/tsx",
      "args": ["<repo>/src/mcp/server.ts"],
      "env": { "MARKUP_DATA_DIR": "<repo>/data" }
    }
  }
}
```

`MARKUP_DATA_DIR` aponta para a mesma pasta `data/` do app web — a IA e a UI compartilham os dados em tempo real (WAL).

### Ferramentas (20)

- **Projetos:** `markup_list_projects`, `markup_get_project`, `markup_create_project`, `markup_update_project`, `markup_delete_project`
- **Discovery & captura:** `markup_discover` (lê o repo → rotas + `arquivo:linha` + grafo de navegação + modais), `markup_capture` (Playwright; a app-alvo precisa estar rodando na baseUrl)
- **Telas:** `markup_list_screens`, `markup_get_screen` (tela + elementos com `selector`/ARIA/bbox), `markup_get_screenshot` (PNG, para a IA **ver** a tela), `markup_delete_screen`
- **Anotações:** `markup_list_annotations`, `markup_create_annotation` (atrela por `selector` ou `elementId`, posição calculada do bbox), `markup_update_annotation`, `markup_delete_annotation`
- **Export:** `markup_export_review` (`review.md` / `review.json`)
- **Runtime (repo):** `markup_clone_repo` (clona repo remoto), `markup_start_app` (sobe o dev server, detecta a URL e a define como baseUrl), `markup_stop_app`, `markup_app_status`

### Fluxo típico para a IA

`markup_create_project` → `markup_clone_repo` (se for repo remoto) → `markup_start_app` (sobe a app) → `markup_discover` → `markup_capture` → `markup_get_screen` / `markup_get_screenshot` → `markup_create_annotation` (por `selector`) → `markup_export_review`.

## Roadmap (fases)

- [x] **Fase 0** — Scaffold, banco (SQLite), tipos, CRUD de projetos.
- [x] **Fase 1** — Captura via Playwright (screenshots + elementos).
- [x] **Fase 2** — Canvas + sequência (React Flow + dagre).
- [x] **Fase 3** — Anotações (pin/box/arrow + atrelar elemento).
- [x] **Fase 4** — Discovery estático (rotas/modais React/Next).
- [x] **Fase 5** — Export (`review.md` + `review.json`).
- [ ] **Fase 6** — Polish (auto-subir repo, auth, rotas dinâmicas, source-map por elemento).
- [x] **MCP** — servidor stdio expondo a plataforma (discovery + anotações) para Claude Code/Cursor.

## Estrutura

```
app/            # rotas Next (UI + API)
components/      # componentes de UI
src/
  db/           # schema + acesso SQLite (better-sqlite3)
  types/        # tipos de domínio + schemas Zod
  capture/      # (Fase 1) crawler Playwright + extração de elementos
  discovery/    # (Fase 4) análise estática de rotas/modais
  sequence/     # (Fase 2) layout do fluxo
  export/       # (Fase 5) geração de review.md / review.json
  lib/          # utilidades
data/           # local: sqlite + screenshots + exports (gitignored)
```
