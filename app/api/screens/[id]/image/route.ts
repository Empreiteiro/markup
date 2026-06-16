import fs from "node:fs";
import path from "node:path";
import { projectDataDir } from "@/src/db";
import { getScreen } from "@/src/db/screens";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const screen = getScreen(id);
  if (!screen || !screen.screenshotPath) {
    return new Response("Not found", { status: 404 });
  }
  const baseDir = path.resolve(projectDataDir(screen.projectId));
  const filePath = path.resolve(path.join(baseDir, screen.screenshotPath));
  // Containment guard against path traversal.
  if (!filePath.startsWith(baseDir + path.sep) || !fs.existsSync(filePath)) {
    return new Response("Not found", { status: 404 });
  }
  const data = await fs.promises.readFile(filePath);
  return new Response(new Uint8Array(data), {
    headers: { "content-type": "image/png", "cache-control": "no-store" },
  });
}
