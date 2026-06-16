// Shared domain types for Markup. These mirror the SQLite schema in
// src/db/schema.ts but use camelCase and richer shapes (nested bbox/viewport).

export type Viewport = { w: number; h: number };

export interface Project {
  id: string;
  name: string;
  /** Absolute path to the target app's repo (optional, enables screen→code mapping). */
  repoPath: string | null;
  /** URL of the running target app, e.g. http://localhost:3001 */
  baseUrl: string;
  viewport: Viewport;
  /** Optional Playwright storageState JSON string for authenticated capture. */
  authStorageState: string | null;
  createdAt: string;
}

export type ScreenKind = "page" | "modal";
export type ScreenStatus = "discovered" | "captured" | "error";

export interface Screen {
  id: string;
  projectId: string;
  kind: ScreenKind;
  name: string;
  route: string | null;
  sourceFile: string | null;
  sourceLine: number | null;
  /** For modals: the page screen they open from. */
  parentScreenId: string | null;
  /** Path (relative to data dir) of the captured screenshot. */
  screenshotPath: string | null;
  width: number | null;
  height: number | null;
  /** Canvas position (persisted after auto-layout / manual drag). */
  pos: { x: number; y: number } | null;
  order: number;
  status: ScreenStatus;
  error: string | null;
  createdAt: string;
}

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ElementInfo {
  id: string;
  screenId: string;
  /** Stable-ish selector: data-testid > id > role+name > css path. */
  selector: string;
  role: string | null;
  accessibleName: string | null;
  text: string | null;
  tag: string | null;
  /** Bounding box in screenshot pixel coordinates. */
  bbox: BBox;
  sourceFile: string | null;
  sourceLine: number | null;
}

export type NavEdgeKind = "navigate" | "open-modal";

export interface NavEdge {
  id: string;
  projectId: string;
  fromScreenId: string;
  toScreenId: string;
  trigger: string | null;
  kind: NavEdgeKind;
}

export type AnnotationShape = "pin" | "box" | "arrow";
export type AnnotationType = "bug" | "change" | "question" | "idea";
export type Severity = "low" | "med" | "high";
export type AnnotationStatus = "open" | "resolved";

export interface Annotation {
  id: string;
  screenId: string;
  shape: AnnotationShape;
  /** Anchor point (and size for box/arrow) in screenshot pixel coordinates. */
  x: number;
  y: number;
  w: number | null;
  h: number | null;
  /** Auto-attached element (hit-tested at placement time), if any. */
  elementId: string | null;
  note: string;
  type: AnnotationType;
  severity: Severity;
  suggestion: string | null;
  status: AnnotationStatus;
  createdAt: string;
}
