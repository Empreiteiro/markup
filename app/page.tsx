"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Button, Field, Input, Spinner } from "@/components/ui";
import { jsonFetch } from "@/src/lib/utils";
import type { Project } from "@/src/types";

export default function Dashboard() {
  const qc = useQueryClient();
  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => jsonFetch<Project[]>("/api/projects"),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["projects"] });

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <p className="mt-1 text-sm text-muted">
          Each project points to a target application (running URL + optional
          repo) whose screens we capture, annotate, and export.
        </p>
      </div>

      <NewProjectForm onCreated={invalidate} />

      <div className="mt-8">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Loading…
          </div>
        ) : !projects?.length ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">
            No projects yet. Create the first one above.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} onDeleted={invalidate} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NewProjectForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:3000");
  const [repoPath, setRepoPath] = useState("");
  const [vw, setVw] = useState(1440);
  const [vh, setVh] = useState(900);

  const mutation = useMutation({
    mutationFn: () =>
      jsonFetch<Project>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name,
          baseUrl,
          repoPath: repoPath.trim() || null,
          viewport: { w: vw, h: vh },
        }),
      }),
    onSuccess: () => {
      setName("");
      setRepoPath("");
      setOpen(false);
      onCreated();
    },
  });

  if (!open) {
    return <Button onClick={() => setOpen(true)}>+ New project</Button>;
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      className="grid gap-4 rounded-lg border border-border bg-card p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My app"
            required
          />
        </Field>
        <Field label="Base URL (running app)" hint="E.g.: http://localhost:3000">
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://localhost:3000"
            required
          />
        </Field>
      </div>
      <Field
        label="Repo path (optional)"
        hint="Enables screen→code mapping (static analysis)."
      >
        <Input
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          placeholder="/Users/voce/code/minha-app"
        />
      </Field>
      <div className="flex gap-4">
        <Field label="Viewport W">
          <Input
            type="number"
            value={vw}
            onChange={(e) => setVw(Number(e.target.value))}
            className="w-28"
          />
        </Field>
        <Field label="Viewport H">
          <Input
            type="number"
            value={vh}
            onChange={(e) => setVh(Number(e.target.value))}
            className="w-28"
          />
        </Field>
      </div>
      {mutation.isError ? (
        <p className="text-sm text-red-600">
          {(mutation.error as Error).message}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? (
            <>
              <Spinner /> Creating…
            </>
          ) : (
            "Create project"
          )}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ProjectCard({
  project,
  onDeleted,
}: {
  project: Project;
  onDeleted: () => void;
}) {
  const del = useMutation({
    mutationFn: () =>
      jsonFetch(`/api/projects/${project.id}`, { method: "DELETE" }),
    onSuccess: onDeleted,
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/projects/${project.id}`}
          className="font-medium hover:underline"
        >
          {project.name}
        </Link>
        <Button
          size="sm"
          variant="danger"
          onClick={() => {
            if (confirm(`Delete project "${project.name}"?`)) del.mutate();
          }}
        >
          Delete
        </Button>
      </div>
      <div className="break-all text-xs text-muted">{project.baseUrl}</div>
      {project.repoPath ? (
        <div className="break-all text-xs text-muted">
          repo: {project.repoPath}
        </div>
      ) : null}
      <Link
        href={`/projects/${project.id}`}
        className="mt-auto text-sm font-medium text-accent"
      >
        Open →
      </Link>
    </div>
  );
}
