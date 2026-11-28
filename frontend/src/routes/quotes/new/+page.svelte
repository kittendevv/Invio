<script lang="ts">
  import InvoiceEditor from "$lib/components/InvoiceEditor.svelte";
  import { Save } from "lucide-svelte";
  import { getContext } from "svelte";

  let { data } = $props();
  let t = getContext("i18n") as (key: string) => string;
  const formId = "quote-new-form";
</script>

<div class="mb-6 flex items-center justify-between gap-3">
  <h1 class="text-2xl font-bold">{t("Create Quote")}</h1>
  <button type="submit" form={formId} class="btn btn-primary">
    <Save size={16} />
    <span>{t("Save")}</span>
  </button>
</div>

<InvoiceEditor {data} invoice={null} {formId} documentType="quote" />
