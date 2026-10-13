import type { SchemaIssue, SchemaReport, SdItem } from "@/lib/types";

/** "https://schema.org/Product" → "Product". */
export function shortType(t: string): string {
  return t.replace(/^https?:\/\/(www\.)?schema\.org\//, "").replace(/^schema:/, "");
}

export function itemLabel(item: SdItem): string {
  return item.types.length ? item.types.map(shortType).join(", ") : "(no @type)";
}

export interface FlatIssue extends SchemaIssue {
  /** Where it is, e.g. "Product › offers › Offer › price". */
  path: string;
  item: number;
}

/** Every error and warning with its location, in document order. */
export function flattenIssues(report: SchemaReport): FlatIssue[] {
  const out: FlatIssue[] = report.syntaxErrors.map((message) => ({ severity: "error", message, path: "JSON-LD", item: -1 }));
  const go = (item: SdItem, path: string, idx: number) => {
    for (const i of item.issues) out.push({ ...i, path, item: idx });
    for (const p of item.properties) {
      for (const i of p.issues) out.push({ ...i, path: `${path} › ${shortType(p.name)}`, item: idx });
      for (const v of p.values) if (v.kind === "item") go(v.item, `${path} › ${shortType(p.name)} › ${itemLabel(v.item)}`, idx);
    }
  };
  report.items.forEach((it, i) => go(it, itemLabel(it), i));
  return out;
}
