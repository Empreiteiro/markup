"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ExportDialog } from "@/components/export-dialog";
import { ProjectCanvas } from "@/components/project-canvas";
import { Button, Spinner, TrashIcon, Textarea } from "@/components/ui";
import { cn, jsonFetch } from "@/src/lib/utils";
import type { CaptureJob } from "@/src/capture/jobs";
import type { DiscoverySummary } from "@/src/discovery";
import type { ScreenSummary } from "@/src/db/screens";
import type { NavEdge, Project } from "@/src/types";

type CaptureStatus = CaptureJob | { projectId: string; status: "idle" };
type View = "canvas" | "grid";

export function ProjectView({ id }: { id: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [view, setView] = useState<View>("canvas");
  const [exportOpen, setExportOpen] = useState(false);

  const project = useQuery({
    queryKey: ["project", id],
    queryFn: () => jsonFetch<Project>(`/api/projects/${id}`),
  });

  const screens = useQuery({
    queryKey: ["screens", id],
    queryFn: () => jsonFetch<ScreenSummary[]>(`/api/projects/${id}/screens`),
  });

  const edges = useQuery({
    queryKey: ["edges", id],
    queryFn: () => jsonFetch<NavEdge[]>(`/api/projects/${id}/edges`),
  });

  const status = useQuery({
    queryKey: ["capture-status", id],
    queryFn: () => jsonFetch<CaptureStatus>(`/api/projects/${id}/capture`),
    refetchInterval: (q) =>
      (q.state.data as CaptureStatus | undefined)?.status === "running"
        ? 800
        : false,
  });

  const job = status.data;
  const running = job?.status === "running";
  const finishedAt = job && "finishedAt" in job ? job.finishedAt : null;

  // Refresh the screens grid whenever a capture finishes.
  useEffect(() => {
    if (job?.status === "done" || job?.status === "error") {
      qc.invalidateQueries({ queryKey: ["screens", id] });
      qc.invalidateQueries({ queryKey: ["edges", id] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, finishedAt]);

  if (project.isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted">
        <Spinner /> Loading…
      </div>
    );
  }
  if (project.isError || !project.data) {
    return (
      <div className="p-8 text-sm text-red-600">
        Project not found.{" "}
        <Link href="/" className="underline">
          Back
        </Link>
      </div>
    );
  }

  const p = project.data;
  const screenList = screens.data ?? [];
  const edgeList = edges.data ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8">
      <Link href="/" className="text-sm text-muted hover:underline">
        ← Projects
      </Link>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
        <code className="text-sm text-muted">{p.baseUrl}</code>
      </div>

      <CapturePanel
        id={id}
        repoPath={p.repoPath}
        job={job}
        running={running}
      />

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium">
            Screens <span className="text-muted">({screenList.length})</span>
          </h2>
          <div className="flex items-center gap-2">
            {screens.isFetching ? <Spinner /> : null}
            {screenList.length ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setExportOpen(true)}
              >
                Export
              </Button>
            ) : null}
            <ViewToggle view={view} setView={setView} />
          </div>
        </div>

        {!screenList.length ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">
            No screens captured yet. Enter routes above and click Capture.
          </div>
        ) : view === "canvas" ? (
          <ProjectCanvas
            key={screenList.map((s) => s.id).join(",")}
            projectId={id}
            screens={screenList}
            edges={edgeList}
            onOpen={(sid) => router.push(`/projects/${id}/screens/${sid}`)}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {screenList.map((s) => (
              <ScreenCard key={s.id} projectId={id} s={s} />
            ))}
          </div>
        )}
      </div>

      {exportOpen ? (
        <ExportDialog projectId={id} onClose={() => setExportOpen(false)} />
      ) : null}
    </div>
  );
}

function ViewToggle({
  view,
  setView,
}: {
  view: View;
  setView: (v: View) => void;
}) {
  return (
    <div className="flex rounded-md border border-border bg-card p-0.5 text-sm">
      {(["canvas", "grid"] as const).map((v) => (
        <button
          key={v}
          onClick={() => setView(v)}
          className={cn(
            "rounded px-3 py-1 font-medium transition-colors",
            view === v ? "bg-accent text-accent-foreground" : "text-muted hover:text-foreground",
          )}
        >
          {v === "canvas" ? "Canvas" : "Grid"}
        </button>
      ))}
    </div>
  );
}

function CapturePanel({
  id,
  repoPath,
  job,
  running,
}: {
  id: string;
  repoPath: string | null;
  job: CaptureStatus | undefined;
  running: boolean;
}) {
  const qc = useQueryClient();
  const [routes, setRoutes] = useState("/");
  const [discovery, setDiscovery] = useState<DiscoverySummary | null>(null);

  const discover = useMutation({
    mutationFn: () =>
      jsonFetch<DiscoverySummary>(`/api/projects/${id}/discover`, {
        method: "POST",
      }),
    onSuccess: (data) => {
      setDiscovery(data);
      const staticRoutes = data.routes
        .filter((r) => !r.dynamic)
        .map((r) => r.route);
      if (staticRoutes.length) setRoutes(staticRoutes.join("\n"));
      qc.invalidateQueries({ queryKey: ["screens", id] });
      qc.invalidateQueries({ queryKey: ["edges", id] });
    },
  });

  const capture = useMutation({
    mutationFn: () =>
      jsonFetch<CaptureJob>(`/api/projects/${id}/capture`, {
        method: "POST",
        body: JSON.stringify({ routes }),
      }),
  });

  const pct =
    job && "total" in job && job.total > 0
      ? Math.round((job.done / job.total) * 100)
      : 0;

  return (
    <div className="mt-6 rounded-lg border border-border bg-card p-5">
      <h2 className="font-medium">Capture screens</h2>
      <p className="mt-1 text-sm text-muted">
        One route per line (the app must be running at the base URL). E.g.:{" "}
        <code>/</code>, <code>/login</code>, <code>/settings</code>.
      </p>

      {repoPath ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => discover.mutate()}
            disabled={discover.isPending}
          >
            {discover.isPending ? (
              <>
                <Spinner /> Discovering…
              </>
            ) : (
              "Discover routes from repo"
            )}
          </Button>
          {discovery ? (
            <span className="text-xs text-muted">
              {discovery.framework} · {discovery.screenCount} routes (
              {discovery.dynamicCount} dynamic) · {discovery.edgeCount} links
              {discovery.modals.length
                ? ` · ${discovery.modals.length} modals`
                : ""}
            </span>
          ) : null}
          {discover.isError ? (
            <span className="text-xs text-red-600">
              {(discover.error as Error).message}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">
          Set the repo path on the project to discover routes automatically.
        </p>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Routes</span>
          <Textarea
            rows={3}
            value={routes}
            onChange={(e) => setRoutes(e.target.value)}
            className="font-mono text-xs"
            placeholder={"/\n/login\n/settings"}
          />
        </label>
        <Button
          onClick={() => capture.mutate()}
          disabled={running || capture.isPending}
          className="sm:w-40"
        >
          {running || capture.isPending ? (
            <>
              <Spinner /> Capturing…
            </>
          ) : (
            "Capture"
          )}
        </Button>
      </div>

      {running && job && "total" in job ? (
        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {job.done}/{job.total} · {job.current ?? "…"}
          </p>
        </div>
      ) : null}

      {job?.status === "done" && "capturedRoutes" in job ? (
        <p className="mt-3 text-sm text-muted">
          Last capture: {job.capturedRoutes.length} screen(s)
          {job.errors.length ? ` · ${job.errors.length} error(s)` : ""}.
        </p>
      ) : null}

      {job && "errors" in job && job.errors.length ? (
        <ul className="mt-2 space-y-1 text-xs text-red-600">
          {job.errors.map((e) => (
            <li key={e.route}>
              <code>{e.route}</code>: {e.error}
            </li>
          ))}
        </ul>
      ) : null}

      {capture.isError ? (
        <p className="mt-2 text-sm text-red-600">
          {(capture.error as Error).message}
        </p>
      ) : null}
    </div>
  );
}

function ScreenCard({
  projectId,
  s,
}: {
  projectId: string;
  s: ScreenSummary;
}) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => jsonFetch(`/api/screens/${s.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["screens", projectId] });
      qc.invalidateQueries({ queryKey: ["edges", projectId] });
    },
  });

  return (
    <Link
      href={`/projects/${projectId}/screens/${s.id}`}
      className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-shadow hover:shadow-md"
    >
      <button
        type="button"
        title="Delete screen"
        disabled={del.isPending}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (
            window.confirm(
              `Delete screen "${s.name}"${s.route ? ` (${s.route})` : ""}?\nThis also removes its annotations and cannot be undone.`,
            )
          ) {
            del.mutate();
          }
        }}
        className="absolute right-2 top-2 z-10 hidden rounded-md bg-white/90 p-1.5 text-red-600 shadow-sm ring-1 ring-border hover:bg-red-50 disabled:opacity-50 group-hover:block"
      >
        {del.isPending ? <Spinner className="h-4 w-4" /> : <TrashIcon />}
      </button>
      <div className="h-44 overflow-hidden border-b border-border bg-zinc-50">
        {s.screenshotPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/screens/${s.id}/image`}
            alt={s.name}
            className="h-44 w-full object-cover object-top"
          />
        ) : (
          <div className="flex h-44 items-center justify-center text-xs text-red-600">
            no screenshot
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium">{s.name}</span>
          <StatusBadge status={s.status} />
        </div>
        <code className="truncate text-xs text-muted">{s.route}</code>
        <span className="text-xs text-muted">
          {s.elementCount} elements
          {s.annotationCount ? ` · ${s.annotationCount} annotations` : ""}
          {s.width ? ` · ${s.width}×${s.height}` : ""}
        </span>
      </div>
    </Link>
  );
}

function StatusBadge({ status }: { status: ScreenSummary["status"] }) {
  const map: Record<string, string> = {
    captured: "bg-emerald-100 text-emerald-700",
    error: "bg-red-100 text-red-700",
    discovered: "bg-zinc-100 text-zinc-600",
  };
  const label: Record<string, string> = {
    captured: "ok",
    error: "error",
    discovered: "pending",
  };
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${map[status] ?? map.discovered}`}
    >
      {label[status] ?? status}
    </span>
  );
}
