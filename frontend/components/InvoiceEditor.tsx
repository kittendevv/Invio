import type { InvoiceEditorProps } from "../islands/InvoiceEditorIsland.tsx";
import InvoiceEditorIsland from "../islands/InvoiceEditorIsland.tsx";

export type { InvoiceEditorProps } from "../islands/InvoiceEditorIsland.tsx";

export function InvoiceEditor(props: InvoiceEditorProps) {
  return <InvoiceEditorIsland {...props} />;
}
