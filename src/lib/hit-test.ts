import type { ElementInfo } from "@/src/types";

/** Smallest element whose bbox contains the point — used to auto-attach an
 * annotation to the element it lands on. */
export function hitTest(
  elements: ElementInfo[],
  x: number,
  y: number,
): ElementInfo | null {
  let best: ElementInfo | null = null;
  let bestArea = Infinity;
  for (const el of elements) {
    const { x: bx, y: by, w, h } = el.bbox;
    if (x >= bx && x <= bx + w && y >= by && y <= by + h) {
      const area = w * h;
      if (area < bestArea) {
        bestArea = area;
        best = el;
      }
    }
  }
  return best;
}
