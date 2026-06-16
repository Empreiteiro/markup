"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Spinner } from "@/components/ui";

export function ExportDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const md = useQuery({
    queryKey: ["export-md", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/export?format=md`);
      if (!res.ok) throw new Error("Failed to generate the review");
      return res.text();
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-[min(900px,92vw)] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-medium">Export review</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-zinc-50 p-4">
          {md.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Spinner /> Generating…
            </div>
          ) : md.isError ? (
            <p className="text-sm text-red-600">
              {(md.error as Error).message}
            </p>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
              {md.data}
            </pre>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <Button
            size="sm"
            onClick={async () => {
              if (!md.data) return;
              await navigator.clipboard.writeText(md.data);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            disabled={!md.data}
          >
            {copied ? "Copied!" : "Copy Markdown"}
          </Button>
          <a
            className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-zinc-50"
            href={`/api/projects/${projectId}/export?format=md`}
            download
          >
            Download .md
          </a>
          <a
            className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-zinc-50"
            href={`/api/projects/${projectId}/export?format=json`}
            download
          >
            Download .json
          </a>
          <span className="ml-auto text-xs text-muted">
            Saved to <code>data/projects/{projectId}/export/</code>
          </span>
        </div>
      </div>
    </div>
  );
}
