import { closeDatabase, initDatabase } from "../database/init.ts";
import { createCustomer } from "../controllers/customers.ts";
import { createInvoice, getInvoiceById } from "../controllers/invoices.ts";
import type { BusinessSettings, InvoiceWithDetails } from "../types/index.ts";
import { generateFacturX22XML } from "./facturx.ts";
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

// [category, percent, basis, tax] per Factur-X header ApplicableTradeTax
function facturxTaxes(xml: string): string[][] {
  return all(
    xml,
    /<ram:CalculatedAmount>([^<]*)<\/ram:CalculatedAmount>\s*<ram:TypeCode>VAT<\/ram:TypeCode>\s*<ram:BasisAmount>([^<]*)<\/ram:BasisAmount>\s*<ram:CategoryCode>([^<]*)<\/ram:CategoryCode>\s*<ram:RateApplicablePercent>([^<]*)</g,
  ).map(([tax, basis, cat, percent]) => [cat, percent, basis, tax]);
}

// TaxBasisTotalAmount in the Factur-X header summation
function facturxTaxBasisTotal(xml: string): string {
  return all(xml, /<ram:TaxBasisTotalAmount>([^<]*)</g)[0][0];
}

Deno.test("XML tax base is net with the invoice-level rate and prices including tax", () => {
  const created = createInvoice({
    customerId: customer.id,
    taxRate: 19,
    pricesIncludeTax: true,
    items: [
      { description: "A", quantity: 1, unitPrice: 59.5 },
      { description: "B", quantity: 2, unitPrice: 29.75 },
    ],
  });
  const invoice = stored(created.id);
  assertEquals([invoice.subtotal, invoice.taxAmount, invoice.total], [
    119,
    19,
    119,
  ]);

  const ubl = generateUBLInvoiceXML(invoice, business);
  assertEquals(ublSubtotals(ubl), [["S", "19.00", "100.00", "19.00"]]);
  assertEquals(ublTaxExclusive(ubl), "100.00");

  const facturx = generateFacturX22XML(invoice, business);
  assertEquals(facturxTaxes(facturx), [["S", "19.00", "100.00", "19.00"]]);
  assertEquals(facturxTaxBasisTotal(facturx), "100.00");

  const fattura = generateFatturaXML(invoice, business);
  assertEquals(fatturaSummary(fattura), [["19.00", "100.00", "19.00"]]);
});

Deno.test("XML net total with per-line taxes and prices including tax", () => {
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

  assertEquals(
    ublTaxExclusive(generateUBLInvoiceXML(invoice, business)),
    "150.00",
  );
  assertEquals(
    facturxTaxBasisTotal(generateFacturX22XML(invoice, business)),
    "150.00",
  );
});

Deno.test("XML tax base is net after a discount with prices including tax", () => {
  const created = createInvoice({
    customerId: customer.id,
    taxRate: 19,
    pricesIncludeTax: true,
    discountPercentage: 10,
    items: [
      { description: "A", quantity: 1, unitPrice: 59.5 },
      { description: "B", quantity: 2, unitPrice: 29.75 },
    ],
  });
  const invoice = stored(created.id);
  assertEquals([invoice.discountAmount, invoice.taxAmount, invoice.total], [
    11.9,
    17.1,
    107.1,
  ]);

  const ubl = generateUBLInvoiceXML(invoice, business);
  assertEquals(ublSubtotals(ubl), [["S", "19.00", "90.00", "17.10"]]);
  assertEquals(ublTaxExclusive(ubl), "90.00");

  const facturx = generateFacturX22XML(invoice, business);
  assertEquals(facturxTaxes(facturx), [["S", "19.00", "90.00", "17.10"]]);
  assertEquals(facturxTaxBasisTotal(facturx), "90.00");

  const fattura = generateFatturaXML(invoice, business);
  assertEquals(fatturaSummary(fattura), [["19.00", "90.00", "17.10"]]);
});

Deno.test("UBL gives the buyer a legal name (BR-07)", () => {
  const created = createInvoice({
    customerId: customer.id,
    items: [{ description: "A", quantity: 1, unitPrice: 10 }],
  });
  const ubl = generateUBLInvoiceXML(stored(created.id), business);
  const buyer = ubl.split("<cac:AccountingCustomerParty>")[1];
  assertEquals(
    all(buyer, /<cac:PartyLegalEntity>\s*<cbc:RegistrationName>([^<]*)</g),
    [["Test Customer"]],
  );
});

// ---- EN 16931 calculation rules (BR-CO-10/13/15/16, BR-S-08/BR-Z-08) ----

const num = (s: string | undefined) => Number(s ?? 0);
const cents = (n: number) => Math.round(n * 100);

function first(xml: string, re: RegExp): string | undefined {
  return xml.match(re)?.[1];
}

type Sums = {
  lines: Array<[string, number]>; // [rate, net amount]
  allowances: Array<[string, number]>; // [rate, signed amount]
  taxes: Array<[string, number]>; // [rate, basis]
  lineTotal: number;
  allowanceTotal: number;
  chargeTotal: number;
  taxBasis: number;
  taxTotal: number;
  grand: number;
  rounding: number;
  payable: number;
};

function ublSums(xml: string): Sums {
  const body = xml.split("<cac:InvoiceLine>");
  const header = body[0];
  const monetary = header.split("<cac:LegalMonetaryTotal>")[1];
  return {
    lines: body.slice(1).map((l) => [
      first(l, /<cbc:Percent>([^<]*)</)!,
      num(first(l, /<cbc:LineExtensionAmount[^>]*>([^<]*)</)),
    ]),
    allowances: all(
      header,
      /<cac:AllowanceCharge>\s*<cbc:ChargeIndicator>(true|false)<[\s\S]*?<cbc:Amount[^>]*>([^<]*)<[\s\S]*?<cbc:Percent>([^<]*)</g,
    ).map(([c, amount, rate]) => [rate, (c === "true" ? 1 : -1) * num(amount)]),
    taxes: ublSubtotals(xml).map(([, rate, basis]) => [rate, num(basis)]),
    lineTotal: num(first(monetary, /<cbc:LineExtensionAmount[^>]*>([^<]*)</)),
    allowanceTotal: num(first(monetary, /<cbc:AllowanceTotalAmount[^>]*>([^<]*)</)),
    chargeTotal: num(first(monetary, /<cbc:ChargeTotalAmount[^>]*>([^<]*)</)),
    taxBasis: num(first(monetary, /<cbc:TaxExclusiveAmount[^>]*>([^<]*)</)),
    taxTotal: num(first(header, /<cac:TaxTotal>\s*<cbc:TaxAmount[^>]*>([^<]*)</)),
    grand: num(first(monetary, /<cbc:TaxInclusiveAmount[^>]*>([^<]*)</)),
    rounding: num(first(monetary, /<cbc:PayableRoundingAmount[^>]*>([^<]*)</)),
    payable: num(first(monetary, /<cbc:PayableAmount[^>]*>([^<]*)</)),
  };
}

function facturxSums(xml: string): Sums {
  const lineItems = xml.split("<ram:IncludedSupplyChainTradeLineItem>").slice(1)
    .map((l) => l.split("</ram:IncludedSupplyChainTradeLineItem>")[0]);
  const settlement = xml.split("<ram:ApplicableHeaderTradeSettlement>")[1];
  const summation = settlement.split(
    "<ram:SpecifiedTradeSettlementHeaderMonetarySummation>",
  )[1];
  return {
    lines: lineItems.map((l) => [
      first(l, /<ram:RateApplicablePercent>([^<]*)</)!,
      num(first(l, /<ram:LineTotalAmount>([^<]*)</)),
    ]),
    allowances: all(
      settlement,
      /<ram:SpecifiedTradeAllowanceCharge>[\s\S]*?<udt:Indicator>(true|false)<[\s\S]*?<ram:ActualAmount>([^<]*)<[\s\S]*?<ram:RateApplicablePercent>([^<]*)</g,
    ).map(([c, amount, rate]) => [rate, (c === "true" ? 1 : -1) * num(amount)]),
    taxes: facturxTaxes(xml).map(([, rate, basis]) => [rate, num(basis)]),
    lineTotal: num(first(summation, /<ram:LineTotalAmount>([^<]*)</)),
    allowanceTotal: num(first(summation, /<ram:AllowanceTotalAmount>([^<]*)</)),
    chargeTotal: num(first(summation, /<ram:ChargeTotalAmount>([^<]*)</)),
    taxBasis: num(first(summation, /<ram:TaxBasisTotalAmount>([^<]*)</)),
    taxTotal: num(first(summation, /<ram:TaxTotalAmount[^>]*>([^<]*)</)),
    grand: num(first(summation, /<ram:GrandTotalAmount>([^<]*)</)),
    rounding: num(first(summation, /<ram:RoundingAmount>([^<]*)</)),
    payable: num(first(summation, /<ram:DuePayableAmount>([^<]*)</)),
  };
}

function assertEn16931Sums(label: string, s: Sums, payable: number): void {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + cents(b), 0);
  const check = (rule: string, a: number, b: number) => {
    if (a !== b) throw new Error(`${label} ${rule}: ${a / 100} != ${b / 100}`);
  };
  check("BR-CO-10", cents(s.lineTotal), sum(s.lines.map(([, n]) => n)));
  check(
    "BR-CO-13",
    cents(s.taxBasis),
    cents(s.lineTotal) - cents(s.allowanceTotal) + cents(s.chargeTotal),
  );
  check("BR-CO-15", cents(s.grand), cents(s.taxBasis) + cents(s.taxTotal));
  check("BR-CO-16", cents(s.payable), cents(s.grand) + cents(s.rounding));
  check("payable", cents(s.payable), cents(payable));
  for (const [rate, basis] of s.taxes) {
    check(
      `BR-S-08 (${rate}%)`,
      cents(basis),
      sum(s.lines.filter(([r]) => r === rate).map(([, n]) => n)) +
        sum(s.allowances.filter(([r]) => r === rate).map(([, n]) => n)),
    );
  }
}

Deno.test("UBL and Factur-X amounts satisfy the EN 16931 calculation rules", () => {
  const L = (quantity: number, unitPrice: number, percent?: number) => ({
    description: "X",
    quantity,
    unitPrice,
    taxes: percent === undefined ? [] : [{ percent }],
  });
  const scenarios: Record<string, Record<string, unknown>> = {
    "discount amount": { discountAmount: 20, items: [L(2, 100, 19)] },
    "discount percentage": {
      discountPercentage: 10,
      items: [L(3, 33.33, 19), L(1, 9.99, 19)],
    },
    "two rates with discount": {
      discountAmount: 15,
      items: [L(1, 100, 19), L(3, 12.5, 7)],
    },
    "untaxed line with discount": {
      discountAmount: 10,
      items: [L(1, 100, 19), L(1, 50)],
    },
    "prices including tax": {
      pricesIncludeTax: true,
      items: [L(3, 11.9, 19), L(1, 10.7, 7)],
    },
    "prices including tax with discount": {
      pricesIncludeTax: true,
      discountAmount: 5,
      items: [L(3, 11.9, 19), L(1, 10.7, 7)],
    },
    "prices including tax with rounding": {
      pricesIncludeTax: true,
      items: [L(7, 3.33, 19), L(3, 1.99, 19)],
    },
  };
  for (const [name, data] of Object.entries(scenarios)) {
    const invoice = stored(
      createInvoice({ customerId: customer.id, ...data } as never).id,
    );
    assertEn16931Sums(
      `UBL ${name}`,
      ublSums(generateUBLInvoiceXML(invoice, business)),
      invoice.total,
    );
    assertEn16931Sums(
      `Factur-X ${name}`,
      facturxSums(generateFacturX22XML(invoice, business)),
      invoice.total,
    );
  }
});

Deno.test("A discount is a document-level allowance in UBL and Factur-X", () => {
  const invoice = stored(createInvoice({
    customerId: customer.id,
    discountAmount: 20,
    items: [{ description: "A", quantity: 2, unitPrice: 100, taxes: [{ percent: 19 }] }],
  }).id);

  const ubl = ublSums(generateUBLInvoiceXML(invoice, business));
  assertEquals(
    [ubl.lineTotal, ubl.allowanceTotal, ubl.taxBasis, ubl.allowances],
    [200, 20, 180, [["19.00", -20]]],
  );

  const facturx = facturxSums(generateFacturX22XML(invoice, business));
  assertEquals(
    [facturx.lineTotal, facturx.allowanceTotal, facturx.taxBasis, facturx.allowances],
    [200, 20, 180, [["19.00", -20]]],
  );
Deno.test("UBL writes the city and postal code of both parties", () => {
  const berlin = createCustomer({
    name: "Berlin Customer",
    address: "Hauptstrasse 1",
    city: "Berlin",
    postalCode: "10115",
    countryCode: "DE",
  });
  const created = createInvoice({
    customerId: berlin.id,
    items: [{ description: "A", quantity: 1, unitPrice: 10 }],
  });
  const ubl = generateUBLInvoiceXML(stored(created.id), {
    ...business,
    companyAddress: "Marktplatz 2",
    companyCity: "Munich",
    companyPostalCode: "80331",
  });
  const [seller, buyer] = ubl
    .split("<cac:AccountingCustomerParty>")
    .map((part) => [all(part, /<cbc:CityName>([^<]*)</g), all(part, /<cbc:PostalZone>([^<]*)</g)]);
  assertEquals(seller, [[["Munich"]], [["80331"]]]);
  assertEquals(buyer, [[["Berlin"]], [["10115"]]]);
});
