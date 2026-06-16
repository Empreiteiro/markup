import fs from "node:fs";
import { NextResponse } from "next/server";
import { getProject } from "@/src/db/projects";
import { runDiscovery } from "@/src/discovery";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!project.repoPath) {
    return NextResponse.json(
      { error: "Set the project's repo path." },
      { status: 400 },
    );
  }
  if (!fs.existsSync(project.repoPath)) {
    return NextResponse.json(
      { error: `Repo path not found: ${project.repoPath}` },
      { status: 400 },
    );
  }
  try {
    const summary = runDiscovery(id, project);
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
