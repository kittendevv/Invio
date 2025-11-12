import { Handlers, PageProps } from "$fresh/server.ts";
import { Layout } from "../../../components/Layout.tsx";
import { InvoiceEditor } from "../../../components/InvoiceEditor.tsx";
import InvoiceFormButton from "../../../islands/InvoiceFormButton.tsx";
import {
  backendGet,
  backendPut,
  getAuthHeaderFromCookie,
} from "../../../utils/backend.ts";
import { useTranslations } from "../../../i18n/context.tsx";

type Item = {
  description: string;
  quantity?: number;
  unitPrice?: number;
  hours?: number;
  rate?: number;
  rateModifierId?: string;
  distance?: number;
  notes?: string;
  taxes?: Array<{ percent: number }>;
};
type Invoice = {
  id: string;
  invoiceNumber?: string;
  customer?: { name?: string };
  issue_date?: string;
  due_date?: string;
  items?: Item[];
  currency?: string;
  taxRate?: number;
  pricesIncludeTax?: boolean;
  roundingMode?: string;
  notes?: string;
  paymentTerms?: string;
  status?: "draft" | "sent" | "paid" | "overdue";
  taxes?: Array<{ percent: number; taxableAmount: number; taxAmount: number }>;
};
type Data = {
  authed: boolean;
  invoice?: Invoice;
  settings?: Record<string, string>;
  error?: string;
};

export const handler: Handlers<Data> = {
  async GET(req, ctx) {
    const auth = getAuthHeaderFromCookie(
      req.headers.get("cookie") || undefined,
    );
    if (!auth) {
      return new Response(null, {
        status: 303,
        headers: { Location: "/login" },
      });
    }
    const { id } = ctx.params as { id: string };
    try {
      const invoice = await backendGet(
        `/api/v1/invoices/${id}`,
        auth,
      ) as Invoice;
      // Disallow editing once invoice is issued or expired (overdue)
      if (invoice.status && invoice.status !== "draft") {
        return new Response(null, {
          status: 303,
          headers: { Location: `/invoices/${id}` },
        });
      }
      // Also fetch settings for numberFormat
      const settings = await backendGet("/api/v1/settings", auth) as Record<
        string,
        string
      >;
      return ctx.render({ authed: true, invoice, settings });
    } catch (e) {
      return ctx.render({ authed: true, error: String(e) });
    }
  },
  async POST(req, ctx) {
    const auth = getAuthHeaderFromCookie(
      req.headers.get("cookie") || undefined,
    );
    if (!auth) {
      return new Response(null, {
        status: 303,
        headers: { Location: "/login" },
      });
    }
    const { id } = ctx.params as { id: string };
    const form = await req.formData();
    const currency = String(form.get("currency") || "USD");
    const issueDate = String(form.get("issueDate") || "");
    const dueDate = String(form.get("dueDate") || "");
    const notes = String(form.get("notes") || "");
    const paymentTerms = String(form.get("paymentTerms") || "");
    const status = String(form.get("status") || "draft") as
      | "draft"
      | "sent"
      | "paid"
      | "overdue";
    const taxRate = Number(form.get("taxRate") || 0) || 0;
    const pricesIncludeTax =
      String(form.get("pricesIncludeTax") || "false") === "true";
    const roundingMode = String(form.get("roundingMode") || "line");
    const taxMode = String(form.get("taxMode") || "invoice") as
      | "invoice"
      | "line";

    const items: Item[] = [];
    let i = 0;
    while (form.has(`item_${i}_description`)) {
      const description = form.get(`item_${i}_description`) as string;
      if (!description || description.trim() === "") {
        i++;
        continue;
      }
      const quantity = parseFloat(
        (form.get(`item_${i}_quantity`) as string) || "1",
      );
      const unitPrice = parseFloat(
        (form.get(`item_${i}_unitPrice`) as string) || "0",
      );
      const itemNotes = form.get(`item_${i}_notes`) as string | undefined;
      const taxPercent = parseFloat(
        (form.get(`item_${i}_tax_percent`) as string) || "0",
      );

      const item: Item = {
        description,
        quantity,
        unitPrice,
        notes: itemNotes,
      };

      if (taxMode === "line" && taxPercent > 0) {
        item.taxes = [{ percent: taxPercent }];
      }

      items.push(item);
      i++;
    }

    if (items.length === 0) {
      return new Response("At least one item required", { status: 400 });
    }

    try {
      // Send notes as-is, including empty string, so existing notes get cleared when user deletes them
      const invoiceNumber = String(form.get("invoiceNumber") || "").trim();
      // Adjust items based on tax mode
      if (taxMode === "invoice") {
        items.forEach((it) => {
          delete (it as Record<string, unknown>).taxes;
        });
      }
      await backendPut(`/api/v1/invoices/${id}`, auth, {
        currency,
        status,
        notes,
        paymentTerms,
        taxRate: taxMode === "invoice" ? taxRate : 0,
        pricesIncludeTax,
        roundingMode,
        invoiceNumber: invoiceNumber || undefined,
        issueDate: issueDate || undefined,
        dueDate: dueDate || null,
        items,
        taxMode, // informational only for now
      });
      return new Response(null, {
        status: 303,
        headers: { Location: `/invoices/${id}` },
      });
    } catch (e) {
      const msg = String(e);
      if (/409|already exists|duplicate/i.test(msg)) {
        const invoice = await backendGet(
          `/api/v1/invoices/${id}`,
          auth,
        ) as Invoice;
        return ctx.render({
          authed: true,
          invoice,
          error: "Invoice number already exists",
        });
      }
      return new Response(String(e), { status: 500 });
    }
  },
};

export default function EditInvoicePage(props: PageProps<Data>) {
  const { t } = useTranslations();
  const demoMode =
    ((props.data as unknown) as { settings?: Record<string, unknown> }).settings
      ?.demoMode === "true";
  const inv = props.data.invoice;
  const settings = props.data.settings || {};
  const numberFormat = settings.numberFormat || "comma";
  const duplicateNumber = props.data.error &&
    /invoice number already exists/i.test(props.data.error);
  const errorMessage = duplicateNumber
    ? t("Invoice number already exists")
    : props.data.error;
  return (
    <Layout
      authed={props.data.authed}
      demoMode={demoMode}
      path={new URL(props.url).pathname}
      wide
    >
      {errorMessage && (
        <div class="alert alert-error mb-3">
          <span>{errorMessage}</span>
        </div>
      )}
      {inv && (
        <div class="space-y-4">
          <div class="flex items-center justify-between gap-2">
            <h1 class="text-2xl font-semibold">{t("Edit Invoice")}</h1>
            <InvoiceFormButton
              formId="invoice-form"
              label={t("Save")}
            />
          </div>

          <InvoiceEditor
            mode="edit"
            customerName={inv.customer?.name}
            currency={inv.currency}
            status={inv.status}
            invoiceNumber={inv.invoiceNumber}
            taxRate={inv.taxRate as number}
            pricesIncludeTax={inv.pricesIncludeTax as boolean}
            roundingMode={inv.roundingMode as string}
            taxMode={(inv.items &&
                inv.items.some((i) => i.taxes && i.taxes.length))
              ? "line"
              : "invoice"}
            showDates
            issueDate={(inv.issue_date as string) || ""}
            dueDate={(inv.due_date as string) || ""}
            notes={inv.notes}
            paymentTerms={inv.paymentTerms}
            items={(inv.items ||
              [{ description: "", quantity: 1, unitPrice: 0 }]).map((it) => {
                // If item has single tax entry, surface its percent for UI
                const single = it.taxes && it.taxes.length === 1
                  ? it.taxes[0].percent
                  : undefined;
                return { ...it, taxPercent: single } as Item & {
                  taxPercent?: number;
                };
              })}
            demoMode={demoMode}
            invoiceNumberError={duplicateNumber
              ? t("Invoice number already exists")
              : undefined}
            numberFormat={numberFormat}
            hideTopButton
            formId="invoice-form"
          />
        </div>
      )}
    </Layout>
  );
}
