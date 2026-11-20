<script lang="ts">
  import InvoiceEditor from "$lib/components/InvoiceEditor.svelte";
  import { Save } from "lucide-svelte";
  import { getContext } from "svelte";

  let { data } = $props();
  let t = getContext("i18n") as (key: string) => string;
  const formId = "quote-edit-form";
</script>

<div class="mb-6 flex items-center justify-between gap-3">
  <h1 class="text-2xl font-bold">
    {t("Edit Quote")} #{data.invoice?.invoiceNumber || data.invoice?.id}
  </h1>
  <button type="submit" form={formId} class="btn btn-primary">
    <Save size={16} />
    <span>{t("Save")}</span>
  </button>
</div>

{#if data.invoice}
  <InvoiceEditor {data} {formId} invoice={data.invoice} documentType="quote" />
{/if}
