// Generator for Factur-X / ZUGFeRD 2.2 BASIC profile
// Perfect for uncluttered, self-hosted invoicing without the bloat
import { BusinessSettings, InvoiceWithDetails } from "../types/index.ts";
import { computeXmlTotals, priceDecimals } from "./xmlTotals.ts";

type Maybe<T> = T | undefined | null;

function xmlEscape(v: Maybe<string | number | boolean>): string {
  if (v === undefined || v === null) return "";
  const s = String(v);
  return s.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fmtDateYYYYMMDD(d?: Date): string | undefined {
  if (!d) return undefined;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function decimals(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function safeCurrency(biz?: BusinessSettings, invCurrency?: string): string {
  return (invCurrency || biz?.currency || "EUR").toUpperCase();
}

function splitAddressLines(address?: string): { lineOne?: string; lineTwo?: string; city?: string; zip?: string } {
  if (!address) return {};
  const parts = address.split(/\r?\n/).map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) return {};
  const [lineOne, ...rest] = parts;
  const lineTwo = rest.length ? rest.join(", ") : undefined;
  
  // Simple heuristic: if lineTwo looks like "12345 City", try to extract it
  // This is a fallback if structured city/zip are missing
  let city: string | undefined;
  let zip: string | undefined;

  if (lineTwo && /^\d{4,5}\s+/.test(lineTwo)) {
     const m = lineTwo.match(/^(\d{4,5})\s+(.*)$/);
     if (m) {
       zip = m[1];
       city = m[2];
     }
  } else if (lineOne && /^\d{4,5}\s+/.test(lineOne)) {
     // Sometimes address is just one line: "Street 1, 12345 City"
     // But here we split by newline. If lineOne is "12345 City", it's weird.
     // Let's just leave it for now.
  }

  return {
    lineOne,
    lineTwo,
    city,
    zip,
  };
}

function isLikelyVatId(v?: string): boolean {
  if (!v) return false;
  const s = v.trim();
  if (s.length < 3) return false;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return false; // looks like timestamp
  return /^[A-Za-z0-9][A-Za-z0-9\-\./ ]{1,30}$/.test(s);
}

export interface FacturXOptions {
  sellerCountryCode?: string;
  buyerCountryCode?: string;
  orderReferenceId?: string; // optional
}

export function generateFacturX22XML(
  invoice: InvoiceWithDetails,
  business: BusinessSettings,
  opts: FacturXOptions = {},
): string {
  const currency = safeCurrency(business, invoice.currency);
  const issue = fmtDateYYYYMMDD(invoice.issueDate) || fmtDateYYYYMMDD(new Date()) || "";
  
  // EN16931 (COMFORT) profile - required for XRechnung compliance
  // EN16931 (COMFORT) profile - required for XRechnung compliance
  const profileUrn = "urn:cen.eu:en16931:2017";

  // Line net amounts, VAT breakdown, discount allowances and totals that
  // satisfy the EN 16931 calculation rules
  const totals = computeXmlTotals(invoice);

  // Credit notes use document type 381 and reference the credited invoice (BG-3)
  const isCreditNote = invoice.documentType === "credit_note";
  const credited = isCreditNote ? invoice.creditedInvoice : undefined;
  const creditedDate = fmtDateYYYYMMDD(credited?.issueDate);
  const invoiceReference = credited
    ? `
    <ram:InvoiceReferencedDocument>
      <ram:IssuerAssignedID>${xmlEscape(credited.invoiceNumber)}</ram:IssuerAssignedID>
      ${creditedDate ? `<ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${creditedDate}</qdt:DateTimeString></ram:FormattedIssueDateTime>` : ""}
    </ram:InvoiceReferencedDocument>`
    : "";

  const docContext = `
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter>
      <ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID>
    </ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>${xmlEscape(profileUrn)}</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>`;

  const docHeader = `
  <rsm:ExchangedDocument>
    <ram:ID>${xmlEscape(invoice.invoiceNumber)}</ram:ID>
    <ram:TypeCode>${isCreditNote ? "381" : "380"}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${issue}</udt:DateTimeString></ram:IssueDateTime>
    ${invoice.notes ? `<ram:IncludedNote><ram:Content>${xmlEscape(invoice.notes)}</ram:Content></ram:IncludedNote>` : ""}
  </rsm:ExchangedDocument>`;

  // BASIC: Simplified seller party - only essential elements
  const sellerAddressLines = splitAddressLines(business.companyAddress);
  const sellerParty = `
    <ram:SellerTradeParty>
      <ram:Name>${xmlEscape(business.companyName)}</ram:Name>
      <ram:DefinedTradeContact>
        <ram:PersonName>${xmlEscape(business.companyName)}</ram:PersonName>
        <ram:TelephoneUniversalCommunication>
          <ram:CompleteNumber>${xmlEscape(business.companyPhone || "+49 000 000000")}</ram:CompleteNumber>
        </ram:TelephoneUniversalCommunication>
        <ram:EmailURIUniversalCommunication>
          <ram:URIID>${xmlEscape(business.companyEmail || "info@example.com")}</ram:URIID>
        </ram:EmailURIUniversalCommunication>
      </ram:DefinedTradeContact>
      <ram:PostalTradeAddress>
        ${(business.companyPostalCode || sellerAddressLines.zip) ? `<ram:PostcodeCode>${xmlEscape(business.companyPostalCode || sellerAddressLines.zip)}</ram:PostcodeCode>` : ""}
        ${sellerAddressLines.lineOne ? `<ram:LineOne>${xmlEscape(sellerAddressLines.lineOne)}</ram:LineOne>` : ""}
        ${sellerAddressLines.lineTwo ? `<ram:LineTwo>${xmlEscape(sellerAddressLines.lineTwo)}</ram:LineTwo>` : ""}
        ${(business.companyCity || sellerAddressLines.city) ? `<ram:CityName>${xmlEscape(business.companyCity || sellerAddressLines.city)}</ram:CityName>` : ""}
        <ram:CountryID>${xmlEscape(business.companyCountryCode || opts.sellerCountryCode || "DE")}</ram:CountryID>
      </ram:PostalTradeAddress>
      <ram:URIUniversalCommunication>
        <ram:URIID schemeID="0088">${xmlEscape(business.companyTaxId || "0000000000000")}</ram:URIID>
      </ram:URIUniversalCommunication>
      ${isLikelyVatId(business.companyTaxId) ? `
      <ram:SpecifiedTaxRegistration>
        <ram:ID schemeID="VA">${xmlEscape((business.companyCountryCode || opts.sellerCountryCode || "DE") + business.companyTaxId!)}</ram:ID>
      </ram:SpecifiedTaxRegistration>` : ""}
    </ram:SellerTradeParty>`;

  // BASIC: Simplified buyer party - only essential elements
  const buyer = invoice.customer;
  const buyerAddressLines = splitAddressLines(buyer.address);
  const buyerParty = `
    <ram:BuyerTradeParty>
      <ram:Name>${xmlEscape(buyer.name)}</ram:Name>
      <ram:PostalTradeAddress>
        ${(buyer.postalCode || buyerAddressLines.zip) ? `<ram:PostcodeCode>${xmlEscape(buyer.postalCode || buyerAddressLines.zip)}</ram:PostcodeCode>` : ""}
        ${buyerAddressLines.lineOne ? `<ram:LineOne>${xmlEscape(buyerAddressLines.lineOne)}</ram:LineOne>` : ""}
        ${buyerAddressLines.lineTwo ? `<ram:LineTwo>${xmlEscape(buyerAddressLines.lineTwo)}</ram:LineTwo>` : ""}
        ${(buyer.city || buyerAddressLines.city) ? `<ram:CityName>${xmlEscape(buyer.city || buyerAddressLines.city)}</ram:CityName>` : ""}
        <ram:CountryID>${xmlEscape(buyer.countryCode || opts.buyerCountryCode || "DE")}</ram:CountryID>
        ${buyer.region ? `<ram:CountrySubDivisionName>${xmlEscape(buyer.region)}</ram:CountrySubDivisionName>` : ""}
      </ram:PostalTradeAddress>
      <ram:URIUniversalCommunication>
        <ram:URIID schemeID="0088">${xmlEscape(buyer.taxId || "0000000000000")}</ram:URIID>
      </ram:URIUniversalCommunication>
      ${isLikelyVatId(buyer.taxId) ? `
      <ram:SpecifiedTaxRegistration>
        <ram:ID schemeID="VA">${xmlEscape((buyer.countryCode || opts.buyerCountryCode || "DE") + buyer.taxId!)}</ram:ID>
      </ram:SpecifiedTaxRegistration>` : ""}
    </ram:BuyerTradeParty>`;

  const headerAgreement = `
  <ram:ApplicableHeaderTradeAgreement>
    <ram:BuyerReference>${xmlEscape(invoice.customer.reference || "N/A")}</ram:BuyerReference>
    ${sellerParty}
    ${buyerParty}
    ${opts.orderReferenceId ? `<ram:BuyerOrderReferencedDocument><ram:IssuerAssignedID>${xmlEscape(opts.orderReferenceId)}</ram:IssuerAssignedID></ram:BuyerOrderReferencedDocument>` : ""}
  </ram:ApplicableHeaderTradeAgreement>`;

  const paymentTerms = business.paymentTerms || invoice.paymentTerms;

  // BASIC: Simplified settlement with correct element order
  const headerSettlement = `
  <ram:ApplicableHeaderTradeSettlement>
    <ram:InvoiceCurrencyCode>${xmlEscape(currency)}</ram:InvoiceCurrencyCode>
    ${business.bankAccount ? `
    <ram:SpecifiedTradeSettlementPaymentMeans>
      <ram:TypeCode>58</ram:TypeCode>
      <ram:PayeePartyCreditorFinancialAccount>
        <ram:IBANID>${xmlEscape(business.bankAccount)}</ram:IBANID>
      </ram:PayeePartyCreditorFinancialAccount>
    </ram:SpecifiedTradeSettlementPaymentMeans>` : ""}
    ${totals.taxes.map((t) => `
    <ram:ApplicableTradeTax>
      <ram:CalculatedAmount>${decimals(t.tax)}</ram:CalculatedAmount>
      <ram:TypeCode>VAT</ram:TypeCode>
      <ram:BasisAmount>${decimals(t.basis)}</ram:BasisAmount>
      <ram:CategoryCode>${t.category}</ram:CategoryCode>
      <ram:RateApplicablePercent>${decimals(t.rate)}</ram:RateApplicablePercent>
    </ram:ApplicableTradeTax>`).join("")}
    ${totals.allowanceCharges.map((a) => `
    <ram:SpecifiedTradeAllowanceCharge>
      <ram:ChargeIndicator><udt:Indicator>${a.charge}</udt:Indicator></ram:ChargeIndicator>
      <ram:ActualAmount>${decimals(a.amount)}</ram:ActualAmount>
      ${a.reasonCode ? `<ram:ReasonCode>${a.reasonCode}</ram:ReasonCode>` : ""}
      <ram:Reason>${xmlEscape(a.reason)}</ram:Reason>
      <ram:CategoryTradeTax>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:CategoryCode>${a.category}</ram:CategoryCode>
        <ram:RateApplicablePercent>${decimals(a.rate)}</ram:RateApplicablePercent>
      </ram:CategoryTradeTax>
    </ram:SpecifiedTradeAllowanceCharge>`).join("")}
    ${paymentTerms ? `<ram:SpecifiedTradePaymentTerms><ram:Description>${xmlEscape(paymentTerms)}</ram:Description></ram:SpecifiedTradePaymentTerms>` : ""}
    <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
      <ram:LineTotalAmount>${decimals(totals.lineTotal)}</ram:LineTotalAmount>
      ${totals.chargeTotal ? `<ram:ChargeTotalAmount>${decimals(totals.chargeTotal)}</ram:ChargeTotalAmount>` : ""}
      ${totals.allowanceTotal ? `<ram:AllowanceTotalAmount>${decimals(totals.allowanceTotal)}</ram:AllowanceTotalAmount>` : ""}
      <ram:TaxBasisTotalAmount>${decimals(totals.taxBasisTotal)}</ram:TaxBasisTotalAmount>
      <ram:TaxTotalAmount currencyID="${xmlEscape(currency)}">${decimals(totals.taxTotal)}</ram:TaxTotalAmount>
      ${totals.roundingAmount ? `<ram:RoundingAmount>${decimals(totals.roundingAmount)}</ram:RoundingAmount>` : ""}
      <ram:GrandTotalAmount>${decimals(totals.grandTotal)}</ram:GrandTotalAmount>
      <ram:DuePayableAmount>${decimals(totals.payable)}</ram:DuePayableAmount>
    </ram:SpecifiedTradeSettlementHeaderMonetarySummation>${invoiceReference}
  </ram:ApplicableHeaderTradeSettlement>`;

  // BASIC: Essential line items only
  const linesXml = totals.lines.map((line, idx) => {
    const it = line.item;

    return `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>${idx + 1}</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>${xmlEscape(it.description)}</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>${priceDecimals(line.netUnitPrice)}</ram:ChargeAmount>
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="C62">${decimals(line.quantity)}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>${line.category}</ram:CategoryCode>
          <ram:RateApplicablePercent>${decimals(line.rate)}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>${decimals(line.netAmount)}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`;
  }).join("");

  // Correct element order for BASIC
  const trx = `
  <rsm:SupplyChainTradeTransaction>
    ${linesXml}
    ${headerAgreement}
    <ram:ApplicableHeaderTradeDelivery>
      <ram:ActualDeliverySupplyChainEvent>
        <ram:OccurrenceDateTime><udt:DateTimeString format="102">${issue}</udt:DateTimeString></ram:OccurrenceDateTime>
      </ram:ActualDeliverySupplyChainEvent>
    </ram:ApplicableHeaderTradeDelivery>
    ${headerSettlement}
  </rsm:SupplyChainTradeTransaction>`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice
  xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"
  xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">
  ${docContext}
  ${docHeader}
  ${trx}
</rsm:CrossIndustryInvoice>`;

  return xml;
}