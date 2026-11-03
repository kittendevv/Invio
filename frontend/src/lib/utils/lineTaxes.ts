/**
 * Per-line tax in the invoice editor.
 *
 * The editor keeps one tax percent per line (`taxPercent`), but the backend
 * only reads per-line tax from `items[].taxes` and returns it there; it ignores
 * `taxMode` and `taxPercent`.
 */

type LineTax = { percent?: number | string | null };
type Line = { taxPercent?: number | string | null; taxes?: LineTax[] | null };

/** "line" when a saved invoice has tax on any of its lines. */
export function taxModeOf(items: Line[] | null | undefined): "line" | "invoice" {
  return items?.some((i) => (i.taxes?.length ?? 0) > 0) ? "line" : "invoice";
}

/** Percent for a line's tax field: the sum of the taxes saved on that line. */
export function lineTaxPercent(item: Line): number {
  if (!item.taxes?.length) return Number(item.taxPercent) || 0;
  return item.taxes.reduce((sum, t) => sum + (Number(t.percent) || 0), 0);
}

/** The `taxes` to send for one line when the invoice is saved. */
export function lineTaxes(taxMode: string, taxPercent: unknown): { percent: number }[] | undefined {
  const percent = Number(taxPercent) || 0;
  return taxMode === "line" && percent > 0 ? [{ percent }] : undefined;
}
