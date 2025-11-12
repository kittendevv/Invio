import {
  calculateInvoiceTotals,
  calculateTimeBasedLineTotal,
  generateDraftInvoiceNumber,
  getDatabase,
  getNextInvoiceNumber,
} from "../database/init.ts";
import {
  CreateInvoiceRequest,
  Invoice,
  InvoiceItem,
  InvoiceWithDetails,
  UpdateInvoiceRequest,
} from "../types/index.ts";
import { generateShareToken, generateUUID } from "../utils/uuid.ts";

type LineTaxInput = {
  percent: number;
  code?: string;
  included?: boolean; // ignored; we use invoice-level pricesIncludeTax
  note?: string;
};

type ItemInput = {
  description: string;
  quantity: number;
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
    taxes: Array<{ percent: number; amount: number; note?: string }>;
  }>;
  // Summary grouped by percent
  summary: Array<{ percent: number; taxable: number; amount: number }>;
};

function calculatePerLineTotals(
  items: ItemInput[],
  discountPercentage = 0,
  discountAmount = 0,
  pricesIncludeTax = false,
  _roundingMode: "line" | "total" = "line",
): PerLineCalc {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const lineGrosses = items.map((it) =>
    (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)
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
    const rateSum = taxes.reduce((s, t) => s + (Number(t.percent) || 0), 0) /
      100;

    let net = afterDiscount;
    if (pricesIncludeTax && rateSum > 0) {
      net = afterDiscount / (1 + rateSum);
    }

    const itemTaxes: Array<{ percent: number; amount: number; note?: string }> =
      [];
    for (const t of taxes) {
      const p = (Number(t.percent) || 0) / 100;
      const amt = r2(net * p);
      itemTaxes.push({ percent: r2(p * 100), amount: amt, note: t.note });
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
    // If advanced numbering pattern with {SEQ} is active, allocate real number now; else draft placeholder
    try {
      const rows = db.query(
        "SELECT value FROM settings WHERE key = 'invoiceNumberPattern' LIMIT 1",
      );
      if (rows.length > 0) {
        const pattern = String((rows[0] as unknown[])[0] || "").trim();
        if (pattern && /\{SEQ\}/.test(pattern)) {
          invoiceNumber = getNextInvoiceNumber();
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
  const hasPerLineTaxes = Array.isArray(data.items) &&
    data.items.some((i) =>
      Array.isArray((i as { taxes?: LineTaxInput[] }).taxes) &&
      (((i as { taxes?: LineTaxInput[] }).taxes?.length) || 0) > 0
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
        defaultRoundingMode as "line" | "total",
    );
  }

  const now = new Date();
  const issueDate = data.issueDate ? new Date(data.issueDate) : now;
  const dueDate = data.dueDate ? new Date(data.dueDate) : undefined;

  // Get default settings for currency and payment terms
  const currency = data.currency || settings.currency || "USD";
  const paymentTerms = data.paymentTerms || settings.paymentTerms ||
    "Due in 30 days";

  const pricesIncludeTax = data.pricesIncludeTax ?? defaultPricesIncludeTax;
  const roundingMode = data.roundingMode || defaultRoundingMode;

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
    taxRate: hasPerLineTaxes ? 0 : (data.taxRate || 0),
    taxAmount: totals.taxAmount,
    total: totals.total,

    pricesIncludeTax,
    roundingMode,

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
      prices_include_tax, rounding_mode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    ],
  );

  // Insert invoice items
  const items: InvoiceItem[] = [];
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    const itemId = generateUUID();
    
    // Calculate line total
    let lineTotal: number;
    
    // Check if this is a time-based line item
    if (item.hours !== undefined && item.hours > 0) {
      // Time-based billing: get modifier multiplier
      let modifierMultiplier = 1.0;
      if (item.rateModifierId) {
        const modifierResult = db.query(
          "SELECT multiplier FROM rate_modifiers WHERE id = ?",
          [item.rateModifierId],
        ) as unknown[][];
        if (modifierResult.length > 0) {
          modifierMultiplier = Number(modifierResult[0][0]) || 1.0;
        }
      }
      
      // Get mileage rate from settings
      let mileageRate = 0.70; // default
      const mileageRateResult = db.query(
        "SELECT value FROM settings WHERE key = 'mileageRate'",
      ) as unknown[][];
      if (mileageRateResult.length > 0) {
        mileageRate = Number(mileageRateResult[0][0]) || 0.70;
      }
      
      lineTotal = calculateTimeBasedLineTotal({
        rate: item.rate || 0,
        hours: item.hours || 0,
        modifierMultiplier,
        distance: item.distance,
        mileageRate,
      });
    } else {
      // Traditional quantity-based billing
      lineTotal = (item.quantity ?? 0) * (item.unitPrice ?? 0);
    }

    const invoiceItem: InvoiceItem = {
      id: itemId,
      invoiceId: invoiceId,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal,
      notes: item.notes,
      sortOrder: i,
      hours: item.hours,
      rate: item.rate,
      rateModifierId: item.rateModifierId,
      distance: item.distance,
    };

    db.query(
      `INSERT INTO invoice_items (
        id, invoice_id, description, quantity, unit_price, line_total, notes, sort_order,
        hours, rate, rate_modifier_id, distance
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        itemId,
        invoiceId,
        item.description,
        item.quantity ?? null,
        item.unitPrice ?? null,
        lineTotal,
        item.notes,
        i,
        item.hours ?? null,
        item.rate ?? null,
        item.rateModifierId ?? null,
        item.distance ?? null,
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
              null,
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

  // Recalculate totals from actual line totals (for time-based billing support)
  if (!hasPerLineTaxes) {
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    let finalDiscountAmount = Number(data.discountAmount) || 0;
    if (data.discountPercentage && data.discountPercentage > 0) {
      finalDiscountAmount = subtotal * (data.discountPercentage / 100);
    }
    finalDiscountAmount = Math.min(Math.max(finalDiscountAmount, 0), subtotal);
    
    const afterDiscount = subtotal - finalDiscountAmount;
    const taxRate = (typeof data.taxRate === "number" ? data.taxRate : defaultTaxRate) || 0;
    let taxAmount = 0;
    let total = 0;
    
    if (data.pricesIncludeTax ?? defaultPricesIncludeTax) {
      // Prices include tax - extract tax portion
      const divisor = 1 + (taxRate / 100);
      total = afterDiscount;
      taxAmount = total - (total / divisor);
    } else {
      // Prices exclude tax - add tax on top
      taxAmount = afterDiscount * (taxRate / 100);
      total = afterDiscount + taxAmount;
    }
    
    totals = {
      subtotal: Math.round(subtotal * 100) / 100,
      discountAmount: Math.round(finalDiscountAmount * 100) / 100,
      taxAmount: Math.round(taxAmount * 100) / 100,
      total: Math.round(total * 100) / 100,
    };
    
    // Update invoice with recalculated totals
    db.query(
      `UPDATE invoices SET subtotal = ?, discount_amount = ?, tax_amount = ?, total = ? WHERE id = ?`,
      [totals.subtotal, totals.discountAmount, totals.taxAmount, totals.total, invoiceId],
    );
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
    taxes: hasPerLineTaxes && perLineCalc
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
           prices_include_tax, rounding_mode
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
           prices_include_tax, rounding_mode
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
    SELECT id, invoice_id, description, quantity, unit_price, line_total, notes, sort_order,
           hours, rate, rate_modifier_id, distance
    FROM invoice_items 
    WHERE invoice_id = ? 
    ORDER BY sort_order
  `,
    [id],
  );

  const items = itemsResult.map((row: unknown[]) => ({
    id: row[0] as string,
    invoiceId: row[1] as string,
    description: row[2] as string,
    quantity: row[3] as number,
    unitPrice: row[4] as number,
    lineTotal: row[5] as number,
    notes: row[6] as string,
    sortOrder: row[7] as number,
    hours: row[8] !== null ? row[8] as number : undefined,
    rate: row[9] !== null ? row[9] as number : undefined,
    rateModifierId: row[10] !== null ? row[10] as string : undefined,
    distance: row[11] !== null ? row[11] as number : undefined,
  }));

  // Attach per-item taxes
  type ItemTaxRow = {
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
      `SELECT invoice_item_id, percent, taxable_amount, amount, included, note FROM invoice_item_taxes WHERE invoice_item_id IN (${placeholders})`,
      items.map((it) => it.id),
    );
    const taxesByItem = new Map<string, ItemTaxRow[]>();
    for (const r of taxRows) {
      const itemId = String((r as unknown[])[0]);
      const tax: ItemTaxRow = {
        percent: Number((r as unknown[])[1]),
        taxableAmount: Number((r as unknown[])[2]),
        amount: Number((r as unknown[])[3]),
        included: Boolean((r as unknown[])[4]),
        note: (r as unknown[])[5] as string | undefined,
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
    `SELECT id, invoice_id, percent, taxable_amount, tax_amount FROM invoice_taxes WHERE invoice_id = ?`,
    [id],
  );
  const taxes = invTaxRows.map((r) => ({
    id: r[0] as string,
    invoiceId: r[1] as string,
    taxDefinitionId: undefined,
    percent: Number(r[2] as number),
    taxableAmount: Number(r[3] as number),
    taxAmount: Number(r[4] as number),
  }));

  return {
    ...invoice,
    customer,
    items: itemsWithTaxes,
    taxes,
  };
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
           prices_include_tax, rounding_mode
    FROM invoices 
    WHERE share_token = ?
  `,
    [shareToken],
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
    SELECT id, invoice_id, description, quantity, unit_price, line_total, notes, sort_order,
           hours, rate, rate_modifier_id, distance
    FROM invoice_items 
    WHERE invoice_id = ? 
    ORDER BY sort_order
  `,
    [invoice.id],
  );

  const items = itemsResult.map((row: unknown[]) => ({
    id: row[0] as string,
    invoiceId: row[1] as string,
    description: row[2] as string,
    quantity: row[3] as number,
    unitPrice: row[4] as number,
    lineTotal: row[5] as number,
    notes: row[6] as string,
    sortOrder: row[7] as number,
    hours: row[8] !== null ? row[8] as number : undefined,
    rate: row[9] !== null ? row[9] as number : undefined,
    rateModifierId: row[10] !== null ? row[10] as string : undefined,
    distance: row[11] !== null ? row[11] as number : undefined,
  }));

  // Attach per-item taxes
  type ItemTaxRow2 = {
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
      `SELECT invoice_item_id, percent, taxable_amount, amount, included, note FROM invoice_item_taxes WHERE invoice_item_id IN (${placeholders})`,
      items.map((it) => it.id),
    );
    const taxesByItem = new Map<string, ItemTaxRow2[]>();
    for (const r of taxRows) {
      const itemId = String((r as unknown[])[0]);
      const tax: ItemTaxRow2 = {
        percent: Number((r as unknown[])[1]),
        taxableAmount: Number((r as unknown[])[2]),
        amount: Number((r as unknown[])[3]),
        included: Boolean((r as unknown[])[4]),
        note: (r as unknown[])[5] as string | undefined,
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
    `SELECT id, invoice_id, percent, taxable_amount, tax_amount FROM invoice_taxes WHERE invoice_id = ?`,
    [invoice.id],
  );
  const taxes = invTaxRows.map((r) => ({
    id: r[0] as string,
    invoiceId: r[1] as string,
    taxDefinitionId: undefined,
    percent: Number(r[2] as number),
    taxableAmount: Number(r[3] as number),
    taxAmount: Number(r[4] as number),
  }));

  return {
    ...invoice,
    customer,
    items: itemsWithTaxes,
    taxes,
  };
};

export const updateInvoice = async (
  id: string,
  data: Partial<UpdateInvoiceRequest>,
): Promise<InvoiceWithDetails | null> => {
  const existing = await getInvoiceById(id);
  if (!existing) return null;

  const db = getDatabase();

  // Immutability: prevent structural changes once sent/paid
  const isIssued = existing.status !== "draft";
  if (isIssued) {
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
    const hasPerLine = (data.items as Array<{ taxes?: LineTaxInput[] }>).some((
      i,
    ) => Array.isArray(i.taxes) && (i.taxes?.length || 0) > 0);
    if (hasPerLine) {
      perLineCalcUpdate = calculatePerLineTotals(
        data.items as unknown as ItemInput[],
        data.discountPercentage ?? existing.discountPercentage,
        data.discountAmount ?? existing.discountAmount,
        data.pricesIncludeTax ?? existing.pricesIncludeTax ?? false,
        (data.roundingMode as "line" | "total") ||
          (existing.roundingMode as "line" | "total") || "line",
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
          (existing.roundingMode as "line" | "total") || "line",
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

  // Update invoice
  db.query(
    `
    UPDATE invoices SET 
      customer_id = ?, issue_date = ?, due_date = ?, currency = ?, status = ?,
      subtotal = ?, discount_amount = ?, discount_percentage = ?, tax_rate = ?, tax_amount = ?, total = ?,
      payment_terms = ?, notes = ?, updated_at = ?,
      prices_include_tax = COALESCE(?, prices_include_tax),
      rounding_mode = COALESCE(?, rounding_mode),
      invoice_number = COALESCE(?, invoice_number)
    WHERE id = ?
  `,
    [
      data.customerId ?? existing.customerId,
      data.issueDate ? new Date(data.issueDate) : existing.issueDate,
      (data.dueDate === null || data.dueDate === "")
        ? null
        : (data.dueDate ? new Date(data.dueDate) : existing.dueDate),
      data.currency ?? existing.currency,
      data.status ?? existing.status,
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
        ? (data.pricesIncludeTax ? 1 : 0)
        : null,
      data.roundingMode ?? null,
      nextInvoiceNumber ?? null,
      id,
    ],
  );
  // If transitioning from draft to sent/paid, lock a final invoice number when still using a draft placeholder
  if (
    (data.status === "sent" || data.status === "paid") &&
    existing.status === "draft"
  ) {
    // Reload current to check number
    const current = await getInvoiceById(id);
    if (
      current && current.invoiceNumber &&
      current.invoiceNumber.startsWith("DRAFT-")
    ) {
      const finalNum = getNextInvoiceNumber();
      db.query(
        "UPDATE invoices SET invoice_number = ?, updated_at = ? WHERE id = ?",
        [finalNum, new Date(), id],
      );
    }
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

    // Insert new items with time-based calculation support
    const updatedItems: InvoiceItem[] = [];
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      const itemId = generateUUID();
      
      // Calculate line total (support both time-based and quantity-based)
      let lineTotal: number;
      
      if (item.hours !== undefined && item.hours > 0) {
        // Time-based billing
        let modifierMultiplier = 1.0;
        if (item.rateModifierId) {
          const modifierResult = db.query(
            "SELECT multiplier FROM rate_modifiers WHERE id = ?",
            [item.rateModifierId],
          ) as unknown[][];
          if (modifierResult.length > 0) {
            modifierMultiplier = Number(modifierResult[0][0]) || 1.0;
          }
        }
        
        let mileageRate = 0.70;
        const mileageRateResult = db.query(
          "SELECT value FROM settings WHERE key = 'mileageRate'",
        ) as unknown[][];
        if (mileageRateResult.length > 0) {
          mileageRate = Number(mileageRateResult[0][0]) || 0.70;
        }
        
        lineTotal = calculateTimeBasedLineTotal({
          rate: item.rate || 0,
          hours: item.hours || 0,
          modifierMultiplier,
          distance: item.distance,
          mileageRate,
        });
      } else {
        // Traditional quantity-based billing
        lineTotal = (item.quantity ?? 0) * (item.unitPrice ?? 0);
      }

      db.query(
        `
        INSERT INTO invoice_items (
          id, invoice_id, description, quantity, unit_price, line_total, notes, sort_order,
          hours, rate, rate_modifier_id, distance
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          itemId,
          id,
          item.description,
          item.quantity ?? null,
          item.unitPrice ?? null,
          lineTotal,
          item.notes,
          i,
          item.hours ?? null,
          item.rate ?? null,
          item.rateModifierId ?? null,
          item.distance ?? null,
        ],
      );

      updatedItems.push({
        id: itemId,
        invoiceId: id,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal,
        notes: item.notes,
        sortOrder: i,
        hours: item.hours,
        rate: item.rate,
        rateModifierId: item.rateModifierId,
        distance: item.distance,
      });

      if (perLineCalcUpdate) {
        const calc = perLineCalcUpdate.perItem[i];
        if (calc && Array.isArray((item as { taxes?: LineTaxInput[] }).taxes)) {
          for (const t of calc.taxes) {
            db.query(
              `INSERT INTO invoice_item_taxes (id, invoice_item_id, tax_definition_id, percent, taxable_amount, amount, included, sequence, note, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                generateUUID(),
                itemId,
                null,
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

    // Recalculate totals from actual line totals (for time-based billing support)
    if (!perLineCalcUpdate) {
      const subtotal = updatedItems.reduce((sum, item) => sum + item.lineTotal, 0);
      let finalDiscountAmount = Number(data.discountAmount ?? existing.discountAmount) || 0;
      const discountPercentage = data.discountPercentage ?? existing.discountPercentage;
      if (discountPercentage && discountPercentage > 0) {
        finalDiscountAmount = subtotal * (discountPercentage / 100);
      }
      finalDiscountAmount = Math.min(Math.max(finalDiscountAmount, 0), subtotal);
      
      const afterDiscount = subtotal - finalDiscountAmount;
      const taxRate = data.taxRate ?? existing.taxRate;
      let taxAmount = 0;
      let total = 0;
      
      const pricesIncludeTax = data.pricesIncludeTax ?? existing.pricesIncludeTax ?? false;
      if (pricesIncludeTax) {
        total = afterDiscount;
        taxAmount = total - (total / (1 + (taxRate / 100)));
      } else {
        taxAmount = afterDiscount * (taxRate / 100);
        total = afterDiscount + taxAmount;
      }
      
      totals = {
        subtotal: Math.round(subtotal * 100) / 100,
        discountAmount: Math.round(finalDiscountAmount * 100) / 100,
        taxAmount: Math.round(taxAmount * 100) / 100,
        total: Math.round(total * 100) / 100,
      };
      
      // Update invoice with recalculated totals
      db.query(
        `UPDATE invoices SET subtotal = ?, discount_amount = ?, tax_amount = ?, total = ? WHERE id = ?`,
        [totals.subtotal, totals.discountAmount, totals.taxAmount, totals.total, id],
      );
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

  return await getInvoiceById(id);
};

export const deleteInvoice = (id: string): boolean => {
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
  db.query(
    `
    INSERT INTO invoices (
      id, invoice_number, customer_id, issue_date, due_date, currency, status,
      subtotal, discount_amount, discount_percentage, tax_rate, tax_amount, total,
      payment_terms, notes, share_token, created_at, updated_at,
      prices_include_tax, rounding_mode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    ],
  );
  // Copy items
  for (const [idx, it] of items.entries()) {
    const itemId = generateUUID();
    db.query(
      `
      INSERT INTO invoice_items (
        id, invoice_id, description, quantity, unit_price, line_total, notes, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        itemId,
        newId,
        it.description,
        it.quantity,
        it.unitPrice,
        it.lineTotal,
        it.notes || null,
        idx,
      ],
    );
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
    // If invoice number is a DRAFT placeholder, assign a final number now and lock it
    const now = new Date();
    let num = invoice.invoiceNumber;
    if (num.startsWith("DRAFT-")) {
      num = getNextInvoiceNumber();
    }
    db.query(
      "UPDATE invoices SET status = 'sent', invoice_number = ?, updated_at = ? WHERE id = ?",
      [num, now, id],
    );
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

  const db = getDatabase();
  const newToken = generateShareToken();
  const now = new Date();
  // Rotate share token and set status back to 'draft' to reflect unpublished state
  db.query(
    "UPDATE invoices SET share_token = ?, status = 'draft', updated_at = ? WHERE id = ?",
    [newToken, now, id],
  );

  return { shareToken: newToken };
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
    status: row[6] as "draft" | "sent" | "paid" | "overdue",
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
  };
}

function applyDerivedOverdue<
  T extends { status: Invoice["status"]; dueDate?: Date },
>(inv: T): T {
  if (!inv) return inv;
  if (inv.status === "paid") return inv;
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
