"use client";

import "@xyflow/react/dist/style.css";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { jsonFetch } from "@/src/lib/utils";
import { TrashIcon } from "@/components/ui";
import { autoLayout, gridLayout, sectionLayout } from "@/src/sequence/layout";
import type { ScreenSummary } from "@/src/db/screens";
import type { NavEdge } from "@/src/types";

type ScreenNodeData = {
  screen: ScreenSummary;
  onDelete: (id: string) => void;
};
type ScreenNode = Node<ScreenNodeData, "screen">;

function ScreenNodeView({ data }: NodeProps<ScreenNode>) {
  const s = data.screen;
  return (
    <div className="group relative w-[240px] overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <Handle type="target" position={Position.Left} className="!bg-zinc-300" />
      <button
        type="button"
        title="Delete screen"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (
            window.confirm(
              `Delete screen "${s.name}"${s.route ? ` (${s.route})` : ""}?\nThis also removes its annotations and cannot be undone.`,
            )
          ) {
            data.onDelete(s.id);
          }
        }}
        className="nodrag absolute right-1 top-1 z-10 hidden rounded-md bg-white/90 p-1 text-red-600 shadow-sm ring-1 ring-border hover:bg-red-50 group-hover:block"
      >
        <TrashIcon className="h-3.5 w-3.5" />
      </button>
      <div className="h-[130px] overflow-hidden border-b border-border bg-zinc-50">
        {s.screenshotPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/screens/${s.id}/image`}
            alt={s.name}
            className="h-[130px] w-full object-cover object-top"
            draggable={false}
          />
        ) : (
          <div className="flex h-[130px] items-center justify-center text-xs text-red-600">
            no screenshot
          </div>
        )}
      </div>
      <div className="p-2">
        <div className="flex items-center gap-1.5">
          {s.kind === "modal" ? (
            <span className="rounded bg-violet-100 px-1 text-[10px] font-medium text-violet-700">
              modal
            </span>
          ) : null}
          <span className="truncate text-sm font-medium">{s.name}</span>
          {s.annotationCount ? (
            <span className="ml-auto shrink-0 rounded-full bg-accent px-1.5 text-[10px] font-bold text-accent-foreground">
              {s.annotationCount}
            </span>
          ) : null}
        </div>
        <code className="block truncate text-[11px] text-muted">{s.route}</code>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-zinc-300" />
    </div>
  );
}

const nodeTypes = { screen: ScreenNodeView };

export function ProjectCanvas({
  projectId,
  screens,
  edges,
  onOpen,
}: {
  projectId: string;
  screens: ScreenSummary[];
  edges: NavEdge[];
  onOpen?: (screenId: string) => void;
}) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: (id: string) =>
      jsonFetch(`/api/screens/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["screens", projectId] });
      qc.invalidateQueries({ queryKey: ["edges", projectId] });
    },
  });

  const initialNodes = useMemo<ScreenNode[]>(() => {
    const auto = autoLayout(screens, edges);
    return screens.map((s) => ({
      id: s.id,
      type: "screen",
      position: s.pos ?? auto[s.id] ?? { x: 0, y: 0 },
      data: { screen: s, onDelete: (id: string) => del.mutate(id) },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initialEdges = useMemo<Edge[]>(
    () =>
      edges.map((e) => ({
        id: e.id,
        source: e.fromScreenId,
        target: e.toScreenId,
        label: e.kind === "open-modal" ? "opens modal" : undefined,
        animated: e.kind === "open-modal",
        markerEnd: { type: MarkerType.ArrowClosed },
      })),
    [edges],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<ScreenNode>(
    initialNodes,
  );
  const [rfEdges, , onEdgesChange] = useEdgesState(initialEdges);

  const savePos = useMutation({
    mutationFn: (v: { id: string; x: number; y: number }) =>
      jsonFetch(`/api/screens/${v.id}`, {
        method: "PATCH",
        body: JSON.stringify({ posX: v.x, posY: v.y }),
      }),
  });

  const bulkSave = useMutation({
    mutationFn: (positions: { id: string; x: number; y: number }[]) =>
      jsonFetch(`/api/projects/${projectId}/layout`, {
        method: "POST",
        body: JSON.stringify({ positions }),
      }),
  });

  const rfRef = useRef<ReactFlowInstance<ScreenNode, Edge> | null>(null);

  type LayoutMode = "flow" | "grid" | "section";
  const applyLayout = (mode: LayoutMode) => {
    const pos =
      mode === "flow"
        ? autoLayout(screens, edges)
        : mode === "grid"
          ? gridLayout(screens)
          : sectionLayout(screens);
    setNodes((nds) =>
      nds.map((n) => (pos[n.id] ? { ...n, position: pos[n.id] } : n)),
    );
    bulkSave.mutate(
      Object.entries(pos).map(([id, p]) => ({
        id,
        x: Math.round(p.x),
        y: Math.round(p.y),
      })),
    );
    // Re-fit the viewport after the nodes move.
    requestAnimationFrame(() =>
      rfRef.current?.fitView({ padding: 0.12, duration: 400 }),
    );
  };

  return (
    <div className="h-[72vh] overflow-hidden rounded-lg border border-border bg-zinc-50">
      <ReactFlow
        nodes={nodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={(_, node) =>
          savePos.mutate({
            id: node.id,
            x: Math.round(node.position.x),
            y: Math.round(node.position.y),
          })
        }
        onNodeClick={(_, node) => onOpen?.(node.id)}
        onInit={(inst) => {
          rfRef.current = inst;
        }}
        fitView
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} />
        <MiniMap pannable zoomable />
        <Controls />
        <Panel position="top-right">
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-card p-1 shadow-sm">
            <span className="px-1.5 text-xs font-medium text-muted">Arrange</span>
            {(
              [
                ["flow", "Flow", "Lay out by navigation flow"],
                ["grid", "Grid", "Tidy uniform grid"],
                ["section", "Sections", "Group by route section"],
              ] as const
            ).map(([mode, label, title]) => (
              <button
                key={mode}
                onClick={() => applyLayout(mode)}
                disabled={bulkSave.isPending}
                title={title}
                className="rounded px-2.5 py-1 text-sm font-medium text-muted transition-colors hover:bg-zinc-100 hover:text-foreground disabled:opacity-50"
              >
                {label}
              </button>
            ))}
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
