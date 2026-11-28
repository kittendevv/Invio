type Doc = { documentType?: string | null; total?: number | null };

/** Quotes are stored like invoices but with documentType "quote". */
export function isQuote(doc: Doc | null | undefined): boolean {
  return doc?.documentType === "quote";
}

/** daisyUI badge class for a quote status. */
export function quoteStatusBadge(status?: string): string {
  switch (status) {
    case "sent":
      return "badge-info";
    case "accepted":
      return "badge-success";
    case "declined":
      return "badge-error";
    case "expired":
      return "badge-warning";
    default:
      return "badge-ghost";
  }
}

/** Credit notes are stored like invoices but with documentType "credit_note". */
export function isCreditNote(doc: Doc | null | undefined): boolean {
  return doc?.documentType === "credit_note";
}

/**
 * Total as it affects revenue: credit notes store positive amounts, so they
 * count negatively.
 */
export function signedTotal(doc: Doc | null | undefined): number {
  const total = Number(doc?.total) || 0;
  return isCreditNote(doc) && total !== 0 ? -total : total;
}
