import { NextResponse } from "next/server";
import { getProject } from "@/src/db/projects";
import { saveCaptureResults } from "@/src/db/screens";
import { captureRoutes } from "@/src/capture/crawler";
import { getJob, isRunning, setJob, type CaptureJob } from "@/src/capture/jobs";
import type { Project } from "@/src/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function normalizeRoutes(input: unknown): string[] {
  let list: string[] = [];
  if (Array.isArray(input)) list = input.map(String);
  else if (typeof input === "string") list = input.split(/[\n,]/);
  list = list
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => (r.startsWith("/") ? r : `/${r}`));
  const unique = Array.from(new Set(list));
  return unique.length ? unique : ["/"];
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const job = getJob(id);
  return NextResponse.json(job ?? { projectId: id, status: "idle" });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (isRunning(id)) {
    return NextResponse.json(getJob(id), { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as { routes?: unknown };
  const routes = normalizeRoutes(body?.routes);

  const job: CaptureJob = {
    projectId: id,
    status: "running",
    total: routes.length,
    done: 0,
    current: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    capturedRoutes: [],
    errors: [],
  };
  setJob(job);

  // Fire-and-forget: the capture keeps running after the response is sent.
  void runCapture(project, routes, job);

  return NextResponse.json(job, { status: 202 });
}

async function runCapture(
  project: Project,
  routes: string[],
  job: CaptureJob,
): Promise<void> {
  try {
    const results = await captureRoutes(project, routes, (i, route) => {
      job.done = i;
      job.current = route;
    });
    saveCaptureResults(project.id, results);
    for (const r of results) {
      if (r.status === "error") {
        job.errors.push({ route: r.route, error: r.error ?? "error" });
      } else {
        job.capturedRoutes.push(r.route);
      }
    }
    job.done = routes.length;
    job.current = null;
    job.status = "done";
    job.finishedAt = new Date().toISOString();
  } catch (err) {
    job.status = "error";
    job.message = err instanceof Error ? err.message : String(err);
    job.finishedAt = new Date().toISOString();
  }
}
