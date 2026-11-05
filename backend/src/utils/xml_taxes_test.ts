import { closeDatabase, initDatabase } from "../database/init.ts";
import { createCustomer } from "../controllers/customers.ts";
import { createInvoice, getInvoiceById } from "../controllers/invoices.ts";
import type { BusinessSettings, InvoiceWithDetails } from "../types/index.ts";
import { generateFatturaXML } from "./fatturapa.ts";
import { generateUBLInvoiceXML } from "./ubl.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`Expected ${e}, received ${a}`);
  }
}

const dir = Deno.makeTempDirSync({ prefix: "invio-test-" });
Deno.env.set("DATABASE_PATH", `${dir}/invio.db`);
await initDatabase();
globalThis.addEventListener("unload", () => {
  closeDatabase();
  Deno.removeSync(dir, { recursive: true });
});
const customer = createCustomer({ name: "Test Customer" });
const business: BusinessSettings = {
  companyName: "Test Company",
  currency: "EUR",
};

function stored(id: string): InvoiceWithDetails {
  const invoice = getInvoiceById(id);
  if (!invoice) throw new Error("getInvoiceById returned null");
  return invoice;
}

function all(xml: string, re: RegExp): string[][] {
  return [...xml.matchAll(re)].map((m) => m.slice(1));
}

// [category, percent, taxable, tax] per UBL TaxSubtotal
function ublSubtotals(xml: string): string[][] {
  return all(
    xml,
    /<cac:TaxSubtotal>\s*<cbc:TaxableAmount[^>]*>([^<]*)<\/cbc:TaxableAmount>\s*<cbc:TaxAmount[^>]*>([^<]*)<\/cbc:TaxAmount>\s*<cac:TaxCategory>\s*<cbc:ID>([^<]*)<\/cbc:ID>\s*<cbc:Percent>([^<]*)<\/cbc:Percent>/g,
  ).map(([taxable, tax, cat, percent]) => [cat, percent, taxable, tax]);
}

// [category, percent] per UBL InvoiceLine
function ublLines(xml: string): string[][] {
  return all(
    xml,
    /<cac:ClassifiedTaxCategory>\s*<cbc:ID>([^<]*)<\/cbc:ID>\s*<cbc:Percent>([^<]*)<\/cbc:Percent>/g,
  );
}

// [percent, taxable, tax] per FatturaPA DatiRiepilogo
function fatturaSummary(xml: string): string[][] {
  return all(
    xml,
    /<DatiRiepilogo>\s*<AliquotaIVA>([^<]*)<\/AliquotaIVA>[\s\S]*?<ImponibileImporto>([^<]*)<\/ImponibileImporto>\s*<Imposta>([^<]*)<\/Imposta>/g,
  );
}

// percent per FatturaPA DettaglioLinee
function fatturaLines(xml: string): string[] {
  return all(
    xml,
    /<DettaglioLinee>[\s\S]*?<AliquotaIVA>([^<]*)<\/AliquotaIVA>/g,
  ).map(([p]) => p);
}

Deno.test("UBL and FatturaPA use per-line tax rates", () => {
  const created = createInvoice({
    customerId: customer.id,
    items: [
      {
        description: "A",
        quantity: 1,
        unitPrice: 100,
        taxes: [{ percent: 20 }],
      },
      {
        description: "B",
        quantity: 1,
        unitPrice: 100,
        taxes: [{ percent: 10 }],
      },
    ],
  });
  const invoice = stored(created.id);
  assertEquals([invoice.taxRate, invoice.taxAmount, invoice.total], [
    0,
    30,
    230,
  ]);

  const ubl = generateUBLInvoiceXML(invoice, business);
  assertEquals(ublSubtotals(ubl).sort(), [
    ["S", "10.00", "100.00", "10.00"],
    ["S", "20.00", "100.00", "20.00"],
  ]);
  assertEquals(ublLines(ubl), [["S", "20.00"], ["S", "10.00"]]);

  const fattura = generateFatturaXML(invoice, business);
  assertEquals(fatturaSummary(fattura).sort(), [
    ["10.00", "100.00", "10.00"],
    ["20.00", "100.00", "20.00"],
  ]);
  assertEquals(fatturaLines(fattura), ["20.00", "10.00"]);
});

// TaxExclusiveAmount in UBL LegalMonetaryTotal
function ublTaxExclusive(xml: string): string {
  return all(xml, /<cbc:TaxExclusiveAmount[^>]*>([^<]*)</g)[0][0];
}

Deno.test("UBL and FatturaPA give lines without taxes a 0% summary", () => {
  // The editor sends no taxes for a 0% line
  const created = createInvoice({
    customerId: customer.id,
    discountPercentage: 10,
    items: [
      {
        description: "A",
        quantity: 1,
        unitPrice: 100,
        taxes: [{ percent: 20 }],
      },
      { description: "B", quantity: 1, unitPrice: 50 },
    ],
  });
  const invoice = stored(created.id);
  assertEquals([invoice.discountAmount, invoice.taxAmount, invoice.total], [
    15,
    18,
    153,
  ]);

  const ubl = generateUBLInvoiceXML(invoice, business);
  assertEquals(ublSubtotals(ubl), [
    ["Z", "0.00", "45.00", "0.00"],
    ["S", "20.00", "90.00", "18.00"],
  ]);
  assertEquals(ublLines(ubl), [["S", "20.00"], ["Z", "0.00"]]);
  assertEquals(ublTaxExclusive(ubl), "135.00");

  const fattura = generateFatturaXML(invoice, business);
  assertEquals(fatturaSummary(fattura), [
    ["0.00", "45.00", "0.00"],
    ["20.00", "90.00", "18.00"],
  ]);
  assertEquals(fatturaLines(fattura), ["20.00", "0.00"]);
});

Deno.test("UBL and FatturaPA 0% summary with prices including tax", () => {
  const created = createInvoice({
    customerId: customer.id,
    pricesIncludeTax: true,
    items: [
      {
        description: "A",
        quantity: 1,
        unitPrice: 120,
        taxes: [{ percent: 20 }],
      },
      { description: "B", quantity: 1, unitPrice: 50 },
    ],
  });
  const invoice = stored(created.id);
  assertEquals([invoice.taxAmount, invoice.total], [20, 170]);

  const ubl = generateUBLInvoiceXML(invoice, business);
  assertEquals(ublSubtotals(ubl), [
    ["Z", "0.00", "50.00", "0.00"],
    ["S", "20.00", "100.00", "20.00"],
  ]);

  const fattura = generateFatturaXML(invoice, business);
  assertEquals(fatturaSummary(fattura), [
    ["0.00", "50.00", "0.00"],
    ["20.00", "100.00", "20.00"],
  ]);
});

Deno.test("UBL and FatturaPA keep the invoice-level tax rate", () => {
  const created = createInvoice({
    customerId: customer.id,
    taxRate: 19,
    items: [
      { description: "A", quantity: 1, unitPrice: 60 },
      { description: "B", quantity: 2, unitPrice: 20 },
    ],
  });
  const invoice = stored(created.id);
  assertEquals([invoice.taxAmount, invoice.total], [19, 119]);

  const ubl = generateUBLInvoiceXML(invoice, business);
  assertEquals(ublSubtotals(ubl), [["S", "19.00", "100.00", "19.00"]]);
  assertEquals(ublLines(ubl), [["S", "19.00"], ["S", "19.00"]]);

  const fattura = generateFatturaXML(invoice, business);
  assertEquals(fatturaSummary(fattura), [["19.00", "100.00", "19.00"]]);
  assertEquals(fatturaLines(fattura), ["19.00", "19.00"]);
});
