// Generator for FatturaPA (Italian electronic invoice format)
// Based on PA.004.001.03 standard used in Italy
import { BusinessSettings, InvoiceWithDetails } from "../types/index.ts";

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

function fmtDate(d?: Date): string | undefined {
  if (!d) return undefined;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function decimals(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function safeCurrency(biz?: BusinessSettings, invCurrency?: string): string {
  return (invCurrency || biz?.currency || "EUR").toUpperCase();
}

// Validate and extract IBAN (must be 15-34 chars, alphanumeric only)
function extractIBAN(iban?: string): string {
  if (!iban) return "";
  const s = iban.trim().replace(/\s/g, "").toUpperCase();
  if (/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/.test(s) && s.length >= 15 && s.length <= 34) {
    return s;
  }
  return "";
}

function extractVatId(taxId?: string): string {
  if (!taxId) return "00000000000";
  const s = taxId.trim().replace(/[^0-9]/g, "");
  if (s.length === 0) return "00000000000";
  if (s.length >= 11) return s.slice(0, 11);
  return s.padStart(11, "0");
}

function extractTaxCode(taxId?: string): string {
  if (!taxId) return "";
  const s = taxId.trim().toUpperCase();
  if (s.length === 16 && /^[A-Z0-9]{16}$/.test(s)) return s;
  return s.slice(0, 16);
}

function splitAddress(addr?: string): { 
  street?: string; 
  houseNum?: string; 
  city?: string; 
  postal?: string; 
  province?: string; 
  country?: string;
} {
  if (!addr) return { country: "IT" };
  const parts = addr.split(",").map((s) => s.trim()).filter(Boolean);
  const out: { 
    street?: string;
    houseNum?: string;
    city?: string;
    postal?: string;
    province?: string;
    country?: string;
  } = { country: "IT" };
  
  if (parts.length > 0) {
    const streetParts = parts[0].split(/\s+/);
    if (streetParts.length > 1) {
      out.street = streetParts.slice(0, -1).join(" ");
      out.houseNum = streetParts[streetParts.length - 1];
    } else {
      out.street = parts[0];
    }
  }
  
  if (parts.length > 1) out.city = parts[1];
  
  if (parts.length > 2) {
    const tail = parts.slice(2).join(" ");
    const postalMatch = tail.match(/\b(\d{5})\b/);
    if (postalMatch) out.postal = postalMatch[1];
    
    const provMatch = tail.match(/\b([A-Z]{2})\b/);
    if (provMatch) out.province = provMatch[1];
  }
  
  return out;
}

function taxNatureId(rate: number): string {
  if (rate === 0) return "N1";
  return "S";
}

export interface FatturaXMLOptions {
  sellerCountryCode?: string;
  buyerCountryCode?: string;
  buyerIsPA?: boolean;
  senderCode?: string; // IdTrasmittente code
  transmissionFormat?: string; // defaults to FPA12
}

export function generateFatturaXML(
  invoice: InvoiceWithDetails,
  business: BusinessSettings,
  opts: FatturaXMLOptions = {},
): string {
  const currency = safeCurrency(business, invoice.currency);
  const issueDate = fmtDate(invoice.issueDate) || fmtDate(new Date()) || "";
  const dueDate = fmtDate(invoice.dueDate) || issueDate;

  const sellerAddr = splitAddress(business.companyAddress);
  if (opts.sellerCountryCode) sellerAddr.country = opts.sellerCountryCode.toUpperCase();
  if (business.companyCountryCode) sellerAddr.country = business.companyCountryCode.toUpperCase();

  const buyerAddr = splitAddress(invoice.customer.address);
  if (opts.buyerCountryCode) buyerAddr.country = opts.buyerCountryCode.toUpperCase();
  if (invoice.customer.countryCode) buyerAddr.country = invoice.customer.countryCode.toUpperCase();

  const taxRate = Number(invoice.taxRate || 0);
  const taxAmount = Number(invoice.taxAmount || 0);
  const taxableAmount = Math.max(0, (invoice.subtotal || 0) - (invoice.discountAmount || 0));

  const sellerVatId = extractVatId(business.companyTaxId);
  const buyerVatId = extractVatId(invoice.customer.taxId);
  const sellerCF = extractTaxCode(business.companyTaxId);
  const buyerCF = extractTaxCode(invoice.customer.taxId);
  const ibanClean = extractIBAN(business.bankAccount);

  const senderCode = opts.senderCode || "01234567890"; // default SDI sender code
  const transmissionFormat = (opts.transmissionFormat || "FPA12").toUpperCase();

  const headerXml = `
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>IT</IdPaese>
        <IdCodice>${xmlEscape(senderCode)}</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>1</ProgressivoInvio>
  <FormatoTrasmissione>${xmlEscape(transmissionFormat)}</FormatoTrasmissione>
      <CodiceDestinatario>${opts.buyerIsPA ? "999999" : "AUTORIZ"}</CodiceDestinatario>
      <ContattiTrasmittente>
        ${business.companyEmail ? `<Email>${xmlEscape(business.companyEmail)}</Email>` : "<Email>info@company.it</Email>"}
      </ContattiTrasmittente>
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>${xmlEscape(sellerVatId || "00000000000")}</IdCodice>
        </IdFiscaleIVA>
        ${sellerCF ? `<CodiceFiscale>${xmlEscape(sellerCF)}</CodiceFiscale>` : ""}
        <Anagrafica>
          <Denominazione>${xmlEscape(business.companyName || "Company")}</Denominazione>
        </Anagrafica>
        <RegimeFiscale>RF01</RegimeFiscale>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${xmlEscape(sellerAddr.street || "Via Generica")}</Indirizzo>
        ${sellerAddr.houseNum ? `<NumeroCivico>${xmlEscape(sellerAddr.houseNum)}</NumeroCivico>` : "<NumeroCivico>1</NumeroCivico>"}
        <CAP>${xmlEscape(sellerAddr.postal || "00000")}</CAP>
        <Comune>${xmlEscape(sellerAddr.city || "Roma")}</Comune>
        ${sellerAddr.province ? `<Provincia>${xmlEscape(sellerAddr.province)}</Provincia>` : "<Provincia>RM</Provincia>"}
        <Nazione>${xmlEscape(sellerAddr.country || "IT")}</Nazione>
      </Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>${xmlEscape(buyerVatId)}</IdCodice>
        </IdFiscaleIVA>
        ${buyerCF && buyerCF !== buyerVatId ? `<CodiceFiscale>${xmlEscape(buyerCF)}</CodiceFiscale>` : ""}
        <Anagrafica>
          <Denominazione>${xmlEscape(invoice.customer.name || "Cliente")}</Denominazione>
        </Anagrafica>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${xmlEscape(buyerAddr.street || "Via Generica")}</Indirizzo>
        ${buyerAddr.houseNum ? `<NumeroCivico>${xmlEscape(buyerAddr.houseNum)}</NumeroCivico>` : "<NumeroCivico>1</NumeroCivico>"}
        <CAP>${xmlEscape(buyerAddr.postal || "00000")}</CAP>
        <Comune>${xmlEscape(buyerAddr.city || "Roma")}</Comune>
        ${buyerAddr.province ? `<Provincia>${xmlEscape(buyerAddr.province)}</Provincia>` : "<Provincia>RM</Provincia>"}
        <Nazione>${xmlEscape(buyerAddr.country || "IT")}</Nazione>
      </Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>`;

  const linesXml = invoice.items.map((item, idx) => {
    const qty = Number(item.quantity) || 1;
    const unitPrice = Number(item.unitPrice) || 0;
    const lineTotal = Number(item.lineTotal) || (qty * unitPrice);
    const lineRate = Number(invoice.taxRate || 0);
    
    return `
    <DettaglioLinee>
      <NumeroLinea>${idx + 1}</NumeroLinea>
      <Descrizione>${xmlEscape(item.description || "Servizio")}</Descrizione>
      <Quantita>${decimals(qty)}</Quantita>
      <UnitaMisura>PC</UnitaMisura>
      <PrezzoUnitario>${decimals(unitPrice)}</PrezzoUnitario>
      <PrezzoTotale>${decimals(lineTotal)}</PrezzoTotale>
      <AliquotaIVA>${decimals(lineRate)}</AliquotaIVA>
      <Natura>${taxNatureId(lineRate)}</Natura>
    </DettaglioLinee>`;
  }).join("");

  const datiBody = `
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD01</TipoDocumento>
        <Divisa>${xmlEscape(currency)}</Divisa>
        <Data>${issueDate}</Data>
        <Numero>${xmlEscape(invoice.invoiceNumber)}</Numero>
        <Causale>${xmlEscape(invoice.notes || "Fattura")}</Causale>
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>
      ${linesXml}
      <DatiRiepilogo>
        <AliquotaIVA>${decimals(taxRate)}</AliquotaIVA>
        <Natura>${taxNatureId(taxRate)}</Natura>
        <ImponibileImporto>${decimals(taxableAmount)}</ImponibileImporto>
        <Imposta>${decimals(taxAmount)}</Imposta>
        <EsigibilitaIVA>I</EsigibilitaIVA>
      </DatiRiepilogo>
    </DatiBeniServizi>
    <DatiPagamento>
      <CondizioniPagamento>TP02</CondizioniPagamento>
      <DettaglioPagamento>
        <ModalitaPagamento>${ibanClean ? "MP05" : "MP23"}</ModalitaPagamento>
        <DataScadenzaPagamento>${dueDate}</DataScadenzaPagamento>
        <ImportoPagamento>${decimals(invoice.total)}</ImportoPagamento>
        ${ibanClean ? `<IBAN>${xmlEscape(ibanClean)}</IBAN>` : ""}
      </DettaglioPagamento>
    </DatiPagamento>
  </FatturaElettronicaBody>`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <p:FatturaElettronica versione="${xmlEscape(transmissionFormat)}" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  ${headerXml}
  ${datiBody}
</p:FatturaElettronica>`;

  return xml;
}
