import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/src/db/projects";
import { CreateProjectSchema } from "@/src/types/schemas";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(listProjects());
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = CreateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const project = createProject(parsed.data);
  return NextResponse.json(project, { status: 201 });
}
