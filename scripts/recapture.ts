// One-off: mirrors the markup_capture MCP handler so we can re-capture using the
// freshly-transpiled (fixed) crawler without restarting the running MCP server.
// Writes to the same SQLite DB (MARKUP_DATA_DIR) the server reads.
import { getProject } from "../src/db/projects";
import { saveCaptureResults } from "../src/db/screens";
import { captureRoutes } from "../src/capture/crawler";

async function main() {
  const projectId = process.argv[2];
  const routes = process.argv.slice(3);
  if (!projectId || routes.length === 0) {
    console.error("usage: tsx scripts/recapture.ts <projectId> <route...>");
    process.exit(1);
  }
  const project = getProject(projectId);
  if (!project) {
    console.error(`Project not found: ${projectId}`);
    process.exit(1);
  }
  const normalized = routes
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => (r.startsWith("/") ? r : `/${r}`));

  const results = await captureRoutes(project, normalized);
  saveCaptureResults(projectId, results);

  console.log(
    JSON.stringify(
      {
        captured: results
          .filter((r) => r.status === "captured")
          .map((r) => ({ route: r.route, elements: r.elements.length, size: `${r.width}x${r.height}` })),
        errors: results
          .filter((r) => r.status === "error")
          .map((r) => ({ route: r.route, error: r.error })),
      },
      null,
      2,
    ),
  );
}

main();
