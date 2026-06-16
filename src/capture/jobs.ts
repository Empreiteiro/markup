// In-memory capture job registry. The dev server is a single long-lived Node
// process, so a module-level Map is enough to track progress and let the UI
// poll while a capture runs in the background.

export interface CaptureJob {
  projectId: string;
  status: "running" | "done" | "error";
  total: number;
  done: number;
  current: string | null;
  startedAt: string;
  finishedAt: string | null;
  capturedRoutes: string[];
  errors: { route: string; error: string }[];
  message?: string;
}

const jobs = new Map<string, CaptureJob>();

export function getJob(projectId: string): CaptureJob | null {
  return jobs.get(projectId) ?? null;
}

export function setJob(job: CaptureJob): void {
  jobs.set(job.projectId, job);
}

export function isRunning(projectId: string): boolean {
  return jobs.get(projectId)?.status === "running";
}
