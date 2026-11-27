import {
  closeDatabase,
  getNextInvoiceNumber,
  initDatabase,
  nextCounterValue,
  parseNumberStart,
} from "./init.ts";
import { setSetting } from "../controllers/settings.ts";
import { createCustomer } from "../controllers/customers.ts";
import { createInvoice } from "../controllers/invoices.ts";

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
const customer = createCustomer({ name: "Numbering Customer" });

function newInvoiceNumber(): string {
  return createInvoice({
    customerId: customer.id,
    items: [{ description: "x", quantity: 1, unitPrice: 10 }],
  }).invoiceNumber;
}

Deno.test("parseNumberStart accepts positive whole numbers only", () => {
  assertEquals(parseNumberStart("1000000001"), 1000000001);
  assertEquals(parseNumberStart(" 42 "), 42);
  for (const v of [undefined, null, "", "0", "-5", "1.5", "abc", "null"]) {
    assertEquals(parseNumberStart(v), 1);
  }
});

Deno.test("nextCounterValue never goes below the start or backwards", () => {
  assertEquals(nextCounterValue(0, 1), 1);
  assertEquals(nextCounterValue(0, 500), 500);
  assertEquals(nextCounterValue(499, 500), 500);
  assertEquals(nextCounterValue(700, 500), 701);
});

Deno.test("{SEQ} starts at the configured number and continues from there", () => {
  setSetting("invoiceNumberingEnabled", "true");
  setSetting("invoiceNumberPattern", "R-{SEQ}");
  setSetting("invoiceNumberStart", "1000000001");
  assertEquals(getNextInvoiceNumber(), "R-1000000001");
  assertEquals(newInvoiceNumber(), "R-1000000001");
  assertEquals(newInvoiceNumber(), "R-1000000002");

  // Lowering the start again never reuses or goes below existing numbers.
  setSetting("invoiceNumberStart", "5");
  assertEquals(newInvoiceNumber(), "R-1000000003");
});

Deno.test("legacy numbering respects the start", () => {
  setSetting("invoiceNumberPattern", "");
  setSetting("invoicePrefix", "LEG");
  setSetting("invoiceIncludeYear", "false");
  setSetting("invoiceNumberStart", "250");
  assertEquals(getNextInvoiceNumber(), "LEG-250");
});

Deno.test("without a start the counter begins at 1", () => {
  setSetting("invoiceNumberPattern", "N-{SEQ}");
  setSetting("invoiceNumberStart", "");
  assertEquals(getNextInvoiceNumber(), "N-001");
});
