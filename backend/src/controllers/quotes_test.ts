import { closeDatabase, initDatabase } from "../database/init.ts";
import { createCustomer } from "./customers.ts";
import {
  createCreditNote,
  createInvoice,
  createInvoiceFromQuote,
  deleteInvoice,
  duplicateInvoice,
  getInvoiceById,
  getInvoices,
  publishInvoice,
  updateInvoice,
  voidInvoice,
} from "./invoices.ts";
import { setSetting } from "./settings.ts";
import { buildInvoiceHTML, documentFileName } from "../utils/pdf.ts";
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
setSetting("quoteNumberPattern", "Q-{SEQ}");
const customer = createCustomer({ name: "Quote Customer" });
const business: BusinessSettings = {
  companyName: "Test Company",
  currency: "EUR",
  bankAccount: "DE00 1234",
};

function stored(id: string): InvoiceWithDetails {
  const invoice = getInvoiceById(id);
  if (!invoice) throw new Error("getInvoiceById returned null");
  return invoice;
}

function newQuote(validUntil = "2099-12-31"): InvoiceWithDetails {
  return createInvoice(
    {
      customerId: customer.id,
      dueDate: validUntil,
      notes: "Valid for 30 days",
      items: [{ description: "Website", quantity: 1, unitPrice: 1000 }],
    },
    "quote",
  );
}

Deno.test("quotes are numbered from their own pattern when created", () => {
  const a = newQuote();
  const b = newQuote();
  assertEquals(a.documentType, "quote");
  assertEquals(a.status, "draft");
  assert(/^Q-\d{3}$/.test(a.invoiceNumber), a.invoiceNumber);
  assertEquals(
    Number(b.invoiceNumber.slice(2)),
    Number(a.invoiceNumber.slice(2)) + 1,
  );
  // Invoices are not affected by quote numbers
  const inv = createInvoice({
    customerId: customer.id,
    items: [{ description: "x", quantity: 1, unitPrice: 1 }],
  });
  assert(inv.invoiceNumber.startsWith("INV-"), inv.invoiceNumber);
});

Deno.test("quotes and invoices are listed separately", () => {
  const q = newQuote();
  const quotes = getInvoices({ quotes: true });
  const invoices = getInvoices();
  assert(quotes.some((i) => i.id === q.id), "quote in quote list");
  assert(!invoices.some((i) => i.id === q.id), "quote not in invoice list");
  assert(
    quotes.every((i) => i.documentType === "quote"),
    "only quotes in quote list",
  );
});

Deno.test("quote status flow and expiry", async () => {
  const q = newQuote();
  await assertRejects(
    () => updateInvoice(q.id, { status: "accepted" }),
    /Cannot change status from 'draft' to 'accepted'/,
  );
  await publishInvoice(q.id);
  assertEquals(stored(q.id).status, "sent");
  await assertRejects(
    () => updateInvoice(q.id, { status: "paid" }),
    /Cannot change status/,
  );
  await updateInvoice(q.id, { status: "declined" });
  assertEquals(stored(q.id).status, "declined");

  // A sent quote past its valid-until date is expired, not overdue
  const old = newQuote("2000-01-01");
  await publishInvoice(old.id);
  assertEquals(stored(old.id).status, "expired");
  // Saving it unchanged from the editor keeps it sent (expiry is derived)
  await updateInvoice(old.id, { status: "expired", notes: "edited" });
  assertEquals(stored(old.id).status, "expired");
  assertEquals(stored(old.id).notes, "edited");
  // ...and it can still be accepted
  await updateInvoice(old.id, { status: "accepted" });
  assertEquals(stored(old.id).status, "accepted");
});

Deno.test("sent quotes can be revised, accepted ones not", async () => {
  const q = newQuote();
  await publishInvoice(q.id);
  await updateInvoice(q.id, {
    items: [{ description: "Website", quantity: 1, unitPrice: 900 }],
  });
  assertEquals(stored(q.id).total, 900);
  await updateInvoice(q.id, { status: "accepted" });
  await assertRejects(
    () =>
      updateInvoice(q.id, {
        items: [{ description: "Website", quantity: 1, unitPrice: 1 }],
      }),
    /Accepted or declined quotes cannot be modified/,
  );
});

Deno.test("quotes can always be deleted, but not voided or credited", async () => {
  const q = newQuote();
  await publishInvoice(q.id);
  await assertRejects(() => voidInvoice(q.id), /Quotes cannot be voided/);
  await assertRejects(() => createCreditNote(q.id), /quote cannot be credited/);
  await deleteInvoice(q.id);
  assertEquals(getInvoiceById(q.id), null);
});

Deno.test("an invoice is created from a quote and linked to it", async () => {
  const q = newQuote();
  await assertRejects(
    () => createInvoiceFromQuote(q.id),
    /Only sent or accepted quotes/,
  );
  await publishInvoice(q.id);
  const inv = await createInvoiceFromQuote(q.id);

  assertEquals(inv.documentType, "invoice");
  assertEquals(inv.status, "draft");
  assertEquals(inv.quoteId, q.id);
  assert(inv.invoiceNumber.startsWith("DRAFT-"), inv.invoiceNumber);
  assertEquals(inv.dueDate, undefined); // not the quote's valid-until date
  assertEquals(inv.notes, null); // not the quote's notes
  assertEquals(
    inv.items.map((i) => [i.description, i.quantity, i.unitPrice]),
    [["Website", 1, 1000]],
  );
  assertEquals(inv.total, q.total);

  // The quote is accepted and both link to each other
  const quote = stored(q.id);
  assertEquals(quote.status, "accepted");
  assertEquals(quote.invoices?.map((i) => i.id), [inv.id]);
  assertEquals(stored(inv.id).quote?.id, q.id);

  // Publishing the invoice uses the invoice counter
  await publishInvoice(inv.id);
  assert(stored(inv.id).invoiceNumber.startsWith("INV-"), "invoice number");

  // An invoice is not a quote
  await assertRejects(() => createInvoiceFromQuote(inv.id), /Quote not found/);
});

Deno.test("duplicating a quote gives a new numbered draft quote", async () => {
  const q = newQuote();
  await publishInvoice(q.id);
  await updateInvoice(q.id, { status: "declined" });
  const copy = await duplicateInvoice(q.id);
  assertEquals(copy?.documentType, "quote");
  assertEquals(copy?.status, "draft");
  assert(/^Q-\d{3}$/.test(copy?.invoiceNumber || ""), "quote number");
});

Deno.test("the PDF/HTML calls it a quote, shows the validity and no bank details", () => {
  const q = newQuote();
  const html = buildInvoiceHTML(
    stored(q.id),
    business,
    "minimalist-clean",
    undefined,
    undefined,
    undefined,
    "en",
  );
  assert(html.includes("Quote"), "quote title");
  assert(html.includes("Valid Until"), "valid until label");
  assert(!html.includes("Due Date"), "no due date label");
  assert(!html.includes("DE00 1234"), "no bank account");

  const de = buildInvoiceHTML(
    stored(q.id),
    business,
    "minimalist-clean",
    undefined,
    undefined,
    undefined,
    "de",
  );
  assert(de.includes("Angebot") && de.includes("Gültig bis"), "German labels");
  assertEquals(documentFileName(stored(q.id), "x", "pdf"), `quote-${q.invoiceNumber}.pdf`);
});
