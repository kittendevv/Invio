import { availableInvoiceLocales, getInvoiceLabels } from "./translations.ts";

function assert(
  condition: boolean,
  message = "Expected condition to be true",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

Deno.test("es-MX invoice labels use Mexican terminology", () => {
  const { locale, labels } = getInvoiceLabels("es-MX");

  assertEquals(locale, "es-mx");
  assertEquals(labels.invoiceTitle, "Factura");
  assertEquals(labels.taxIdLabel, "RFC");
  assertEquals(labels.taxLabel, "IVA");
  assertEquals(labels.taxableLabel, "Base gravable");
  assertEquals(labels.taxAmountLabel, "Importe del IVA");
});

Deno.test("es-MX is an explicit invoice locale", () => {
  assert(availableInvoiceLocales().includes("es-mx"));
});
