import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
} from "pdf-lib";
import { closeDatabase, initDatabase } from "../database/init.ts";
import { createCustomer } from "../controllers/customers.ts";
import { createInvoice, getInvoiceById } from "../controllers/invoices.ts";
import type { BusinessSettings } from "../types/index.ts";
import { generateInvoicePDF } from "./pdf.ts";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function hasWeasyPrint(): boolean {
  try {
    const bin = Deno.env.get("WEASYPRINT_BIN") || "weasyprint";
    return new Deno.Command(bin, { args: ["--version"] }).outputSync().success;
  } catch {
    return false;
  }
}

function text(obj: unknown): string {
  return obj instanceof PDFString || obj instanceof PDFHexString
    ? obj.decodeText()
    : String(obj);
}

Deno.test({
  name: "Factur-X/ZUGFeRD PDF embeds factur-x.xml with XMP metadata",
  ignore: !hasWeasyPrint(),
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const dir = Deno.makeTempDirSync({ prefix: "invio-test-" });
    Deno.env.set("DATABASE_PATH", `${dir}/invio.db`);
    await initDatabase();
    try {
      const customer = createCustomer({ name: "Test Customer" });
      const business: BusinessSettings = {
        companyName: "Test Company",
        currency: "EUR",
      };
      const created = createInvoice({
        customerId: customer.id,
        items: [{
          description: "A",
          quantity: 1,
          unitPrice: 100,
          taxes: [{ percent: 19 }],
        }],
      });
      const invoice = getInvoiceById(created.id);
      if (!invoice) throw new Error("getInvoiceById returned null");

      const bytes = await generateInvoicePDF(
        invoice,
        business,
        undefined,
        undefined,
        { embedXml: true, embedXmlProfileId: "facturx22" },
      );
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      const catalog = doc.catalog;

      const af = catalog.lookup(PDFName.of("AF"), PDFArray);
      assert(af.size() === 1, `expected 1 associated file, got ${af.size()}`);
      const spec = af.lookup(0, PDFDict);
      assert(
        text(spec.lookup(PDFName.of("F"))) === "factur-x.xml",
        "embedded file must be named factur-x.xml",
      );
      assert(
        spec.lookup(PDFName.of("AFRelationship")) ===
          PDFName.of("Alternative"),
        "AFRelationship must be /Alternative",
      );

      const names = catalog.lookup(PDFName.of("Names"), PDFDict)
        .lookup(PDFName.of("EmbeddedFiles"), PDFDict)
        .lookup(PDFName.of("Names"), PDFArray);
      assert(
        text(names.lookup(0)) === "factur-x.xml",
        "factur-x.xml must be in the EmbeddedFiles name tree",
      );

      const meta = catalog.lookup(PDFName.of("Metadata"));
      const xmp = new TextDecoder().decode(
        meta instanceof PDFRawStream
          ? decodePDFRawStream(meta).decode()
          : new Uint8Array(),
      );
      assert(
        /pdfaid:part(="3"|>3<)/.test(xmp),
        "XMP must keep the PDF/A-3 identification",
      );
      for (
        const needle of [
          "<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>",
          "<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>",
          "<pdfaSchema:prefix>fx</pdfaSchema:prefix>",
        ]
      ) {
        assert(xmp.includes(needle), `XMP is missing ${needle}`);
      }

      assert(doc.context.trailerInfo.ID, "trailer must contain /ID");
    } finally {
      closeDatabase();
      Deno.removeSync(dir, { recursive: true });
    }
  },
});
