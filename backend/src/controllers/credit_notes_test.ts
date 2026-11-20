import { closeDatabase, initDatabase } from "../database/init.ts";
import { createCustomer } from "./customers.ts";
import {
  createCreditNote,
  createInvoice,
  duplicateInvoice,
  getInvoiceById,
  publishInvoice,
  updateInvoice,
} from "./invoices.ts";
import { setSetting } from "./settings.ts";
import { generateUBLInvoiceXML } from "../utils/ubl.ts";
import { generateFacturX22XML } from "../utils/facturx.ts";
import { generateFatturaXML } from "../utils/fatturapa.ts";
import { buildInvoiceHTML } from "../utils/pdf.ts";
import type { BusinessSettings, InvoiceWithDetails } from "../types/index.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`Expected ${e}, received ${a}`);
  }
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function assertRejects(fn: () => Promise<unknown>, match: RegExp) {
  try {
    await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!match.test(msg)) throw new Error(`Unexpected error: ${msg}`);
    return;
  }
  throw new Error("Expected an error");
}

const dir = Deno.makeTempDirSync({ prefix: "invio-test-" });
Deno.env.set("DATABASE_PATH", `${dir}/invio.db`);
await initDatabase();
globalThis.addEventListener("unload", () => {
  closeDatabase();
  Deno.removeSync(dir, { recursive: true });
});
setSetting("invoiceNumberingEnabled", "true");
setSetting("invoiceNumberPattern", "INV-{SEQ}");
const customer = createCustomer({ name: "Credit Customer" });
const business: BusinessSettings = {
  companyName: "Test Company",
  currency: "EUR",
};

function stored(id: string): InvoiceWithDetails {
  const invoice = getInvoiceById(id);
  if (!invoice) throw new Error("getInvoiceById returned null");
  return invoice;
}

/** An issued invoice: 2 x 50 at 20% tax, due in the future. */
async function issuedInvoice(): Promise<InvoiceWithDetails> {
  const inv = createInvoice({
    customerId: customer.id,
    dueDate: "2099-01-31",
    paymentTerms: "Due in 30 days",
    items: [
      {
        description: "Consulting",
        quantity: 2,
        unitPrice: 50,
        taxes: [{ percent: 20 }],
      },
    ],
  });
  await publishInvoice(inv.id);
  return stored(inv.id);
}

async function creditNoteFor(invoiceId: string): Promise<InvoiceWithDetails> {
  return await createCreditNote(invoiceId);
}

Deno.test("a credit note copies the invoice as a draft that references it", async () => {
  const invoice = await issuedInvoice();
  const note = await creditNoteFor(invoice.id);

  assertEquals(note.documentType, "credit_note");
  assertEquals(note.status, "draft");
  assertEquals(note.creditedInvoiceId, invoice.id);
  assertEquals(note.creditedInvoice?.invoiceNumber, invoice.invoiceNumber);
  assert(note.invoiceNumber.startsWith("DRAFT-"), "draft number expected");
  assertEquals(note.dueDate, undefined);
  assertEquals(note.paymentTerms, null);
  assertEquals(
    note.items.map((i) => [i.description, i.quantity, i.unitPrice]),
    [["Consulting", 2, 50]],
  );
  assertEquals(
    [note.subtotal, note.taxAmount, note.total],
    [invoice.subtotal, invoice.taxAmount, invoice.total],
  );

  // The invoice lists its credit notes
  assertEquals(
    stored(invoice.id).creditNotes?.map((c) => c.id),
    [note.id],
  );
});

Deno.test("only issued invoices can be credited", async () => {
  const draft = createInvoice({
    customerId: customer.id,
    items: [{ description: "x", quantity: 1, unitPrice: 10 }],
  });
  await assertRejects(() => createCreditNote(draft.id), /issued invoices/);

  const invoice = await issuedInvoice();
  const note = await creditNoteFor(invoice.id);
  await assertRejects(() => createCreditNote(note.id), /cannot be credited/);
  await assertRejects(() => createCreditNote("missing"), /not found/);
});

Deno.test("credit notes share the invoice counter by default", async () => {
  setSetting("creditNoteNumbering", "shared");
  const invoice = await issuedInvoice();
  const n = Number(invoice.invoiceNumber.replace("INV-", ""));
  const note = await creditNoteFor(invoice.id);
  await publishInvoice(note.id);
  assertEquals(
    stored(note.id).invoiceNumber,
    `INV-${String(n + 1).padStart(3, "0")}`,
  );
  // ...and the next invoice continues after the credit note
  const next = await issuedInvoice();
  assertEquals(next.invoiceNumber, `INV-${String(n + 2).padStart(3, "0")}`);
});

Deno.test("credit notes can use their own number pattern", async () => {
  setSetting("creditNoteNumbering", "separate");
  setSetting("creditNoteNumberPattern", "CN-{SEQ}");
  const invoice = await issuedInvoice();
  const first = await creditNoteFor(invoice.id);
  await publishInvoice(first.id);
  const second = await creditNoteFor(invoice.id);
  await publishInvoice(second.id);
  assertEquals(
    [stored(first.id).invoiceNumber, stored(second.id).invoiceNumber],
    ["CN-001", "CN-002"],
  );
  // Invoices keep their own counter
  const next = await issuedInvoice();
  assert(next.invoiceNumber.startsWith("INV-"), next.invoiceNumber);
  setSetting("creditNoteNumbering", "shared");
});

Deno.test("duplicating a credit note gives another credit note", async () => {
  const invoice = await issuedInvoice();
  const note = await creditNoteFor(invoice.id);
  const copy = await duplicateInvoice(note.id);
  assertEquals(copy?.documentType, "credit_note");
  assertEquals(copy?.creditedInvoiceId, invoice.id);
  // Duplicating an invoice still gives an invoice
  const invCopy = await duplicateInvoice(invoice.id);
  assertEquals(invCopy?.documentType, "invoice");
});

Deno.test("credit notes are never overdue", async () => {
  const invoice = await issuedInvoice();
  const note = await creditNoteFor(invoice.id);
  await updateInvoice(note.id, { dueDate: "2000-01-01" });
  await publishInvoice(note.id);
  assertEquals(stored(note.id).status, "sent");

  // An invoice with the same past due date does become overdue
  const late = createInvoice({
    customerId: customer.id,
    dueDate: "2000-01-01",
    items: [{ description: "x", quantity: 1, unitPrice: 10 }],
  });
  await publishInvoice(late.id);
  assertEquals(stored(late.id).status, "overdue");
});

Deno.test("UBL exports a credit note as a CreditNote document", async () => {
  const invoice = await issuedInvoice();
  const note = await creditNoteFor(invoice.id);
  await publishInvoice(note.id);
  const xml = generateUBLInvoiceXML(stored(note.id), business);

  assert(
    xml.includes(
      '<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"',
    ),
    "CreditNote root",
  );
  assert(xml.trimEnd().endsWith("</CreditNote>"), "CreditNote end tag");
  assert(
    xml.includes("<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>"),
    "type code 381",
  );
  assert(!xml.includes("InvoiceTypeCode"), "no InvoiceTypeCode");
  assert(!xml.includes("<cbc:DueDate>"), "no header DueDate");
  assert(
    /<cac:BillingReference>\s*<cac:InvoiceDocumentReference>\s*<cbc:ID>([^<]+)<\/cbc:ID>/
      .exec(xml)?.[1] === invoice.invoiceNumber,
    "billing reference to the invoice",
  );
  assert(xml.includes("<cac:CreditNoteLine>"), "CreditNoteLine");
  assert(xml.includes("<cbc:CreditedQuantity"), "CreditedQuantity");
  assert(!xml.includes("<cac:InvoiceLine>"), "no InvoiceLine");
  assertEquals(
    /<cbc:PayableAmount[^>]*>([^<]*)</.exec(xml)?.[1],
    "120.00",
  );

  // Invoices are unchanged
  const invXml = generateUBLInvoiceXML(stored(invoice.id), business);
  assert(invXml.includes("<cbc:InvoiceTypeCode>380"), "invoice type 380");
  assert(!invXml.includes("BillingReference"), "no billing reference");
});

Deno.test("Factur-X uses type 381 and references the invoice", async () => {
  const invoice = await issuedInvoice();
  const note = await creditNoteFor(invoice.id);
  await publishInvoice(note.id);
  const xml = generateFacturX22XML(stored(note.id), business);
  assert(xml.includes("<ram:TypeCode>381</ram:TypeCode>"), "type 381");
  const ref = /<ram:InvoiceReferencedDocument>\s*<ram:IssuerAssignedID>([^<]+)</
    .exec(xml)?.[1];
  assertEquals(ref, invoice.invoiceNumber);
  // BG-3 comes after the monetary summation
  assert(
    xml.indexOf("</ram:SpecifiedTradeSettlementHeaderMonetarySummation>") <
      xml.indexOf("<ram:InvoiceReferencedDocument>"),
    "element order",
  );
  const invXml = generateFacturX22XML(stored(invoice.id), business);
  assert(!invXml.includes("InvoiceReferencedDocument"), "invoice has no BG-3");
});

Deno.test("FatturaPA uses TD04 and links the invoice", async () => {
  const invoice = await issuedInvoice();
  const note = await creditNoteFor(invoice.id);
  await publishInvoice(note.id);
  const xml = generateFatturaXML(stored(note.id), business);
  assert(xml.includes("<TipoDocumento>TD04</TipoDocumento>"), "TD04");
  const ref = /<DatiFattureCollegate>\s*<IdDocumento>([^<]+)</.exec(xml)?.[1];
  assertEquals(ref, invoice.invoiceNumber);
});

Deno.test("the PDF/HTML calls it a credit note and names the invoice", async () => {
  const invoice = await issuedInvoice();
  const note = await creditNoteFor(invoice.id);
  await publishInvoice(note.id);
  const html = buildInvoiceHTML(
    stored(note.id),
    business,
    "minimalist-clean",
    undefined,
    undefined,
    undefined,
    "en",
  );
  assert(html.includes("Credit Note"), "credit note title");
  assert(html.includes("Credit note for invoice"), "reference label");
  assert(html.includes(invoice.invoiceNumber), "credited invoice number");

  const de = buildInvoiceHTML(
    stored(note.id),
    business,
    "minimalist-clean",
    undefined,
    undefined,
    undefined,
    "de",
  );
  assert(de.includes("Rechnungskorrektur"), "German title");
});
