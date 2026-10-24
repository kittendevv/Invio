// Utility to generate UBL 2.1 XML compliant with PEPPOL BIS Billing 3.0
// using the existing invoice, customer, and settings data.
//
// Scope: We generate a standards-aligned subset that covers all mandatory
// fields and commonly required recommended fields for successful exchange.
// If certain optional identifiers (like PEPPOL endpoint IDs) are not
// configured, the XML remains valid but omits those elements.

import { BusinessSettings, InvoiceWithDetails } from "../types/index.ts";

type Maybe<T> = T | undefined | null;

// Basic XML escape for text nodes/attributes
function xmlEscape(v: Maybe<string | number | boolean>): string {
  if (v === undefined || v === null) return "";
  const s = String(v);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fmtDate(d?: Date): string | undefined {
  if (!d) return undefined;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function _fmtAmount(n: number, currency: string): string {
  // UBL requires a decimal with a currencyID attribute; value should be plain decimal
  // We'll fix to 2 fraction digits for currencies typically used.
  return `<cbc:Amount currencyID="${xmlEscape(currency)}">${
    n.toFixed(2)
  }</cbc:Amount>`;
}

function amountTag(name: string, n: number, currency: string): string {
  return `<cbc:${name} currencyID="${xmlEscape(currency)}">${
    n.toFixed(2)
  }</cbc:${name}>`;
}

function decimals(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function safeCurrency(biz: BusinessSettings, invCurrency?: string): string {
  return (invCurrency || biz.currency || "USD").toUpperCase();
}

function splitAddress(addr?: string): {
  street?: string;
  city?: string;
  postalZone?: string;
  countryCode?: string;
} {
  // Best-effort parse: expect lines like "Street, City, Region Postal, COUNTRY"
  // We keep it simple: first comma -> street; last token with 2-3 uppercase -> country code if matches.
  if (!addr) return {};
  const parts = addr.split(",").map((s) => s.trim()).filter(Boolean);
  const out: {
    street?: string;
    city?: string;
    postalZone?: string;
    countryCode?: string;
  } = {};
  if (parts.length > 0) out.street = parts[0];
  if (parts.length > 1) out.city = parts[1];
  if (parts.length > 2) {
    // Try to find a postal code in the remainder (any 3-10 alnum token)
    const rest = parts.slice(2).join(" ");
    const m = rest.match(/([A-Z0-9\- ]{3,10})$/i);
    if (m) out.postalZone = m[1].trim();
  }
  // Country code heuristic: last 2 letters token
  const last = parts[parts.length - 1] || "";
  const cc = last.trim().toUpperCase();
  if (/^[A-Z]{2,3}$/.test(cc)) {
    out.countryCode = cc.length === 3 ? cc.slice(0, 2) : cc;
  }
  return out;
}

function taxCategoryId(rate: number): string {
  // Simplified: Standard (S) for >0, Zero (Z) for 0
  return rate > 0 ? "S" : "Z";
}

export interface UBLGenerationOptions {
  // Optionally include PEPPOL Endpoint IDs if configured in settings
  sellerEndpointId?: string; // e.g. 0192:123456785
  sellerEndpointSchemeId?: string; // e.g. 0192
  // For buyer, we try to infer from customer fields if provided here
  buyerEndpointId?: string;
  buyerEndpointSchemeId?: string;
  // Seller country code fallback
  sellerCountryCode?: string; // ISO 3166-1 alpha-2
  buyerCountryCode?: string;
}

export function generateUBLInvoiceXML(
  invoice: InvoiceWithDetails,
  business: BusinessSettings,
  options: UBLGenerationOptions = {},
): string {
  const currency = safeCurrency(business, invoice.currency);
  const issueDate = fmtDate(invoice.issueDate) || fmtDate(new Date());
  const dueDate = fmtDate(invoice.dueDate);

  const sellerAddress = splitAddress(business.companyAddress);
  if (!sellerAddress.countryCode && options.sellerCountryCode) {
    sellerAddress.countryCode = options.sellerCountryCode.toUpperCase();
  }
  const buyerAddress = splitAddress(invoice.customer.address);
  if (!buyerAddress.countryCode && options.buyerCountryCode) {
    buyerAddress.countryCode = options.buyerCountryCode.toUpperCase();
  }
  if (business.companyCountryCode) sellerAddress.countryCode = business.companyCountryCode.toUpperCase();
  if (invoice.customer.countryCode) buyerAddress.countryCode = invoice.customer.countryCode.toUpperCase();

  const taxRate = Number(invoice.taxRate || 0);
  const taxCatId = taxCategoryId(taxRate);

  // Header with Note in correct position (before DocumentCurrencyCode)
  const notes = invoice.notes || business.defaultNotes;
  const header = [
    `<cbc:CustomizationID>urn:cen.eu:en16931:2017</cbc:CustomizationID>`,
    `<cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:ProfileID>`,
    `<cbc:ID>${xmlEscape(invoice.invoiceNumber)}</cbc:ID>`,
    `<cbc:IssueDate>${issueDate}</cbc:IssueDate>`,
    dueDate ? `<cbc:DueDate>${dueDate}</cbc:DueDate>` : "",
    `<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>`,
    notes ? `<cbc:Note>${xmlEscape(notes)}</cbc:Note>` : "",
    `<cbc:DocumentCurrencyCode>${xmlEscape(currency)}</cbc:DocumentCurrencyCode>`,
  ].filter(Boolean).join("");

  // Supplier party
  const supplierParty = `
  <cac:AccountingSupplierParty>
    <cac:Party>
      ${options.sellerEndpointId ? `<cbc:EndpointID${options.sellerEndpointSchemeId ? ` schemeID="${xmlEscape(options.sellerEndpointSchemeId)}"` : ""}>${xmlEscape(options.sellerEndpointId)}</cbc:EndpointID>` : ""}
      <cac:PartyName><cbc:Name>${xmlEscape(business.companyName)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        ${sellerAddress.street ? `<cbc:StreetName>${xmlEscape(sellerAddress.street)}</cbc:StreetName>` : ""}
        ${sellerAddress.city ? `<cbc:CityName>${xmlEscape(sellerAddress.city)}</cbc:CityName>` : ""}
        ${sellerAddress.postalZone ? `<cbc:PostalZone>${xmlEscape(sellerAddress.postalZone)}</cbc:PostalZone>` : ""}
        <cac:Country><cbc:IdentificationCode>${xmlEscape(sellerAddress.countryCode || "US")}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      ${business.companyTaxId ? `<cac:PartyTaxScheme><cbc:CompanyID>${xmlEscape(business.companyTaxId)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ""}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${xmlEscape(business.companyName)}</cbc:RegistrationName>
        ${business.companyTaxId ? `<cbc:CompanyID>${xmlEscape(business.companyTaxId)}</cbc:CompanyID>` : ""}
      </cac:PartyLegalEntity>
      ${(business.companyPhone || business.companyEmail) ? `
      <cac:Contact>
        ${business.companyPhone ? `<cbc:Telephone>${xmlEscape(business.companyPhone)}</cbc:Telephone>` : ""}
        ${business.companyEmail ? `<cbc:ElectronicMail>${xmlEscape(business.companyEmail)}</cbc:ElectronicMail>` : ""}
      </cac:Contact>` : ""}
    </cac:Party>
  </cac:AccountingSupplierParty>`;

  // Customer party
  const buyer = invoice.customer;
  const customerParty = `
  <cac:AccountingCustomerParty>
    <cac:Party>
      ${options.buyerEndpointId ? `<cbc:EndpointID${options.buyerEndpointSchemeId ? ` schemeID="${xmlEscape(options.buyerEndpointSchemeId)}"` : ""}>${xmlEscape(options.buyerEndpointId)}</cbc:EndpointID>` : ""}
      <cac:PartyName><cbc:Name>${xmlEscape(buyer.name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        ${buyerAddress.street ? `<cbc:StreetName>${xmlEscape(buyerAddress.street)}</cbc:StreetName>` : ""}
        ${buyerAddress.city ? `<cbc:CityName>${xmlEscape(buyerAddress.city)}</cbc:CityName>` : ""}
        ${buyerAddress.postalZone ? `<cbc:PostalZone>${xmlEscape(buyerAddress.postalZone)}</cbc:PostalZone>` : ""}
        <cac:Country><cbc:IdentificationCode>${xmlEscape(buyerAddress.countryCode || "US")}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      ${buyer.taxId ? `<cac:PartyTaxScheme><cbc:CompanyID>${xmlEscape(buyer.taxId)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ""}
      ${(buyer.phone || buyer.email) ? `
      <cac:Contact>
        ${buyer.phone ? `<cbc:Telephone>${xmlEscape(buyer.phone)}</cbc:Telephone>` : ""}
        ${buyer.email ? `<cbc:ElectronicMail>${xmlEscape(buyer.email)}</cbc:ElectronicMail>` : ""}
      </cac:Contact>` : ""}
    </cac:Party>
  </cac:AccountingCustomerParty>`;

  // Payment means
  const paymentMeans = business.bankAccount ? `
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>
    ${dueDate ? `<cbc:PaymentDueDate>${dueDate}</cbc:PaymentDueDate>` : ""}
    <cac:PayeeFinancialAccount><cbc:ID>${xmlEscape(business.bankAccount)}</cbc:ID></cac:PayeeFinancialAccount>
  </cac:PaymentMeans>` : "";

  const paymentTermsXml = (business.paymentTerms || invoice.paymentTerms) ? `
  <cac:PaymentTerms>
    <cbc:Note>${xmlEscape(business.paymentTerms || invoice.paymentTerms)}</cbc:Note>
  </cac:PaymentTerms>` : "";

  // Tax total
  const taxTotal = `
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${xmlEscape(currency)}">${decimals(invoice.taxAmount)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${xmlEscape(currency)}">${decimals(invoice.subtotal - invoice.discountAmount)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${xmlEscape(currency)}">${decimals(invoice.taxAmount)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${taxCatId}</cbc:ID>
        <cbc:Percent>${decimals(taxRate)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>`;

  // Monetary totals
  const legalMonetaryTotal = `
  <cac:LegalMonetaryTotal>
    ${amountTag("LineExtensionAmount", invoice.subtotal - invoice.discountAmount, currency)}
    ${amountTag("TaxExclusiveAmount", invoice.subtotal - invoice.discountAmount, currency)}
    ${amountTag("TaxInclusiveAmount", invoice.total, currency)}
    ${amountTag("PayableAmount", invoice.total, currency)}
  </cac:LegalMonetaryTotal>`;

  // Invoice lines
  const lines = invoice.items.map((item, idx) => `
    <cac:InvoiceLine>
      <cbc:ID>${idx + 1}</cbc:ID>
  <cbc:InvoicedQuantity unitCode="EA">${decimals(item.quantity)}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="${xmlEscape(currency)}">${decimals(item.lineTotal)}</cbc:LineExtensionAmount>
      <cac:Item>
        <cbc:Name>${xmlEscape(item.description)}</cbc:Name>
        <cac:ClassifiedTaxCategory>
          <cbc:ID>${taxCatId}</cbc:ID>
          <cbc:Percent>${decimals(taxRate)}</cbc:Percent>
          <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
        </cac:ClassifiedTaxCategory>
      </cac:Item>
      <cac:Price><cbc:PriceAmount currencyID="${xmlEscape(currency)}">${decimals(item.unitPrice)}</cbc:PriceAmount></cac:Price>
    </cac:InvoiceLine>`).join("");

  // Assemble XML with correct element order
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  ${header}
  ${supplierParty}
  ${customerParty}
  ${paymentMeans}
  ${paymentTermsXml}
  ${taxTotal}
  ${legalMonetaryTotal}
  ${lines}
</Invoice>`;
}
