type WithCurrency = { currency?: string | null } | null | undefined;

/**
 * Currency shown in the invoice editor. A saved invoice keeps its own
 * currency; a new invoice starts from the company setting.
 */
export function editorCurrency(invoice: WithCurrency, settings: WithCurrency): string {
  return invoice?.currency || settings?.currency || "EUR";
}
