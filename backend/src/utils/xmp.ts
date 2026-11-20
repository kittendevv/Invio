// XMP metadata helpers for Factur-X / ZUGFeRD 2.x hybrid invoices.
//
// A conforming PDF must declare the embedded invoice in its XMP metadata using
// the `fx` namespace, and because the PDF is PDF/A-3 the `fx` schema itself has
// to be described through a PDF/A extension schema. These properties are merged
// into the XMP WeasyPrint already writes (which carries pdfaid:part/conformance),
// so PDF/A identification is preserved.

export const FACTURX_NS =
  "urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#";

function xmlEscape(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function facturxDescription(
  fileName: string,
  conformanceLevel: string,
  version: string,
): string {
  return `
    <rdf:Description rdf:about="" xmlns:fx="${FACTURX_NS}">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>${xmlEscape(fileName)}</fx:DocumentFileName>
      <fx:Version>${xmlEscape(version)}</fx:Version>
      <fx:ConformanceLevel>${xmlEscape(conformanceLevel)}</fx:ConformanceLevel>
    </rdf:Description>`;
}

function fxProperty(name: string, description: string): string {
  return `
              <rdf:li rdf:parseType="Resource">
                <pdfaProperty:name>${name}</pdfaProperty:name>
                <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                <pdfaProperty:category>external</pdfaProperty:category>
                <pdfaProperty:description>${description}</pdfaProperty:description>
              </rdf:li>`;
}

const FX_SCHEMA_ITEM = `
        <rdf:li rdf:parseType="Resource"
            xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
            xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
          <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
          <pdfaSchema:namespaceURI>${FACTURX_NS}</pdfaSchema:namespaceURI>
          <pdfaSchema:prefix>fx</pdfaSchema:prefix>
          <pdfaSchema:property>
            <rdf:Seq>${
  fxProperty("DocumentFileName", "The name of the embedded XML document")
}${
  fxProperty(
    "DocumentType",
    "The type of the hybrid document in capital letters, e.g. INVOICE or ORDER",
  )
}${
  fxProperty(
    "Version",
    "The actual version of the standard applying to the embedded XML document",
  )
}${
  fxProperty(
    "ConformanceLevel",
    "The conformance level of the embedded XML document",
  )
}
            </rdf:Seq>
          </pdfaSchema:property>
        </rdf:li>`;

const EXTENSION_DESCRIPTION = `
    <rdf:Description rdf:about=""
        xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
        xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
        xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>${FX_SCHEMA_ITEM}
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>`;

/**
 * Build a complete XMP packet for a Factur-X PDF/A-3B document. Used only when
 * the rendered PDF has no XMP metadata of its own.
 */
export function generateZugferdXMP(
  fileName: string,
  conformanceLevel = "EN 16931",
  version = "1.0",
): string {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>${
    facturxDescription(fileName, conformanceLevel, version)
  }${EXTENSION_DESCRIPTION}
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * Merge the Factur-X properties (and their PDF/A extension schema) into an
 * existing XMP packet, keeping everything that is already there.
 */
export function mergeZugferdIntoXMP(
  existingXmp: string | undefined,
  fileName: string,
  conformanceLevel = "EN 16931",
  version = "1.0",
): string {
  if (!existingXmp || !existingXmp.includes("</rdf:RDF>")) {
    return generateZugferdXMP(fileName, conformanceLevel, version);
  }
  if (existingXmp.includes(FACTURX_NS)) {
    // Already tagged (e.g. re-processing) - leave as is.
    return existingXmp;
  }

  let xmp = existingXmp;
  let additions = facturxDescription(fileName, conformanceLevel, version);

  // If an extension schema bag already exists, add our schema to it instead of
  // declaring pdfaExtension:schemas a second time.
  const bagMatch = /<pdfaExtension:schemas>\s*<rdf:Bag>/.exec(xmp);
  if (bagMatch) {
    const at = bagMatch.index + bagMatch[0].length;
    xmp = xmp.slice(0, at) + FX_SCHEMA_ITEM + xmp.slice(at);
  } else {
    additions += EXTENSION_DESCRIPTION;
  }

  const end = xmp.lastIndexOf("</rdf:RDF>");
  return xmp.slice(0, end) + additions.trimStart() + "\n  " + xmp.slice(end);
}
