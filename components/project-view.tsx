"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExportDialog } from "@/components/export-dialog";
import { ProjectCanvas } from "@/components/project-canvas";
import { Button, Spinner, TrashIcon } from "@/components/ui";
import { cn, jsonFetch } from "@/src/lib/utils";
import type { ScreenSummary } from "@/src/db/screens";
import type { NavEdge, Project } from "@/src/types";

type View = "canvas" | "grid";

export function ProjectView({ id }: { id: string }) {
  const router = useRouter();
  const [view, setView] = useState<View>("grid");
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
            No screens yet. Use the markup MCP tools (
            <code>markup_discover</code> / <code>markup_capture</code>) to add
            screens, then reload.
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
