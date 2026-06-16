"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, Spinner, TrashIcon, Textarea } from "@/components/ui";
import { cn, jsonFetch } from "@/src/lib/utils";
import { hitTest } from "@/src/lib/hit-test";
import type {
  Annotation,
  AnnotationType,
  ElementInfo,
  Screen,
  Severity,
} from "@/src/types";

type Tool = "select" | "pin" | "box" | "arrow";
type Draft = { shape: "box" | "arrow"; x0: number; y0: number; x1: number; y1: number };

const TYPE_COLOR: Record<AnnotationType, string> = {
  bug: "#dc2626",
  change: "#6d28d9",
  question: "#d97706",
  idea: "#059669",
};
const TYPE_LABEL: Record<AnnotationType, string> = {
  bug: "Bug",
  change: "Change",
  question: "Question",
  idea: "Idea",
};
const SEVERITY_LABEL: Record<Severity, string> = {
  low: "Low",
  med: "Medium",
  high: "High",
};

interface ScreenDetailData {
  screen: Screen;
  elements: ElementInfo[];
}

export function ScreenDetail({
  projectId,
  screenId,
}: {
  projectId: string;
  screenId: string;
}) {
  const qc = useQueryClient();

  const detail = useQuery({
    queryKey: ["screen", screenId],
    queryFn: () => jsonFetch<ScreenDetailData>(`/api/screens/${screenId}`),
  });
  const annotationsQuery = useQuery({
    queryKey: ["annotations", screenId],
    queryFn: () => jsonFetch<Annotation[]>(`/api/screens/${screenId}/annotations`),
  });

  const [tool, setTool] = useState<Tool>("pin");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showElements, setShowElements] = useState(false);
  const [scale, setScale] = useState(0.5);
  const [draft, setDraft] = useState<Draft | null>(null);

  const paneRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<Draft | null>(null);

  const screen = detail.data?.screen;
  const elements = detail.data?.elements ?? [];
  const annotations = annotationsQuery.data ?? [];
  const natW = screen?.width ?? 1440;
  const natH = screen?.height ?? 900;

  // Fit to pane width on first load (deferred to after layout so clientWidth
  // is measured correctly).
  useEffect(() => {
    if (!screen?.width) return;
    const natWidth = screen.width;
    const raf = requestAnimationFrame(() => {
      const avail = (paneRef.current?.clientWidth ?? window.innerWidth * 0.6) - 48;
      if (avail <= 0) return;
      setScale(Math.min(1, Math.max(0.15, avail / natWidth)));
    });
    return () => cancelAnimationFrame(raf);
  }, [screen?.id, screen?.width]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["annotations", screenId] });
    qc.invalidateQueries({ queryKey: ["screens", projectId] });
  };

  const createAnn = useMutation({
    mutationFn: (input: Partial<Annotation>) =>
      jsonFetch<Annotation>(`/api/screens/${screenId}/annotations`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (ann) => {
      invalidate();
      setSelectedId(ann.id);
      setTool("select");
    },
  });
  const updateAnn = useMutation({
    mutationFn: (v: { id: string; patch: Partial<Annotation> }) =>
      jsonFetch<Annotation>(`/api/annotations/${v.id}`, {
        method: "PATCH",
        body: JSON.stringify(v.patch),
      }),
    onSuccess: () => invalidate(),
  });
  const deleteAnn = useMutation({
    mutationFn: (id: string) =>
      jsonFetch(`/api/annotations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      setSelectedId(null);
    },
  });

  function clientToImage(clientX: number, clientY: number) {
    const rect = wrapRef.current!.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * natW;
    const y = ((clientY - rect.top) / rect.height) * natH;
    return {
      x: Math.max(0, Math.min(natW, Math.round(x))),
      y: Math.max(0, Math.min(natH, Math.round(y))),
    };
  }

  function place(
    shape: Annotation["shape"],
    x: number,
    y: number,
    w?: number,
    h?: number,
  ) {
    const px = shape === "box" ? x + (w ?? 0) / 2 : x;
    const py = shape === "box" ? y + (h ?? 0) / 2 : y;
    const el = hitTest(elements, px, py);
    createAnn.mutate({
      shape,
      x,
      y,
      w: w ?? null,
      h: h ?? null,
      elementId: el?.id ?? null,
    });
  }

  function onDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    if (tool === "select") {
      if (e.target === wrapRef.current || e.target === imgRef.current) {
        setSelectedId(null);
      }
      return;
    }
    const p = clientToImage(e.clientX, e.clientY);
    if (tool === "pin") {
      place("pin", p.x, p.y);
      return;
    }
    const d: Draft = { shape: tool, x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    draftRef.current = d;
    setDraft(d);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  function onMove(e: MouseEvent) {
    if (!draftRef.current) return;
    const p = clientToImage(e.clientX, e.clientY);
    const d = { ...draftRef.current, x1: p.x, y1: p.y };
    draftRef.current = d;
    setDraft(d);
  }
  function onUp() {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    const d = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (!d) return;
    if (d.shape === "box") {
      const x = Math.min(d.x0, d.x1);
      const y = Math.min(d.y0, d.y1);
      const w = Math.abs(d.x1 - d.x0);
      const h = Math.abs(d.y1 - d.y0);
      if (w < 5 && h < 5) return;
      place("box", x, y, w, h);
    } else {
      const w = d.x1 - d.x0;
      const h = d.y1 - d.y0;
      if (Math.abs(w) < 5 && Math.abs(h) < 5) return;
      place("arrow", d.x0, d.y0, w, h);
    }
  }

  const imgRef = useRef<HTMLImageElement>(null);
  const numberOf = new Map(annotations.map((a, i) => [a.id, i + 1]));
  const selected = annotations.find((a) => a.id === selectedId) ?? null;

  if (detail.isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted">
        <Spinner /> Loading…
      </div>
    );
  }
  if (detail.isError || !screen) {
    return (
      <div className="p-8 text-sm text-red-600">
        Screen not found.{" "}
        <Link href={`/projects/${projectId}`} className="underline">
          Back
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2">
        <Link
          href={`/projects/${projectId}`}
          className="text-sm text-muted hover:underline"
        >
          ← {screen.name}
        </Link>
        <code className="text-xs text-muted">{screen.route}</code>

        <div className="mx-1 flex rounded-md border border-border p-0.5">
          {(["select", "pin", "box", "arrow"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTool(t)}
              className={cn(
                "rounded px-2.5 py-1 text-sm font-medium capitalize transition-colors",
                tool === t
                  ? "bg-accent text-accent-foreground"
                  : "text-muted hover:text-foreground",
              )}
            >
              {t === "select"
                ? "Select"
                : t === "pin"
                  ? "Pin"
                  : t === "box"
                    ? "Box"
                    : "Arrow"}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-sm text-muted">
          <input
            type="checkbox"
            checked={showElements}
            onChange={(e) => setShowElements(e.target.checked)}
          />
          Elements ({elements.length})
        </label>

        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setScale((s) => Math.max(0.1, s - 0.15))}
          >
            −
          </Button>
          <span className="w-12 text-center text-xs tabular-nums text-muted">
            {Math.round(scale * 100)}%
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setScale((s) => Math.min(3, s + 0.15))}
          >
            +
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (paneRef.current)
                setScale(
                  Math.min(
                    1,
                    Math.max(0.15, (paneRef.current.clientWidth - 48) / natW),
                  ),
                );
            }}
          >
            Fit
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Canvas */}
        <div ref={paneRef} className="min-w-0 flex-1 overflow-auto bg-zinc-100 p-6">
          {screen.screenshotPath ? (
            <div
              ref={wrapRef}
              data-testid="capture-canvas"
              onMouseDown={onDown}
              className={cn(
                "relative mx-auto select-none shadow-sm ring-1 ring-border",
                tool === "select" ? "cursor-default" : "cursor-crosshair",
              )}
              style={{ width: natW * scale, height: natH * scale }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={`/api/screens/${screen.id}/image`}
                alt={screen.name}
                draggable={false}
                style={{ width: natW * scale, height: natH * scale }}
              />

              {/* SVG overlay (image coordinate space) */}
              <svg
                className="pointer-events-none absolute inset-0"
                width={natW * scale}
                height={natH * scale}
                viewBox={`0 0 ${natW} ${natH}`}
                preserveAspectRatio="none"
              >
                {showElements
                  ? elements.map((el) => (
                      <rect
                        key={el.id}
                        x={el.bbox.x}
                        y={el.bbox.y}
                        width={el.bbox.w}
                        height={el.bbox.h}
                        fill="rgba(109,40,217,0.04)"
                        stroke="rgba(109,40,217,0.45)"
                        strokeWidth={1 / scale}
                      />
                    ))
                  : null}

                {selected?.elementId
                  ? (() => {
                      const el = elements.find(
                        (e) => e.id === selected.elementId,
                      );
                      if (!el) return null;
                      return (
                        <rect
                          x={el.bbox.x}
                          y={el.bbox.y}
                          width={el.bbox.w}
                          height={el.bbox.h}
                          fill="rgba(109,40,217,0.10)"
                          stroke={TYPE_COLOR[selected.type]}
                          strokeWidth={2 / scale}
                        />
                      );
                    })()
                  : null}

                {annotations
                  .filter((a) => a.shape === "box")
                  .map((a) => (
                    <rect
                      key={a.id}
                      x={a.x}
                      y={a.y}
                      width={a.w ?? 0}
                      height={a.h ?? 0}
                      fill="transparent"
                      stroke={TYPE_COLOR[a.type]}
                      strokeWidth={(a.id === selectedId ? 3 : 2) / scale}
                      strokeDasharray={a.status === "resolved" ? `${6 / scale}` : undefined}
                    />
                  ))}

                {annotations
                  .filter((a) => a.shape === "arrow")
                  .map((a) => {
                    const x2 = a.x + (a.w ?? 0);
                    const y2 = a.y + (a.h ?? 0);
                    return (
                      <g key={a.id}>
                        <line
                          x1={a.x}
                          y1={a.y}
                          x2={x2}
                          y2={y2}
                          stroke={TYPE_COLOR[a.type]}
                          strokeWidth={(a.id === selectedId ? 4 : 3) / scale}
                          markerEnd={`url(#arrow-${a.type})`}
                        />
                      </g>
                    );
                  })}

                {draft ? (
                  draft.shape === "box" ? (
                    <rect
                      x={Math.min(draft.x0, draft.x1)}
                      y={Math.min(draft.y0, draft.y1)}
                      width={Math.abs(draft.x1 - draft.x0)}
                      height={Math.abs(draft.y1 - draft.y0)}
                      fill="rgba(109,40,217,0.06)"
                      stroke="#6d28d9"
                      strokeWidth={2 / scale}
                      strokeDasharray={`${5 / scale}`}
                    />
                  ) : (
                    <line
                      x1={draft.x0}
                      y1={draft.y0}
                      x2={draft.x1}
                      y2={draft.y1}
                      stroke="#6d28d9"
                      strokeWidth={3 / scale}
                      strokeDasharray={`${5 / scale}`}
                    />
                  )
                ) : null}

                <defs>
                  {(Object.keys(TYPE_COLOR) as AnnotationType[]).map((t) => (
                    <marker
                      key={t}
                      id={`arrow-${t}`}
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" fill={TYPE_COLOR[t]} />
                    </marker>
                  ))}
                </defs>
              </svg>

              {/* Pin + handle markers (constant screen size) */}
              {annotations.map((a) => {
                const isPin = a.shape === "pin";
                const hx = isPin ? a.x : a.shape === "box" ? a.x : a.x;
                const hy = isPin ? a.y : a.shape === "box" ? a.y : a.y;
                return (
                  <button
                    key={a.id}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedId(a.id);
                    }}
                    title={a.note || TYPE_LABEL[a.type]}
                    className={cn(
                      "absolute z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-[11px] font-bold text-white shadow",
                      a.id === selectedId ? "ring-2 ring-offset-1" : "",
                    )}
                    style={{
                      left: hx * scale,
                      top: hy * scale,
                      background: TYPE_COLOR[a.type],
                      opacity: a.status === "resolved" ? 0.45 : 1,
                    }}
                  >
                    {numberOf.get(a.id)}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-red-600">
              This screen has no screenshot (capture failed).
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="flex w-96 shrink-0 flex-col overflow-auto border-l border-border bg-card">
          {selected ? (
            <AnnotationEditor
              key={selected.id}
              annotation={selected}
              number={numberOf.get(selected.id) ?? 0}
              elements={elements}
              onPatch={(patch) => updateAnn.mutate({ id: selected.id, patch })}
              onDelete={() => deleteAnn.mutate(selected.id)}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <AnnotationList
              annotations={annotations}
              numberOf={numberOf}
              onSelect={setSelectedId}
              onDelete={(id) => deleteAnn.mutate(id)}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function AnnotationList({
  annotations,
  numberOf,
  onSelect,
  onDelete,
}: {
  annotations: Annotation[];
  numberOf: Map<string, number>;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="border-b border-border px-4 py-3 text-sm font-medium">
        Annotations ({annotations.length})
      </div>
      {!annotations.length ? (
        <p className="p-4 text-sm text-muted">
          Pick a tool (Pin, Box, or Arrow) and click the screen to mark a
          point. The element under the cursor is linked automatically.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {annotations.map((a) => (
            <li key={a.id} className="group relative">
              <button
                onClick={() => onSelect(a.id)}
                className="flex w-full items-start gap-3 px-4 py-3 pr-10 text-left hover:bg-zinc-50"
              >
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: TYPE_COLOR[a.type] }}
                >
                  {numberOf.get(a.id)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm">
                    {a.note || (
                      <span className="text-muted">(no note)</span>
                    )}
                  </span>
                  <span className="text-xs text-muted">
                    {TYPE_LABEL[a.type]} · {SEVERITY_LABEL[a.severity]}
                    {a.status === "resolved" ? " · resolved" : ""}
                  </span>
                </span>
              </button>
              <button
                type="button"
                title="Delete annotation"
                onClick={() => onDelete(a.id)}
                className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-md p-1.5 text-muted hover:bg-red-50 hover:text-red-600 group-hover:block"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AnnotationEditor({
  annotation,
  number,
  elements,
  onPatch,
  onDelete,
  onBack,
}: {
  annotation: Annotation;
  number: number;
  elements: ElementInfo[];
  onPatch: (patch: Partial<Annotation>) => void;
  onDelete: () => void;
  onBack: () => void;
}) {
  const [note, setNote] = useState(annotation.note);
  const [suggestion, setSuggestion] = useState(annotation.suggestion ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedPatch = (patch: Partial<Annotation>) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onPatch(patch), 500);
  };

  const element = elements.find((e) => e.id === annotation.elementId) ?? null;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <button onClick={onBack} className="text-sm text-muted hover:underline">
          ← Annotations
        </button>
        <span
          className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white"
          style={{ background: TYPE_COLOR[annotation.type] }}
        >
          {number}
        </span>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted">Type</div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(TYPE_LABEL) as AnnotationType[]).map((t) => (
              <button
                key={t}
                onClick={() => onPatch({ type: t })}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-sm",
                  annotation.type === t
                    ? "border-transparent text-white"
                    : "border-border bg-card text-foreground hover:bg-zinc-50",
                )}
                style={
                  annotation.type === t
                    ? { background: TYPE_COLOR[t] }
                    : undefined
                }
              >
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-muted">Severity</div>
          <div className="flex gap-1.5">
            {(["low", "med", "high"] as const).map((s) => (
              <button
                key={s}
                onClick={() => onPatch({ severity: s })}
                className={cn(
                  "flex-1 rounded-md border px-2 py-1 text-sm",
                  annotation.severity === s
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border bg-card hover:bg-zinc-50",
                )}
              >
                {SEVERITY_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Note</span>
          <Textarea
            rows={3}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              debouncedPatch({ note: e.target.value });
            }}
            onBlur={() => onPatch({ note })}
            placeholder="What needs to change here?"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">
            Suggestion (optional)
          </span>
          <Textarea
            rows={2}
            value={suggestion}
            onChange={(e) => {
              setSuggestion(e.target.value);
              debouncedPatch({ suggestion: e.target.value });
            }}
            onBlur={() => onPatch({ suggestion })}
            placeholder="Suggested action for the dev / AI"
          />
        </label>

        <div>
          <div className="mb-1.5 text-xs font-medium text-muted">
            Linked element
          </div>
          {element ? (
            <div className="rounded-md border border-border bg-zinc-50 p-2.5 text-xs">
              <code className="block break-all font-medium">
                {element.selector}
              </code>
              <div className="mt-1 text-muted">
                {element.role ? `${element.role}` : element.tag}
                {element.accessibleName ? ` · "${element.accessibleName}"` : ""}
              </div>
              <button
                onClick={() => onPatch({ elementId: null })}
                className="mt-1.5 text-red-600 hover:underline"
              >
                Clear
              </button>
            </div>
          ) : (
            <p className="text-xs text-muted">
              No linked element.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <button
            onClick={() =>
              onPatch({
                status: annotation.status === "open" ? "resolved" : "open",
              })
            }
            className="text-sm font-medium text-accent hover:underline"
          >
            {annotation.status === "open"
              ? "Mark resolved"
              : "Reopen"}
          </button>
          <Button size="sm" variant="danger" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
