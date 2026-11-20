// Shared EN 16931 amounts for the UBL and Factur-X (CII) generators.
//
// EN 16931 requires the amounts in an e-invoice to add up exactly:
// - line net amounts (BT-131) are net of VAT, also with prices including tax
// - Σ line net amounts - document allowances + document charges
//   = invoice total without VAT (BR-CO-10, BR-CO-13)
// - per VAT rate: Σ line net amounts - allowances + charges = taxable amount
//   (BR-S-08, BR-Z-08)
// - total without VAT + VAT = total with VAT; payable adds the rounding amount
//   (BR-CO-15, BR-CO-16)
//
// Invio spreads an invoice discount over the lines, so the stored VAT
// breakdown already contains the taxable amounts after the discount. Here the
// difference between the line net amounts and those taxable amounts becomes a
// document-level allowance per VAT rate, so the stored breakdown and totals
// (as printed on the PDF) are kept unchanged.

import type { InvoiceWithDetails } from "../types/index.ts";

type Item = InvoiceWithDetails["items"][number];

export interface XmlLine {
  item: Item;
  rate: number;
  category: string;
  quantity: number;
  netUnitPrice: number;
  netAmount: number;
}

export interface XmlTaxRow {
  rate: number;
  category: string;
  basis: number;
  tax: number;
}

export interface XmlAllowanceCharge {
  charge: boolean;
  amount: number;
  rate: number;
  category: string;
  reason: string;
  reasonCode?: string;
}

export interface XmlTotals {
  lines: XmlLine[];
  taxes: XmlTaxRow[];
  allowanceCharges: XmlAllowanceCharge[];
  lineTotal: number;
  allowanceTotal: number;
  chargeTotal: number;
  taxBasisTotal: number;
  taxTotal: number;
  grandTotal: number;
  roundingAmount: number;
  payable: number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

export function taxCategoryId(rate: number): string {
  // Simplified: Standard (S) for >0, Zero rated (Z) for 0
  return rate > 0 ? "S" : "Z";
}

/** Format a unit price with 2 to 4 decimals. */
export function priceDecimals(n: number): string {
  const s = r4(n).toFixed(4);
  return s.replace(/(\.\d\d\d*?)0+$/, "$1");
}

export function computeXmlTotals(invoice: InvoiceWithDetails): XmlTotals {
  const items = invoice.items || [];
  const hasLineTaxes = items.some((it) => (it.taxes?.length || 0) > 0);
  const invoiceRate = Number(invoice.taxRate) || 0;
  const rateOf = (it: Item): number =>
    hasLineTaxes ? Number(it.taxes?.[0]?.percent) || 0 : invoiceRate;
  const includeTax = Boolean(invoice.pricesIncludeTax);

  // Line net amounts before the discount
  const lines: XmlLine[] = items.map((item) => {
    const rate = rateOf(item);
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unitPrice) || 0;
    const divisor = includeTax && rate > 0 ? 1 + rate / 100 : 1;
    return {
      item,
      rate,
      category: taxCategoryId(rate),
      quantity,
      netUnitPrice: r4(unitPrice / divisor),
      netAmount: r2((quantity * unitPrice) / divisor),
    };
  });

  // Taxable amounts and VAT per rate, as stored with the invoice
  const total = Number(invoice.total) || 0;
  const taxAmount = Number(invoice.taxAmount) || 0;
  const netTotal = includeTax ? r2(total - taxAmount) : r2(
    (Number(invoice.subtotal) || 0) - (Number(invoice.discountAmount) || 0),
  );

  const rows = new Map<number, { basis: number; tax: number }>();
  if (hasLineTaxes) {
    const stored = invoice.taxes ?? [];
    if (stored.length > 0) {
      for (const t of stored) {
        const rate = Number(t.percent) || 0;
        const row = rows.get(rate) || { basis: 0, tax: 0 };
        row.basis = r2(row.basis + (Number(t.taxableAmount) || 0));
        row.tax = r2(row.tax + (Number(t.taxAmount) || 0));
        rows.set(rate, row);
      }
    } else {
      for (const it of items) {
        for (const t of it.taxes ?? []) {
          const rate = Number(t.percent) || 0;
          const row = rows.get(rate) || { basis: 0, tax: 0 };
          row.basis = r2(row.basis + (Number(t.taxableAmount) || 0));
          row.tax = r2(row.tax + (Number(t.amount) || 0));
          rows.set(rate, row);
        }
      }
    }
    // Lines without taxes are not part of the stored breakdown: their base
    // (after discount) is what remains of the net total, at 0%
    if (items.some((it) => !(it.taxes?.length))) {
      const taxed = [...rows.values()].reduce((s, r) => s + r.basis, 0);
      const zero = rows.get(0) || { basis: 0, tax: 0 };
      zero.basis = r2(zero.basis + (netTotal - taxed));
      rows.set(0, zero);
    }
  } else {
    rows.set(invoiceRate, { basis: netTotal, tax: taxAmount });
  }

  const taxes: XmlTaxRow[] = [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rate, v]) => ({
      rate,
      category: taxCategoryId(rate),
      basis: v.basis,
      tax: v.tax,
    }));

  // Per rate: the difference between line net amounts and taxable amount is
  // the discount (or a rounding difference from removing VAT from gross prices)
  const hasDiscount = (Number(invoice.discountAmount) || 0) > 0;
  const allowanceCharges: XmlAllowanceCharge[] = [];
  for (const row of taxes) {
    const linesSum = lines
      .filter((l) => l.rate === row.rate)
      .reduce((s, l) => s + l.netAmount, 0);
    const diff = r2(linesSum - row.basis);
    if (diff === 0) continue;
    if (diff > 0) {
      allowanceCharges.push({
        charge: false,
        amount: diff,
        rate: row.rate,
        category: row.category,
        reason: hasDiscount ? "Discount" : "Rounding",
        reasonCode: hasDiscount ? "95" : undefined,
      });
    } else {
      allowanceCharges.push({
        charge: true,
        amount: -diff,
        rate: row.rate,
        category: row.category,
        reason: "Rounding",
      });
    }
  }

  const sum = (ns: number[]) => r2(ns.reduce((s, n) => s + n, 0));
  const lineTotal = sum(lines.map((l) => l.netAmount));
  const allowanceTotal = sum(
    allowanceCharges.filter((a) => !a.charge).map((a) => a.amount),
  );
  const chargeTotal = sum(
    allowanceCharges.filter((a) => a.charge).map((a) => a.amount),
  );
  const taxBasisTotal = sum(taxes.map((t) => t.basis));
  const taxTotal = sum(taxes.map((t) => t.tax));
  const grandTotal = r2(taxBasisTotal + taxTotal);
  // The payable amount stays the stored invoice total; a cent difference from
  // rounding VAT per line is reported as the rounding amount (BT-114)
  const roundingAmount = r2(total - grandTotal);

  return {
    lines,
    taxes,
    allowanceCharges,
    lineTotal,
    allowanceTotal,
    chargeTotal,
    taxBasisTotal,
    taxTotal,
    grandTotal,
    roundingAmount,
    payable: total,
  };
}
