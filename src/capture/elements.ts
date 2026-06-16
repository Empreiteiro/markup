import type { Page } from "playwright";

export interface RawElement {
  selector: string;
  role: string | null;
  accessibleName: string | null;
  text: string | null;
  tag: string;
  /** Bounding box in document (screenshot) pixel coordinates. */
  bbox: { x: number; y: number; w: number; h: number };
}

const MAX_ELEMENTS = 600;

/**
 * Extracts a map of "interesting" interactive/landmark elements from the page,
 * each with a stable-ish selector, accessibility info and a bounding box in
 * document coordinates (which equal full-page screenshot pixels when the
 * context uses deviceScaleFactor = 1). Runs entirely in the browser.
 */
export async function extractElements(page: Page): Promise<RawElement[]> {
  return page.evaluate((max) => {
    const SELECTOR =
      "a, button, input, select, textarea, summary, label, [role], [data-testid], [data-test], [data-cy], h1, h2, h3, [tabindex]:not([tabindex='-1'])";

    const IMPLICIT_ROLE: Record<string, string> = {
      A: "link",
      BUTTON: "button",
      SELECT: "combobox",
      TEXTAREA: "textbox",
      IMG: "img",
      NAV: "navigation",
      H1: "heading",
      H2: "heading",
      H3: "heading",
      H4: "heading",
      H5: "heading",
      H6: "heading",
      SUMMARY: "button",
    };

    const clamp = (s: string | null, n: number): string | null =>
      s ? s.replace(/\s+/g, " ").trim().slice(0, n) || null : null;

    const idOk = (id: string) =>
      /^[A-Za-z][\w-]*$/.test(id) && id.length < 40;

    const isUnique = (sel: string) => {
      try {
        return document.querySelectorAll(sel).length === 1;
      } catch {
        return false;
      }
    };

    const esc = (s: string) =>
      window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, "\\$&");

    function selectorFor(el: Element): string {
      const testid =
        el.getAttribute("data-testid") ||
        el.getAttribute("data-test") ||
        el.getAttribute("data-cy");
      if (testid) {
        const sel = `[data-testid="${testid.replace(/"/g, '\\"')}"]`;
        if (isUnique(sel)) return sel;
      }
      if (el.id && idOk(el.id) && isUnique(`#${esc(el.id)}`)) {
        return `#${esc(el.id)}`;
      }
      const parts: string[] = [];
      let node: Element | null = el;
      while (node && node.nodeName !== "HTML" && node.nodeName !== "BODY") {
        let part = node.nodeName.toLowerCase();
        const parent: Element | null = node.parentElement;
        if (!parent) {
          parts.unshift(part);
          break;
        }
        const sameTag = Array.from(parent.children).filter(
          (c) => c.nodeName === node!.nodeName,
        );
        if (sameTag.length > 1) {
          part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
        }
        parts.unshift(part);
        if (parent.id && idOk(parent.id)) {
          parts.unshift(`#${esc(parent.id)}`);
          break;
        }
        node = parent;
        if (parts.length >= 6) break;
      }
      return parts.join(" > ");
    }

    function accessibleName(el: Element): string | null {
      const aria = el.getAttribute("aria-label");
      if (aria) return clamp(aria, 120);
      const labelledby = el.getAttribute("aria-labelledby");
      if (labelledby) {
        const ref = document.getElementById(labelledby);
        if (ref) return clamp(ref.textContent, 120);
      }
      if (el.nodeName === "IMG") {
        const alt = el.getAttribute("alt");
        if (alt) return clamp(alt, 120);
      }
      const placeholder = el.getAttribute("placeholder");
      if (placeholder) return clamp(placeholder, 120);
      if (el.id) {
        const lbl = document.querySelector(`label[for="${esc(el.id)}"]`);
        if (lbl) return clamp(lbl.textContent, 120);
      }
      const title = el.getAttribute("title");
      if (title) return clamp(title, 120);
      const txt = clamp(el.textContent, 120);
      if (txt) return txt;
      const val = (el as HTMLInputElement).value;
      if (val) return clamp(String(val), 120);
      return null;
    }

    function roleFor(el: Element): string | null {
      const explicit = el.getAttribute("role");
      if (explicit) return explicit;
      if (el.nodeName === "INPUT") {
        const t = (el as HTMLInputElement).type;
        if (t === "submit" || t === "button" || t === "reset") return "button";
        if (t === "checkbox") return "checkbox";
        if (t === "radio") return "radio";
        return "textbox";
      }
      return IMPLICIT_ROLE[el.nodeName] ?? null;
    }

    const out: RawElement[] = [];
    const seen = new Set<string>();
    const nodes = Array.from(document.querySelectorAll(SELECTOR));
    for (const el of nodes) {
      if (out.length >= max) break;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const style = window.getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const selector = selectorFor(el);
      if (!selector || seen.has(selector)) continue;
      seen.add(selector);
      out.push({
        selector,
        role: roleFor(el),
        accessibleName: accessibleName(el),
        text: clamp(el.textContent, 120),
        tag: el.nodeName.toLowerCase(),
        bbox: {
          x: Math.round(rect.left + window.scrollX),
          y: Math.round(rect.top + window.scrollY),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        },
      });
    }
    return out;
  }, MAX_ELEMENTS);
}
