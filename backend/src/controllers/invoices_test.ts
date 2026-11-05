import { closeDatabase, getDatabase, initDatabase } from "../database/init.ts";
import { createCustomer } from "./customers.ts";
import { createInvoice, duplicateInvoice } from "./invoices.ts";

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

async function duplicate(id: string) {
  const copy = await duplicateInvoice(id);
  if (!copy) throw new Error("duplicateInvoice returned null");
  return copy;
}

Deno.test("duplicate keeps per-line taxes and their totals", async () => {
  const original = createInvoice({
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
  assertEquals([original.taxAmount, original.total], [30, 230]);

  const copy = await duplicate(original.id);

  assertEquals([copy.subtotal, copy.taxAmount, copy.total], [200, 30, 230]);
  assertEquals(
    copy.items.map((i) => (i.taxes || []).map((t) => [t.percent, t.amount])),
    [[[20, 20]], [[10, 10]]],
  );
  assertEquals(
    (copy.taxes || [])
      .map((t) => [t.percent, t.taxableAmount, t.taxAmount])
      .sort((a, b) => a[0] - b[0]),
    [
      [10, 100, 10],
      [20, 100, 20],
    ],
  );
});

Deno.test("duplicate keeps prices-include-tax totals", async () => {
  const original = createInvoice({
    customerId: customer.id,
    taxRate: 20,
    pricesIncludeTax: true,
    items: [{ description: "A", quantity: 1, unitPrice: 120 }],
  });
  assertEquals([original.taxAmount, original.total], [20, 120]);

  const copy = await duplicate(original.id);

  assertEquals(copy.pricesIncludeTax, true);
  assertEquals([copy.subtotal, copy.taxAmount, copy.total], [120, 20, 120]);
});

Deno.test("duplicate keeps discount and total rounding", async () => {
  const original = createInvoice({
    customerId: customer.id,
    taxRate: 19,
    discountPercentage: 15,
    roundingMode: "total",
    items: [
      { description: "A", quantity: 1, unitPrice: 33.33 },
      { description: "B", quantity: 1, unitPrice: 33.33 },
      { description: "C", quantity: 1, unitPrice: 33.34 },
    ],
  });
  // Rounding per line would give 16.14 / 101.14
  assertEquals([original.taxAmount, original.total], [16.15, 101.15]);

  const copy = await duplicate(original.id);

  assertEquals(copy.roundingMode, "total");
  assertEquals(
    [copy.subtotal, copy.discountAmount, copy.taxAmount, copy.total],
    [100, 15, 16.15, 101.15],
  );
});

Deno.test("duplicate keeps the invoice tax definition", async () => {
  getDatabase().query(
    "INSERT INTO tax_definitions (id, code, name, percent) VALUES (?, ?, ?, ?)",
    ["td-vat19", "VAT19", "VAT 19%", 19],
  );
  const original = createInvoice({
    customerId: customer.id,
    taxRate: 19,
    taxDefinitionId: "td-vat19",
    items: [{ description: "A", quantity: 2, unitPrice: 50 }],
  });

  const copy = await duplicate(original.id);

  assertEquals([copy.taxAmount, copy.total], [19, 119]);
  assertEquals(
    (copy.taxes || []).map((t) => [
      t.taxDefinitionId,
      t.percent,
      t.taxableAmount,
      t.taxAmount,
    ]),
    [["td-vat19", 19, 100, 19]],
  );
});
