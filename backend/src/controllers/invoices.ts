import {
  calculateInvoiceTotals,
  generateDraftInvoiceNumber,
  getDatabase,
  getNextInvoiceNumber,
} from "../database/init.ts";
import { getSetting } from "./settings.ts";
import { getProductById } from "./products.ts";
import { normalizeInvoiceLocaleSetting } from "../i18n/translations.ts";
import {
  CreateInvoiceRequest,
  Invoice,
  InvoiceItem,
  InvoiceWithDetails,
  StatusHistoryEntry,
  UpdateInvoiceRequest,
} from "../types/index.ts";
import { generateShareToken, generateUUID } from "../utils/uuid.ts";

type LineTaxInput = {
  percent: number;
  taxDefinitionId?: string;
  code?: string;
  included?: boolean; // ignored; we use invoice-level pricesIncludeTax
  note?: string;
};

type ItemInput = {
  productId?: string;
  description: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  notes?: string;
  taxes?: LineTaxInput[];
};

type PerLineCalc = {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  // For each item index, the taxable base (after discount) and per-rate tax amounts
  perItem: Array<{
    taxable: number;
    taxes: Array<{
      percent: number;
      amount: number;
      note?: string;
      taxDefinitionId?: string;
    }>;
  }>;
  // Summary grouped by percent
  summary: Array<{ percent: number; taxable: number; amount: number }>;
};

function isInvoiceProtectionOverrideEnabled(): boolean {
  const raw = getSetting("allowProtectedInvoiceChanges");
  if (raw === null || raw === undefined) return false;
  const normalized = String(raw).trim().toLowerCase();
  return (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function calculatePerLineTotals(
  items: ItemInput[],
  discountPercentage = 0,
  discountAmount = 0,
  pricesIncludeTax = false,
  _roundingMode: "line" | "total" = "line",
): PerLineCalc {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const lineGrosses = items.map(
    (it) => (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
  );
  const subtotal = lineGrosses.reduce((a, b) => a + b, 0);

  let finalDiscountAmount = Number(discountAmount) || 0;
  if (discountPercentage > 0) {
    finalDiscountAmount = subtotal * (discountPercentage / 100);
  }
  finalDiscountAmount = Math.min(Math.max(finalDiscountAmount, 0), subtotal);

  // Proportional discount per line to keep rounding consistent
  let distributed = 0;
  const lineDiscounts = lineGrosses.map((g, idx) => {
    if (subtotal === 0) return 0;
    if (idx === lineGrosses.length - 1) {
      return r2(finalDiscountAmount - distributed);
    }
    const share = g / subtotal;
    const d = r2(finalDiscountAmount * share);
    distributed += d;
    return d;
  });

  const perItem: PerLineCalc["perItem"] = [];
  let taxAmount = 0;
  let total = 0;
  const summaryMap = new Map<number, { taxable: number; amount: number }>();

  for (let i = 0; i < items.length; i++) {
    const gross = lineGrosses[i] || 0;
    const afterDiscount = Math.max(0, gross - (lineDiscounts[i] || 0));
    const taxes = items[i].taxes || [];
    const rateSum =
      taxes.reduce((s, t) => s + (Number(t.percent) || 0), 0) / 100;

    let net = afterDiscount;
    if (pricesIncludeTax && rateSum > 0) {
      net = afterDiscount / (1 + rateSum);
    }

    const itemTaxes: Array<{
      percent: number;
      amount: number;
      note?: string;
      taxDefinitionId?: string;
    }> = [];
    for (const t of taxes) {
      const p = (Number(t.percent) || 0) / 100;
      const amt = r2(net * p);
      itemTaxes.push({
        percent: r2(p * 100),
        amount: amt,
        note: t.note,
        taxDefinitionId: t.taxDefinitionId,
      });
      const s = summaryMap.get(r2(p * 100)) || { taxable: 0, amount: 0 };
      s.taxable = r2(s.taxable + net);
      s.amount = r2(s.amount + amt);
      summaryMap.set(r2(p * 100), s);
    }

    const itemTaxSum = r2(itemTaxes.reduce((a, b) => a + b.amount, 0));
    perItem.push({ taxable: r2(net), taxes: itemTaxes });
    if (pricesIncludeTax) {
      total = r2(total + afterDiscount);
      taxAmount = r2(taxAmount + itemTaxSum);
    } else {
      total = r2(total + net + itemTaxSum);
      taxAmount = r2(taxAmount + itemTaxSum);
    }
  }

  const summary = Array.from(summaryMap.entries())
    .map(([percent, v]) => ({
      percent,
      taxable: r2(v.taxable),
      amount: r2(v.amount),
    }))
    .sort((a, b) => a.percent - b.percent);

  return {
    subtotal: r2(subtotal),
    discountAmount: r2(finalDiscountAmount),
    taxAmount: r2(taxAmount),
    total: r2(total),
    perItem,
    summary,
  };
}

function recordStatusChange(
  db: ReturnType<typeof getDatabase>,
  invoiceId: string,
  status: string,
  paymentMethod?: string,
  note?: string,
): void {
  db.query(
    `INSERT INTO invoice_status_history (id, invoice_id, status, changed_at, payment_method, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      generateUUID(),
      invoiceId,
      status,
      new Date().toISOString(),
      paymentMethod ?? null,
      note ?? null,
    ],
  );
}

export function getStatusHistory(invoiceId: string): StatusHistoryEntry[] {
  const db = getDatabase();
  const rows = db.query(
    `SELECT id, invoice_id, status, changed_at, payment_method, note
     FROM invoice_status_history
     WHERE invoice_id = ?
     ORDER BY changed_at ASC`,
    [invoiceId],
  ) as unknown[][];
  return rows.map((r) => ({
    id: String(r[0]),
    invoiceId: String(r[1]),
    status: String(r[2]),
    changedAt: new Date(String(r[3])),
    paymentMethod: r[4] ? String(r[4]) : undefined,
    note: r[5] ? String(r[5]) : undefined,
  }));
}

export function getLatestPaidPaymentMethods(
  invoiceIds: string[],
): Map<string, string> {
  if (invoiceIds.length === 0) return new Map();
  const db = getDatabase();
  const placeholders = invoiceIds.map(() => "?").join(", ");
  const rows = db.query(
    `SELECT invoice_id, payment_method
     FROM invoice_status_history
     WHERE status = 'paid'
       AND payment_method IS NOT NULL
       AND payment_method != ''
       AND invoice_id IN (${placeholders})
     ORDER BY changed_at DESC`,
    invoiceIds,
  ) as unknown[][];
  // Keep only the most recent payment method per invoice
  const result = new Map<string, string>();
  for (const row of rows) {
    const id = String(row[0]);
    if (!result.has(id)) result.set(id, String(row[1]));
  }
  return result;
}

type ProductSnapshot = Pick<
  InvoiceItem,
  "hsCode" | "countryOfOrigin" | "lengthMm" | "widthMm" | "heightMm" | "weightG"
>;

/** Current shipping/customs values of the item's product, copied onto the item when it is saved. */
const snapshotProduct = (productId?: string): ProductSnapshot => {
  const p = productId ? getProductById(productId) : null;
  return {
    hsCode: p?.hsCode ?? null,
    countryOfOrigin: p?.countryOfOrigin ?? null,
    lengthMm: p?.lengthMm ?? null,
    widthMm: p?.widthMm ?? null,
    heightMm: p?.heightMm ?? null,
    weightG: p?.weightG ?? null,
  };
};

const snapshotParams = (s: ProductSnapshot) => [
  s.hsCode,
  s.countryOfOrigin,
  s.lengthMm,
  s.widthMm,
  s.heightMm,
  s.weightG,
];

const toNullableNumber = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

export const createInvoice = (
  data: CreateInvoiceRequest,
): InvoiceWithDetails => {
  const db = getDatabase();
  const invoiceId = generateUUID();
  const shareToken = generateShareToken();
  // Prefer client-provided invoiceNumber when unique; otherwise auto-generate
  let invoiceNumber = data.invoiceNumber;
  if (invoiceNumber) {
    const exists = db.query(
      "SELECT 1 FROM invoices WHERE invoice_number = ? LIMIT 1",
      [invoiceNumber],
    );
    if (exists.length > 0) {
      // Client requested an explicit number which already exists -> reject
      throw new Error("Invoice number already exists");
    }
  } else {
    // If advanced numbering pattern with {SEQ}, {CSEQ}, or {CNUM} is active, allocate real number now; else draft placeholder
    try {
      const rows = db.query(
        "SELECT value FROM settings WHERE key = 'invoiceNumberPattern' LIMIT 1",
      );
      if (rows.length > 0) {
        const pattern = String((rows[0] as unknown[])[0] || "").trim();
        if (pattern && /\{(C?SEQ|CNUM)\}/.test(pattern)) {
          invoiceNumber = getNextInvoiceNumber(data.customerId);
        } else {
          invoiceNumber = generateDraftInvoiceNumber();
        }
      } else {
        invoiceNumber = generateDraftInvoiceNumber();
      }
    } catch (_e) {
      invoiceNumber = generateDraftInvoiceNumber();
    }
  }

  // Load settings for defaults
  const settings = getSettings();

  // Determine tax behavior defaults
  const defaultPricesIncludeTax =
    String(settings.defaultPricesIncludeTax || "false").toLowerCase() ===
    "true";
  const defaultRoundingMode = String(settings.defaultRoundingMode || "line");
  const defaultTaxRate = Number(settings.defaultTaxRate || 0) || 0;

  // Determine if per-line taxes are used
  const hasPerLineTaxes =
    Array.isArray(data.items) &&
    data.items.some(
      (i) =>
        Array.isArray((i as { taxes?: LineTaxInput[] }).taxes) &&
        ((i as { taxes?: LineTaxInput[] }).taxes?.length || 0) > 0,
    );
  let totals = { subtotal: 0, discountAmount: 0, taxAmount: 0, total: 0 };
  let perLineCalc: PerLineCalc | undefined = undefined;
  if (hasPerLineTaxes) {
    perLineCalc = calculatePerLineTotals(
      data.items as unknown as ItemInput[],
      data.discountPercentage || 0,
      data.discountAmount || 0,
      data.pricesIncludeTax ?? defaultPricesIncludeTax,
      (data.roundingMode as "line" | "total") ||
        (defaultRoundingMode as "line" | "total"),
    );
    totals = {
      subtotal: perLineCalc.subtotal,
      discountAmount: perLineCalc.discountAmount,
      taxAmount: perLineCalc.taxAmount,
      total: perLineCalc.total,
    };
  } else {
    totals = calculateInvoiceTotals(
      data.items,
      data.discountPercentage || 0,
      data.discountAmount || 0,
      (typeof data.taxRate === "number" ? data.taxRate : defaultTaxRate) || 0,
      data.pricesIncludeTax ?? defaultPricesIncludeTax,
      (data.roundingMode as "line" | "total") ||
        (defaultRoundingMode as "line" | "total"),
    );
  }

  const now = new Date();
  const issueDate = data.issueDate ? new Date(data.issueDate) : now;
  const dueDate = data.dueDate ? new Date(data.dueDate) : undefined;

  // Get default settings for currency and payment terms
  const currency = data.currency || settings.currency || "USD";
  const paymentTerms =
    data.paymentTerms || settings.paymentTerms || "Due in 30 days";

  const pricesIncludeTax = data.pricesIncludeTax ?? defaultPricesIncludeTax;
  const roundingMode = data.roundingMode || defaultRoundingMode;
  const locale = normalizeInvoiceLocaleSetting(data.locale);

  const invoice: Invoice = {
    id: invoiceId,
    invoiceNumber: invoiceNumber!,
    customerId: data.customerId,
    issueDate,
    dueDate,
    currency,
    status: data.status || "draft",

    // Totals
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    discountPercentage: data.discountPercentage || 0,
    taxRate: hasPerLineTaxes ? 0 : data.taxRate || 0,
    taxAmount: totals.taxAmount,
    total: totals.total,

    pricesIncludeTax,
    roundingMode,
    locale,

    // Payment and notes
    paymentTerms,
    notes: data.notes,

    // System fields
    shareToken,
    createdAt: now,
    updatedAt: now,
  };

  // Insert invoice
  db.query(
    `INSERT INTO invoices (
      id, invoice_number, customer_id, issue_date, due_date, currency, status,
      subtotal, discount_amount, discount_percentage, tax_rate, tax_amount, total,
      payment_terms, notes, share_token, created_at, updated_at,
      prices_include_tax, rounding_mode, locale
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      invoice.id,
      invoice.invoiceNumber,
      invoice.customerId,
      invoice.issueDate,
      invoice.dueDate,
      invoice.currency,
      invoice.status,
      invoice.subtotal,
      invoice.discountAmount,
      invoice.discountPercentage,
      invoice.taxRate,
      invoice.taxAmount,
      invoice.total,
      invoice.paymentTerms,
      invoice.notes,
      invoice.shareToken,
      invoice.createdAt,
      invoice.updatedAt,
      pricesIncludeTax ? 1 : 0,
      roundingMode,
      locale ?? null,
    ],
  );
  recordStatusChange(db, invoiceId, invoice.status || "draft");

  // Insert invoice items
  const items: InvoiceItem[] = [];
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    const itemId = generateUUID();
    const lineTotal = item.quantity * item.unitPrice;
    const unit = typeof item.unit === "string" ? item.unit.trim() : "";
    const snapshot = snapshotProduct(item.productId);

    const invoiceItem: InvoiceItem = {
      id: itemId,
      invoiceId: invoiceId,
      productId: item.productId || undefined,
      description: item.description,
      quantity: item.quantity,
      unit: unit || undefined,
      unitPrice: item.unitPrice,
      lineTotal,
      notes: item.notes,
      sortOrder: i,
      ...snapshot,
    };

    db.query(
      `INSERT INTO invoice_items (
        id, invoice_id, product_id, description, quantity, unit, unit_price, line_total, notes, sort_order,
        hs_code, country_of_origin, length_mm, width_mm, height_mm, weight_g
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        itemId,
        invoiceId,
        item.productId || null,
        item.description,
        item.quantity,
        unit || null,
        item.unitPrice,
        lineTotal,
        item.notes,
        i,
        ...snapshotParams(snapshot),
      ],
    );

    items.push(invoiceItem);

    // Insert per-line taxes if provided
    if (hasPerLineTaxes && perLineCalc) {
      const calc = perLineCalc.perItem[i];
      if (calc && Array.isArray(item.taxes)) {
        for (const t of calc.taxes) {
          db.query(
            `INSERT INTO invoice_item_taxes (id, invoice_item_id, tax_definition_id, percent, taxable_amount, amount, included, sequence, note, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              generateUUID(),
              itemId,
              t.taxDefinitionId || null,
              t.percent,
              calc.taxable,
              t.amount,
              (data.pricesIncludeTax ?? defaultPricesIncludeTax) ? 1 : 0,
              0,
              t.note || null,
              new Date(),
            ],
          );
        }
      }
    }
  }

  // Insert invoice-level tax summary if calculated
  if (hasPerLineTaxes && perLineCalc) {
    for (const s of perLineCalc.summary) {
      db.query(
        `INSERT INTO invoice_taxes (id, invoice_id, tax_definition_id, percent, taxable_amount, tax_amount, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          generateUUID(),
          invoiceId,
          null,
          s.percent,
          s.taxable,
          s.amount,
          new Date(),
        ],
      );
    }
  } else {
    const rawTaxDefId = (data as { taxDefinitionId?: string | null })
      .taxDefinitionId;
    const taxDefinitionId =
      typeof rawTaxDefId === "string" ? rawTaxDefId.trim() : "";
    if (taxDefinitionId) {
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const percent = invoice.taxRate || 0;
      const rate = Math.max(0, Number(percent) || 0) / 100;
      const afterDiscount = r2(invoice.subtotal - invoice.discountAmount);
      const taxable = pricesIncludeTax
        ? rate > 0
          ? r2(afterDiscount / (1 + rate))
          : afterDiscount
        : afterDiscount;
      db.query(
        `INSERT INTO invoice_taxes (id, invoice_id, tax_definition_id, percent, taxable_amount, tax_amount, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          generateUUID(),
          invoiceId,
          taxDefinitionId,
          percent,
          taxable,
          invoice.taxAmount,
          new Date(),
        ],
      );
    }
  }

  // Get customer info for response
  const customer = getCustomerById(data.customerId);
  if (!customer) {
    throw new Error("Customer not found");
  }

  return {
    ...invoice,
    customer,
    items,
    taxes:
      hasPerLineTaxes && perLineCalc
        ? perLineCalc.summary.map((s) => ({
            id: "",
            invoiceId: invoiceId,
            taxDefinitionId: undefined,
            percent: s.percent,
            taxableAmount: s.taxable,
            taxAmount: s.amount,
          }))
        : undefined,
  };
};

export const getInvoices = (): Invoice[] => {
  const db = getDatabase();
  const results = db.query(`
    SELECT id, invoice_number, customer_id, issue_date, due_date, currency, status,
           subtotal, discount_amount, discount_percentage, tax_rate, tax_amount, total,
           payment_terms, notes, share_token, created_at, updated_at,
           prices_include_tax, rounding_mode, locale
    FROM invoices
    ORDER BY created_at DESC
  `);
  const list = results.map((row: unknown[]) => mapRowToInvoice(row));
  return list.map(applyDerivedOverdue);
};

export const getInvoiceById = (id: string): InvoiceWithDetails | null => {
  const db = getDatabase();
  const result = db.query(
    `
    SELECT id, invoice_number, customer_id, issue_date, due_date, currency, status,
           subtotal, discount_amount, discount_percentage, tax_rate, tax_amount, total,
           payment_terms, notes, share_token, created_at, updated_at,
           prices_include_tax, rounding_mode, locale
    FROM invoices
    WHERE id = ?
  `,
    [id],
  );

  if (result.length === 0) return null;

  let invoice = mapRowToInvoice(result[0] as unknown[]);
  invoice = applyDerivedOverdue(invoice);

  // Get customer
  const customer = getCustomerById(invoice.customerId);
  if (!customer) return null;

  // Get items
  const itemsResult = db.query(
    `
    SELECT id, invoice_id, product_id, description, quantity, unit, unit_price, line_total, notes, sort_order,
           hs_code, country_of_origin, length_mm, width_mm, height_mm, weight_g
    FROM invoice_items
    WHERE invoice_id = ?
    ORDER BY sort_order
  `,
    [id],
  );

  const items = itemsResult.map((row: unknown[]) => ({
    id: row[0] as string,
    invoiceId: row[1] as string,
    productId: row[2] ? String(row[2]) : undefined,
    description: row[3] as string,
    quantity: row[4] as number,
    unit: row[5] ? String(row[5]) : undefined,
    unitPrice: row[6] as number,
    lineTotal: row[7] as number,
    notes: row[8] as string,
    sortOrder: row[9] as number,
    hsCode: row[10] ? String(row[10]) : null,
    countryOfOrigin: row[11] ? String(row[11]) : null,
    lengthMm: toNullableNumber(row[12]),
    widthMm: toNullableNumber(row[13]),
    heightMm: toNullableNumber(row[14]),
    weightG: toNullableNumber(row[15]),
  }));

  // Attach per-item taxes
  type ItemTaxRow = {
    taxDefinitionId?: string;
    percent: number;
    taxableAmount: number;
    amount: number;
    included: boolean;
    note?: string;
  };
  let itemsWithTaxes = items.map((it) => ({ ...it }));
  if (items.length > 0) {
    const placeholders = items.map(() => "?").join(",");
    const taxRows = db.query(
      `SELECT invoice_item_id, tax_definition_id, percent, taxable_amount, amount, included, note FROM invoice_item_taxes WHERE invoice_item_id IN (${placeholders})`,
      items.map((it) => it.id),
    );
    const taxesByItem = new Map<string, ItemTaxRow[]>();
    for (const r of taxRows) {
      const itemId = String((r as unknown[])[0]);
      const tax: ItemTaxRow = {
        taxDefinitionId: (r as unknown[])[1]
          ? String((r as unknown[])[1])
          : undefined,
        percent: Number((r as unknown[])[2]),
        taxableAmount: Number((r as unknown[])[3]),
        amount: Number((r as unknown[])[4]),
        included: Boolean((r as unknown[])[5]),
        note: (r as unknown[])[6] as string | undefined,
      };
      if (!taxesByItem.has(itemId)) taxesByItem.set(itemId, []);
      taxesByItem.get(itemId)!.push(tax);
    }
    itemsWithTaxes = items.map((it) => ({
      ...it,
      taxes: taxesByItem.get(it.id),
    }));
  }

  // Invoice tax summary
  const invTaxRows = db.query(
    `SELECT id, invoice_id, tax_definition_id, percent, taxable_amount, tax_amount FROM invoice_taxes WHERE invoice_id = ?`,
    [id],
  );
  const taxes = invTaxRows.map((r) => ({
    id: r[0] as string,
    invoiceId: r[1] as string,
    taxDefinitionId: r[2] ? String(r[2]) : undefined,
    percent: Number(r[3] as number),
    taxableAmount: Number(r[4] as number),
    taxAmount: Number(r[5] as number),
  }));

  const statusHistory = getStatusHistory(id);
  return { ...invoice, customer, items: itemsWithTaxes, taxes, statusHistory };
};

export const getInvoiceByShareToken = (
  shareToken: string,
): InvoiceWithDetails | null => {
  const db = getDatabase();
  const result = db.query(
    `
    SELECT id, invoice_number, customer_id, issue_date, due_date, currency, status,
           subtotal, discount_amount, discount_percentage, tax_rate, tax_amount, total,
           payment_terms, notes, share_token, created_at, updated_at,
           prices_include_tax, rounding_mode, locale
    FROM invoices
    WHERE share_token = ?
  `,
    [shareToken],
  );

  if (result.length === 0) return null;

  let invoice = mapRowToInvoice(result[0] as unknown[]);
  invoice = applyDerivedOverdue(invoice);

  // Draft invoices must never be exposed via public share links.
  if (invoice.status === "draft") return null;

  // Get customer
  const customer = getCustomerById(invoice.customerId);
  if (!customer) return null;

  // Get items
  const itemsResult = db.query(
    `
    SELECT id, invoice_id, product_id, description, quantity, unit, unit_price, line_total, notes, sort_order
    FROM invoice_items
    WHERE invoice_id = ?
    ORDER BY sort_order
  `,
    [invoice.id],
  );

  const items = itemsResult.map((row: unknown[]) => ({
    id: row[0] as string,
    invoiceId: row[1] as string,
    productId: row[2] ? String(row[2]) : undefined,
    description: row[3] as string,
    quantity: row[4] as number,
    unit: row[5] ? String(row[5]) : undefined,
    unitPrice: row[6] as number,
    lineTotal: row[7] as number,
    notes: row[8] as string,
    sortOrder: row[9] as number,
  }));

  // Attach per-item taxes
  type ItemTaxRow2 = {
    taxDefinitionId?: string;
    percent: number;
    taxableAmount: number;
    amount: number;
    included: boolean;
    note?: string;
  };
  let itemsWithTaxes = items.map((it) => ({ ...it }));
  if (items.length > 0) {
    const placeholders = items.map(() => "?").join(",");
    const taxRows = db.query(
      `SELECT invoice_item_id, tax_definition_id, percent, taxable_amount, amount, included, note FROM invoice_item_taxes WHERE invoice_item_id IN (${placeholders})`,
      items.map((it) => it.id),
    );
    const taxesByItem = new Map<string, ItemTaxRow2[]>();
    for (const r of taxRows) {
      const itemId = String((r as unknown[])[0]);
      const tax: ItemTaxRow2 = {
        taxDefinitionId: (r as unknown[])[1]
          ? String((r as unknown[])[1])
          : undefined,
        percent: Number((r as unknown[])[2]),
        taxableAmount: Number((r as unknown[])[3]),
        amount: Number((r as unknown[])[4]),
        included: Boolean((r as unknown[])[5]),
        note: (r as unknown[])[6] as string | undefined,
      };
      if (!taxesByItem.has(itemId)) taxesByItem.set(itemId, []);
      taxesByItem.get(itemId)!.push(tax);
    }
    itemsWithTaxes = items.map((it) => ({
      ...it,
      taxes: taxesByItem.get(it.id),
    }));
  }

  // Invoice tax summary
  const invTaxRows = db.query(
    `SELECT id, invoice_id, tax_definition_id, percent, taxable_amount, tax_amount FROM invoice_taxes WHERE invoice_id = ?`,
    [invoice.id],
  );
  const taxes = invTaxRows.map((r) => ({
    id: r[0] as string,
    invoiceId: r[1] as string,
    taxDefinitionId: r[2] ? String(r[2]) : undefined,
    percent: Number(r[3] as number),
    taxableAmount: Number(r[4] as number),
    taxAmount: Number(r[5] as number),
  }));

  const statusHistory = getStatusHistory(String(invoice.id));
  return { ...invoice, customer, items: itemsWithTaxes, taxes, statusHistory };
};

export const updateInvoice = async (
  id: string,
  data: Partial<UpdateInvoiceRequest>,
): Promise<InvoiceWithDetails | null> => {
  const existing = await getInvoiceById(id);
  if (!existing) return null;

  const db = getDatabase();
  // existing.status may be the derived "overdue"; persist the stored status
  // instead so it isn't frozen into the database.
  const storedStatus = ((db.query("SELECT status FROM invoices WHERE id = ?", [
    id,
  ]) as unknown[][])[0]?.[0] ?? existing.status) as Invoice["status"];

  // Immutability: prevent structural changes once sent/paid
  // Voided invoices are completely locked — only deletion is allowed
  if (existing.status === "voided") {
    throw new Error("Voided invoices cannot be modified.");
  }

  // Validate status transitions
  if (data.status && data.status !== existing.status) {
    const from = existing.status;
    const to = data.status;
    const allowed: Record<string, string[]> = {
      draft: ["sent"],
      sent: ["paid"],
      complete: [],
      overdue: ["paid"],
      paid: ["complete"],
      voided: [],
    };
    if (!(allowed[from] || []).includes(to)) {
      throw new Error(`Cannot change status from '${from}' to '${to}'.`);
    }
  }

  const isIssued = existing.status !== "draft";
  const allowProtectedChanges = isInvoiceProtectionOverrideEnabled();
  if (isIssued && !allowProtectedChanges) {
    const forbidden = [
      "items",
      "discountAmount",
      "discountPercentage",
      "taxRate",
      "pricesIncludeTax",
      "roundingMode",
      "currency",
      "customerId",
      "issueDate",
      "invoiceNumber",
      "subtotal",
      "total",
    ];
    for (const k of forbidden) {
      if ((data as Record<string, unknown>)[k] !== undefined) {
        throw new Error(
          "Issued invoices cannot be modified. Create a credit note instead.",
        );
      }
    }
  }

  // Optional: validate a custom invoice number if provided
  let nextInvoiceNumber: string | undefined = undefined;
  if (typeof data.invoiceNumber === "string") {
    const desired = data.invoiceNumber.trim();
    if (desired.length > 0 && desired !== existing.invoiceNumber) {
      const dup = db.query(
        "SELECT 1 FROM invoices WHERE invoice_number = ? AND id <> ? LIMIT 1",
        [desired, id],
      );
      if (dup.length > 0) {
        throw new Error("Invoice number already exists");
      }
      nextInvoiceNumber = desired;
    }
  }

  // If items are being updated, recalculate totals
  let totals = {
    subtotal: existing.subtotal,
    discountAmount: existing.discountAmount,
    taxAmount: existing.taxAmount,
    total: existing.total,
  };

  let perLineCalcUpdate: PerLineCalc | undefined = undefined;
  if (data.items) {
    const hasPerLine = (data.items as Array<{ taxes?: LineTaxInput[] }>).some(
      (i) => Array.isArray(i.taxes) && (i.taxes?.length || 0) > 0,
    );
    if (hasPerLine) {
      perLineCalcUpdate = calculatePerLineTotals(
        data.items as unknown as ItemInput[],
        data.discountPercentage ?? existing.discountPercentage,
        data.discountAmount ?? existing.discountAmount,
        data.pricesIncludeTax ?? existing.pricesIncludeTax ?? false,
        (data.roundingMode as "line" | "total") ||
          (existing.roundingMode as "line" | "total") ||
          "line",
      );
      totals = {
        subtotal: perLineCalcUpdate.subtotal,
        discountAmount: perLineCalcUpdate.discountAmount,
        taxAmount: perLineCalcUpdate.taxAmount,
        total: perLineCalcUpdate.total,
      };
    } else {
      totals = calculateInvoiceTotals(
        data.items,
        data.discountPercentage ?? existing.discountPercentage,
        data.discountAmount ?? existing.discountAmount,
        data.taxRate ?? existing.taxRate,
        data.pricesIncludeTax ?? existing.pricesIncludeTax ?? false,
        (data.roundingMode as "line" | "total") ||
          (existing.roundingMode as "line" | "total") ||
          "line",
      );
    }
  }

  const updatedAt = new Date();

  // Normalize notes: treat whitespace-only as empty string so it clears stored notes
  const normalizedNotes = ((): string | undefined => {
    if (data.notes === undefined) return undefined; // not provided
    const v = String(data.notes);
    return v.trim().length === 0 ? "" : v;
  })();

  db.execute("BEGIN");
  try {
    // Update invoice
    db.query(
      `
    UPDATE invoices SET
      customer_id = ?, issue_date = ?, due_date = ?, currency = ?, status = ?,
      subtotal = ?, discount_amount = ?, discount_percentage = ?, tax_rate = ?, tax_amount = ?, total = ?,
      payment_terms = ?, notes = ?, updated_at = ?,
      prices_include_tax = COALESCE(?, prices_include_tax),
      rounding_mode = COALESCE(?, rounding_mode),
      locale = ?,
      invoice_number = COALESCE(?, invoice_number)
    WHERE id = ?
  `,
      [
        data.customerId ?? existing.customerId,
        data.issueDate ? new Date(data.issueDate) : existing.issueDate,
        data.dueDate === null || data.dueDate === ""
          ? null
          : data.dueDate
            ? new Date(data.dueDate)
            : existing.dueDate,
        data.currency ?? existing.currency,
        data.status ?? storedStatus,
        totals.subtotal,
        totals.discountAmount,
        data.discountPercentage ?? existing.discountPercentage,
        data.taxRate ?? existing.taxRate,
        totals.taxAmount,
        totals.total,
        data.paymentTerms ?? existing.paymentTerms,
        normalizedNotes !== undefined ? normalizedNotes : existing.notes,
        updatedAt,
        typeof data.pricesIncludeTax === "boolean"
          ? data.pricesIncludeTax
            ? 1
            : 0
          : null,
        data.roundingMode ?? null,
        data.locale === undefined
          ? (existing.locale ?? null)
          : (normalizeInvoiceLocaleSetting(data.locale) ?? null),
        nextInvoiceNumber ?? null,
        id,
      ],
    );
    // Lock a final invoice number when transitioning out of draft without a custom number
    if (
      (data.status === "sent" || data.status === "paid") &&
      existing.status === "draft" &&
      !nextInvoiceNumber &&
      existing.invoiceNumber.startsWith("DRAFT-")
    ) {
      const finalNum = getNextInvoiceNumber(
        data.customerId ?? existing.customerId,
      );
      db.query(
        "UPDATE invoices SET invoice_number = ?, updated_at = ? WHERE id = ?",
        [finalNum, new Date(), id],
      );
    }

    // Record status transition in history
    if (data.status && data.status !== existing.status) {
      recordStatusChange(
        db,
        id,
        data.status,
        data.status === "paid" ? data.paymentMethod : undefined,
      );
    }

    // Update items if provided
    if (data.items) {
      // Delete existing taxes, then items
      db.query(
        "DELETE FROM invoice_item_taxes WHERE invoice_item_id IN (SELECT id FROM invoice_items WHERE invoice_id = ?)",
        [id],
      );
      db.query("DELETE FROM invoice_taxes WHERE invoice_id = ?", [id]);
      db.query("DELETE FROM invoice_items WHERE invoice_id = ?", [id]);

      // Drafts take the products' current values; issued invoices (protection
      // override) keep the snapshot taken when they were last saved as draft.
      const previousSnapshots = new Map<string, ProductSnapshot>();
      if (isIssued) {
        for (const prev of existing.items) {
          if (prev.productId && !previousSnapshots.has(prev.productId)) {
            previousSnapshots.set(prev.productId, prev);
          }
        }
      }

      // Insert new items
      for (let i = 0; i < data.items.length; i++) {
        const item = data.items[i];
        const itemId = generateUUID();
        const lineTotal = item.quantity * item.unitPrice;
        const unit = typeof item.unit === "string" ? item.unit.trim() : "";
        const snapshot =
          (item.productId && previousSnapshots.get(item.productId)) ||
          snapshotProduct(item.productId);

        db.query(
          `
        INSERT INTO invoice_items (
          id, invoice_id, product_id, description, quantity, unit, unit_price, line_total, notes, sort_order,
          hs_code, country_of_origin, length_mm, width_mm, height_mm, weight_g
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
          [
            itemId,
            id,
            item.productId || null,
            item.description,
            item.quantity,
            unit || null,
            item.unitPrice,
            lineTotal,
            item.notes,
            i,
            ...snapshotParams(snapshot),
          ],
        );

        if (perLineCalcUpdate) {
          const calc = perLineCalcUpdate.perItem[i];
          if (
            calc &&
            Array.isArray((item as { taxes?: LineTaxInput[] }).taxes)
          ) {
            for (const t of calc.taxes) {
              db.query(
                `INSERT INTO invoice_item_taxes (id, invoice_item_id, tax_definition_id, percent, taxable_amount, amount, included, sequence, note, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  generateUUID(),
                  itemId,
                  t.taxDefinitionId || null,
                  t.percent,
                  calc.taxable,
                  t.amount,
                  (data.pricesIncludeTax ?? existing.pricesIncludeTax ?? false)
                    ? 1
                    : 0,
                  0,
                  t.note || null,
                  new Date(),
                ],
              );
            }
          }
        }
      }

      if (perLineCalcUpdate) {
        for (const s of perLineCalcUpdate.summary) {
          db.query(
            `INSERT INTO invoice_taxes (id, invoice_id, tax_definition_id, percent, taxable_amount, tax_amount, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              generateUUID(),
              id,
              null,
              s.percent,
              s.taxable,
              s.amount,
              new Date(),
            ],
          );
        }
      }
    }

    // If using invoice-level tax (no per-line taxes), optionally persist a single invoice tax definition.
    const existingHasPerLineTaxes = (existing.items || []).some(
      (it) => Array.isArray(it.taxes) && it.taxes.length > 0,
    );
    const nextHasPerLineTaxes = data.items
      ? !!perLineCalcUpdate
      : existingHasPerLineTaxes;

    if (!nextHasPerLineTaxes) {
      const hasTaxDefinitionIdInRequest = Object.prototype.hasOwnProperty.call(
        data,
        "taxDefinitionId",
      );

      if (data.items || hasTaxDefinitionIdInRequest) {
        const rawTaxDefId = (data as { taxDefinitionId?: string | null })
          .taxDefinitionId;
        const requested =
          typeof rawTaxDefId === "string" ? rawTaxDefId.trim() : "";
        const effectiveTaxDefinitionId = hasTaxDefinitionIdInRequest
          ? requested || undefined
          : existing.taxes && existing.taxes.length > 0
            ? existing.taxes[0].taxDefinitionId
            : undefined;

        // Replace existing invoice_taxes rows (invoice-level mode only)
        db.query("DELETE FROM invoice_taxes WHERE invoice_id = ?", [id]);

        if (effectiveTaxDefinitionId) {
          const r2 = (n: number) => Math.round(n * 100) / 100;
          const percent = (data.taxRate ?? existing.taxRate) || 0;
          const rate = Math.max(0, Number(percent) || 0) / 100;
          const includeTax =
            data.pricesIncludeTax ?? existing.pricesIncludeTax ?? false;
          const afterDiscount = r2(totals.subtotal - totals.discountAmount);
          const taxable = includeTax
            ? rate > 0
              ? r2(afterDiscount / (1 + rate))
              : afterDiscount
            : afterDiscount;
          db.query(
            `INSERT INTO invoice_taxes (id, invoice_id, tax_definition_id, percent, taxable_amount, tax_amount, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              generateUUID(),
              id,
              effectiveTaxDefinitionId,
              percent,
              taxable,
              totals.taxAmount,
              new Date(),
            ],
          );
        }
      }
    }

    db.execute("COMMIT");
  } catch (e) {
    try {
      db.execute("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }

  return await getInvoiceById(id);
};

export const deleteInvoice = async (id: string): Promise<boolean> => {
  const existing = await getInvoiceById(id);
  if (!existing) throw new Error("Invoice not found");

  const allowProtectedChanges = isInvoiceProtectionOverrideEnabled();
  // Only draft invoices can be deleted; issued invoices must be voided for audit trail
  if (
    !allowProtectedChanges &&
    existing.status !== "draft" &&
    existing.status !== "voided"
  ) {
    throw new Error(
      "Only draft or voided invoices can be deleted. Void the invoice first.",
    );
  }

  const db = getDatabase();

  // Delete items first (CASCADE should handle this, but being explicit)
  db.query("DELETE FROM invoice_items WHERE invoice_id = ?", [id]);

  // Delete invoice
  db.query("DELETE FROM invoices WHERE id = ?", [id]);

  return true;
};

export const duplicateInvoice = async (
  id: string,
): Promise<InvoiceWithDetails | null> => {
  const original = await getInvoiceById(id);
  if (!original) return null;
  const db = getDatabase();
  const newId = generateUUID();
  const newShare = generateShareToken();
  const now = new Date();
  // Start as draft with a draft invoice number; copy descriptive fields, totals will be recalculated from items
  const items = original.items || [];
  // Recompute totals to avoid stale numbers
  const totals = calculateInvoiceTotals(
    items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice })),
    original.discountPercentage,
    original.discountAmount,
    original.taxRate,
  );
  db.execute("BEGIN");
  try {
    db.query(
      `
    INSERT INTO invoices (
      id, invoice_number, customer_id, issue_date, due_date, currency, status,
      subtotal, discount_amount, discount_percentage, tax_rate, tax_amount, total,
      payment_terms, notes, share_token, created_at, updated_at,
      prices_include_tax, rounding_mode, locale
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
      [
        newId,
        generateDraftInvoiceNumber(),
        original.customerId,
        now,
        original.dueDate || null,
        original.currency,
        "draft",
        totals.subtotal,
        totals.discountAmount,
        original.discountPercentage,
        original.taxRate,
        totals.taxAmount,
        totals.total,
        original.paymentTerms || null,
        original.notes || null,
        newShare,
        now,
        now,
        (original as Invoice).pricesIncludeTax ? 1 : 0,
        (original as Invoice).roundingMode || "line",
        (original as Invoice).locale ?? null,
      ],
    );
    // Copy items
    for (const [idx, it] of items.entries()) {
      const itemId = generateUUID();
      // New draft: take current product values, keep the original's if the product is gone
      const snapshot = it.productId && getProductById(it.productId)
        ? snapshotProduct(it.productId)
        : it;
      db.query(
        `
      INSERT INTO invoice_items (
        id, invoice_id, product_id, description, quantity, unit, unit_price, line_total, notes, sort_order,
        hs_code, country_of_origin, length_mm, width_mm, height_mm, weight_g
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
        [
          itemId,
          newId,
          it.productId || null,
          it.description,
          it.quantity,
          it.unit || null,
          it.unitPrice,
          it.lineTotal,
          it.notes || null,
          idx,
          ...snapshotParams(snapshot),
        ],
      );
    }
    recordStatusChange(db, newId, "draft");
    db.execute("COMMIT");
  } catch (e) {
    try {
      db.execute("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
  return await getInvoiceById(newId);
};

export const publishInvoice = async (
  id: string,
): Promise<{ shareToken: string; shareUrl: string }> => {
  const invoice = await getInvoiceById(id);
  if (!invoice) {
    throw new Error("Invoice not found");
  }

  // Validate minimal required fields before issuing
  const missing: string[] = [];
  if (!invoice.customer?.name) missing.push("customer.name");
  if (!invoice.items || invoice.items.length === 0) missing.push("items");
  if (!invoice.currency) missing.push("currency");
  if (!invoice.issueDate) missing.push("issueDate");
  if (missing.length) {
    throw new Error(
      `Cannot publish invoice. Missing required fields: ${missing.join(", ")}`,
    );
  }

  // Update status to 'sent' if it's currently 'draft'
  if (invoice.status === "draft") {
    const db = getDatabase();
    const now = new Date();
    let num = invoice.invoiceNumber;
    if (num.startsWith("DRAFT-")) {
      num = getNextInvoiceNumber(invoice.customerId);
    }
    db.execute("BEGIN");
    try {
      db.query(
        "UPDATE invoices SET status = 'sent', invoice_number = ?, updated_at = ? WHERE id = ?",
        [num, now, id],
      );
      recordStatusChange(db, id, "sent");
      db.execute("COMMIT");
    } catch (e) {
      try {
        db.execute("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    }
  }

  const shareUrl = `${
    Deno.env.get("BASE_URL") || "http://localhost:3000"
  }/api/v1/public/invoices/${invoice.shareToken}`;

  return {
    shareToken: invoice.shareToken,
    shareUrl,
  };
};

export const unpublishInvoice = async (
  id: string,
): Promise<{ shareToken: string }> => {
  const existing = await getInvoiceById(id);
  if (!existing) throw new Error("Invoice not found");

  // Only sent or overdue invoices can be unpublished
  if (existing.status !== "sent" && existing.status !== "overdue") {
    throw new Error("Only sent or overdue invoices can be unpublished.");
  }

  const db = getDatabase();
  const newToken = generateShareToken();
  const now = new Date();
  // Rotate share token to invalidate old public links and revert invoice to draft
  db.execute("BEGIN");
  try {
    db.query(
      "UPDATE invoices SET share_token = ?, status = 'draft', updated_at = ? WHERE id = ?",
      [newToken, now, id],
    );
    recordStatusChange(db, id, "draft");
    db.execute("COMMIT");
  } catch (e) {
    try {
      db.execute("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }

  return { shareToken: newToken };
};

export const voidInvoice = async (id: string): Promise<{ success: true }> => {
  const existing = await getInvoiceById(id);
  if (!existing) throw new Error("Invoice not found");
  if (existing.status === "voided") {
    throw new Error("Invoice is already voided");
  }
  if (existing.status === "draft") {
    throw new Error("Draft invoices cannot be voided. Delete them instead.");
  }
  if (existing.status === "paid") {
    throw new Error(
      "Paid invoices cannot be voided. Issue a credit note instead.",
    );
  }
  if (existing.status === "complete") {
    throw new Error(
      "Complete invoices cannot be voided. Issue a credit note instead.",
    );
  }

  const db = getDatabase();
  const now = new Date();
  db.execute("BEGIN");
  try {
    db.query(
      "UPDATE invoices SET status = 'voided', updated_at = ? WHERE id = ?",
      [now, id],
    );
    recordStatusChange(db, id, "voided");
    db.execute("COMMIT");
  } catch (e) {
    try {
      db.execute("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }

  return { success: true };
};

// Helper functions
function mapRowToInvoice(row: unknown[]): Invoice {
  return {
    id: row[0] as string,
    invoiceNumber: row[1] as string,
    customerId: row[2] as string,
    issueDate: new Date(row[3] as string),
    dueDate: row[4] ? new Date(row[4] as string) : undefined,
    currency: row[5] as string,
    status: row[6] as
      | "draft"
      | "sent"
      | "complete"
      | "paid"
      | "overdue"
      | "voided",
    subtotal: row[7] as number,
    discountAmount: row[8] as number,
    discountPercentage: row[9] as number,
    taxRate: row[10] as number,
    taxAmount: row[11] as number,
    total: row[12] as number,
    paymentTerms: row[13] as string,
    notes: row[14] as string,
    shareToken: row[15] as string,
    createdAt: new Date(row[16] as string),
    updatedAt: new Date(row[17] as string),
    pricesIncludeTax: Boolean(row[18] as number),
    roundingMode: (row[19] as string) || "line",
    locale: (row[20] as string) || undefined,
  };
}

function applyDerivedOverdue<
  T extends { status: Invoice["status"]; dueDate?: Date },
>(inv: T): T {
  if (!inv) return inv;
  // Only sent invoices can become overdue; drafts were never issued and
  // paid/voided/complete invoices are settled.
  if (inv.status !== "sent") return inv;
  if (!inv.dueDate) return inv;
  const today = new Date();
  const dd = new Date(
    inv.dueDate.getFullYear(),
    inv.dueDate.getMonth(),
    inv.dueDate.getDate(),
  );
  const td = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (dd < td) {
    (inv as unknown as { status: Invoice["status"] }).status = "overdue";
  }
  return inv;
}

function getCustomerById(id: string) {
  const db = getDatabase();
  let rows: unknown[][] = [];
  try {
    rows = db.query(
      "SELECT id, name, contact_name, email, phone, address, country_code, tax_id, created_at, city, postal_code FROM customers WHERE id = ?",
      [id],
    ) as unknown[][];
  } catch (_e) {
    // Fallback older schema without contact_name/city/postal_code
    try {
      rows = db.query(
        "SELECT id, name, email, phone, address, country_code, tax_id, created_at, city, postal_code FROM customers WHERE id = ?",
        [id],
      ) as unknown[][];
    } catch (_e2) {
      rows = db.query(
        "SELECT id, name, email, phone, address, country_code, tax_id, created_at FROM customers WHERE id = ?",
        [id],
      ) as unknown[][];
    }
  }
  if (rows.length === 0) return null;
  const row = rows[0] as unknown[];
  return {
    id: row[0] as string,
    name: row[1] as string,
    contactName: (row[2] ?? undefined) as string | undefined,
    email: (row[3] ?? undefined) as string | undefined,
    phone: (row[4] ?? undefined) as string | undefined,
    address: (row[5] ?? undefined) as string | undefined,
    countryCode: (row[6] ?? undefined) as string | undefined,
    taxId: (row[7] ?? undefined) as string | undefined,
    createdAt: new Date(row[8] as string),
    city: (row[9] ?? undefined) as string | undefined,
    postalCode: (row[10] ?? undefined) as string | undefined,
  };
}

function getSettings() {
  const db = getDatabase();
  const results = db.query("SELECT key, value FROM settings");
  const settings: Record<string, string> = {};

  for (const row of results) {
    const [key, value] = row as [string, string];
    settings[key] = value;
  }

  return settings;
}
