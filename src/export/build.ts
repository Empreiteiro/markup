import fs from "node:fs";
import path from "node:path";
import { projectDataDir } from "../db";
import { listAnnotations } from "../db/annotations";
import { getProject } from "../db/projects";
import { listElements, listScreens } from "../db/screens";
import type {
  AnnotationShape,
  AnnotationStatus,
  AnnotationType,
  Severity,
} from "../types";

const SEV_LABEL: Record<Severity, string> = {
  high: "HIGH",
  med: "MEDIUM",
  low: "LOW",
};
const TYPE_LABEL: Record<AnnotationType, string> = {
  bug: "Bug",
  change: "Change",
  question: "Question",
  idea: "Idea",
};

export interface ReviewElement {
  selector: string;
  role: string | null;
  accessibleName: string | null;
  sourceFile: string | null;
  sourceLine: number | null;
}

export interface ReviewAnnotation {
  number: number;
  shape: AnnotationShape;
  type: AnnotationType;
  severity: Severity;
  status: AnnotationStatus;
  note: string;
  suggestion: string | null;
  position: { x: number; y: number; w: number | null; h: number | null };
  element: ReviewElement | null;
}

export interface ReviewScreen {
  id: string;
  name: string;
  route: string | null;
  kind: "page" | "modal";
  sourceFile: string | null;
  sourceLine: number | null;
  width: number | null;
  height: number | null;
  screenshot: string | null;
  annotations: ReviewAnnotation[];
}

export interface ReviewDoc {
  project: {
    name: string;
    baseUrl: string;
    repoPath: string | null;
    generatedAt: string;
  };
  summary: {
    screens: number;
    annotations: number;
    byType: Record<AnnotationType, number>;
    bySeverity: Record<Severity, number>;
    byStatus: Record<AnnotationStatus, number>;
  };
  screens: ReviewScreen[];
}

export function buildReviewDoc(projectId: string): ReviewDoc | null {
  const project = getProject(projectId);
  if (!project) return null;

  const screens: ReviewScreen[] = listScreens(projectId).map((s) => {
    const elements = listElements(s.id);
    const elMap = new Map(elements.map((e) => [e.id, e]));
    const annotations = listAnnotations(s.id).map((a, i): ReviewAnnotation => {
      const el = a.elementId ? elMap.get(a.elementId) : undefined;
      return {
        number: i + 1,
        shape: a.shape,
        type: a.type,
        severity: a.severity,
        status: a.status,
        note: a.note,
        suggestion: a.suggestion,
        position: { x: a.x, y: a.y, w: a.w, h: a.h },
        element: el
          ? {
              selector: el.selector,
              role: el.role,
              accessibleName: el.accessibleName,
              sourceFile: el.sourceFile,
              sourceLine: el.sourceLine,
            }
          : null,
      };
    });
    return {
      id: s.id,
      name: s.name,
      route: s.route,
      kind: s.kind,
      sourceFile: s.sourceFile,
      sourceLine: s.sourceLine,
      width: s.width,
      height: s.height,
      screenshot: s.screenshotPath,
      annotations,
    };
  });

  const all = screens.flatMap((s) => s.annotations);
  const countBy = <K extends string>(key: (a: ReviewAnnotation) => K, keys: K[]) =>
    Object.fromEntries(
      keys.map((k) => [k, all.filter((a) => key(a) === k).length]),
    ) as Record<K, number>;

  return {
    project: {
      name: project.name,
      baseUrl: project.baseUrl,
      repoPath: project.repoPath,
      generatedAt: new Date().toISOString(),
    },
    summary: {
      screens: screens.length,
      annotations: all.length,
      byType: countBy((a) => a.type, ["bug", "change", "question", "idea"]),
      bySeverity: countBy((a) => a.severity, ["high", "med", "low"]),
      byStatus: countBy((a) => a.status, ["open", "resolved"]),
    },
    screens,
  };
}

function elementRef(el: ReviewElement | null): string {
  if (!el) return "";
  const parts = [`\`${el.selector}\``];
  if (el.accessibleName) parts.push(`"${el.accessibleName}"`);
  else if (el.role) parts.push(`(${el.role})`);
  if (el.sourceFile) {
    parts.push(
      `— source \`${el.sourceFile}${el.sourceLine ? `:${el.sourceLine}` : ""}\``,
    );
  }
  return parts.join(" ");
}

export function renderMarkdown(doc: ReviewDoc): string {
  const L: string[] = [];
  const { project, summary } = doc;

  L.push(`# Screen review — ${project.name}`, "");
  L.push(`- **Application:** ${project.baseUrl}`);
  L.push(`- **Repository:** ${project.repoPath ?? "—"}`);
  L.push(`- **Generated at:** ${project.generatedAt}`);
  L.push(
    `- **Screens:** ${summary.screens} · **Annotations:** ${summary.annotations}`,
    "",
  );

  L.push("## Summary");
  L.push(
    `- **By type:** Bug ${summary.byType.bug} · Change ${summary.byType.change} · Question ${summary.byType.question} · Idea ${summary.byType.idea}`,
  );
  L.push(
    `- **By severity:** High ${summary.bySeverity.high} · Medium ${summary.bySeverity.med} · Low ${summary.bySeverity.low}`,
  );
  L.push(
    `- **Status:** Open ${summary.byStatus.open} · Resolved ${summary.byStatus.resolved}`,
    "",
  );

  L.push(
    "> This document lists requested changes to an application's screens. Each item points to the **element** (CSS selector + accessible name) and, when available, the **source file**. Use the **Tasks** section as an actionable checklist (e.g. Claude Code / Cursor).",
    "",
  );

  L.push("## Screens", "");
  doc.screens.forEach((s, idx) => {
    const heading = `### ${idx + 1}. ${s.name}${s.route ? ` — \`${s.route}\`` : ""}${s.kind === "modal" ? " _(modal)_" : ""}`;
    L.push(heading);
    if (s.sourceFile) {
      L.push(
        `Source: \`${s.sourceFile}${s.sourceLine ? `:${s.sourceLine}` : ""}\``,
      );
    }
    if (s.screenshot) L.push(`Screenshot: \`../${s.screenshot}\``);
    L.push("");
    if (!s.annotations.length) {
      L.push("_No annotations._", "");
    } else {
      for (const a of s.annotations) {
        const tag = `[${SEV_LABEL[a.severity]} · ${TYPE_LABEL[a.type]}]`;
        const done = a.status === "resolved" ? " ~~(resolved)~~" : "";
        L.push(`- **#${a.number} ${tag}**${done} ${a.note || "_(no note)_"}`);
        if (a.element) L.push(`  - Element: ${elementRef(a.element)}`);
        if (a.suggestion) L.push(`  - Suggestion: ${a.suggestion}`);
      }
      L.push("");
    }
  });

  L.push("## Tasks (checklist)", "");
  let any = false;
  doc.screens.forEach((s) => {
    for (const a of s.annotations) {
      any = true;
      const box = a.status === "resolved" ? "[x]" : "[ ]";
      const tag = `[${SEV_LABEL[a.severity]} · ${TYPE_LABEL[a.type]}]`;
      const where = s.route ? `${s.name} \`${s.route}\`` : s.name;
      const el = a.element ? ` — element ${elementRef(a.element)}` : "";
      const sug = a.suggestion ? ` — suggestion: ${a.suggestion}` : "";
      L.push(`- ${box} **${tag}** (${where}) ${a.note || "(no note)"}${el}${sug}`);
    }
  });
  if (!any) L.push("_No annotations recorded._");
  L.push("");

  return L.join("\n");
}

export interface ExportResult {
  dir: string;
  mdPath: string;
  jsonPath: string;
  md: string;
  doc: ReviewDoc;
}

/** Build the review and persist review.md + review.json under the project's
 * export dir (alongside the screenshots they reference). */
export function writeExport(projectId: string): ExportResult | null {
  const doc = buildReviewDoc(projectId);
  if (!doc) return null;
  const md = renderMarkdown(doc);
  const dir = path.join(projectDataDir(projectId), "export");
  fs.mkdirSync(dir, { recursive: true });
  const mdPath = path.join(dir, "review.md");
  const jsonPath = path.join(dir, "review.json");
  fs.writeFileSync(mdPath, md, "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 2), "utf8");
  return { dir, mdPath, jsonPath, md, doc };
}
