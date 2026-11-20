<script lang="ts">
  import { getContext } from "svelte";
  import { Download, FileText, ChevronDown, ExternalLink } from "lucide-svelte";

  let { data } = $props();
  let t = getContext("i18n") as (key: string) => string;

  let token = $derived(data.token);
  let htmlUrl = $derived(`/api/v1/public/invoices/${token}/html`);
  let pdfUrl = $derived(`/api/v1/public/invoices/${token}/pdf`);
  let ublUrl = $derived(`/api/v1/public/invoices/${token}/ubl.xml`);
  let xmlUblUrl = $derived(`/api/v1/public/invoices/${token}/xml?profile=ubl21`);
  let xmlFxUrl = $derived(`/api/v1/public/invoices/${token}/xml?profile=facturx22`);
</script>

<div class="bg-base-200/40 relative flex min-h-screen flex-1 flex-col pb-10">
  <!-- Minimal Header -->
  <header class="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-6 px-4 py-8 sm:flex-row md:px-8">
    <div class="flex items-center gap-2">
      <span class="text-base-content/80 text-3xl font-light tracking-tight">{data.isCreditNote ? t("Credit note") : t("Invoice")}</span>
    </div>

    <div class="bg-base-100 border-base-200/60 flex flex-wrap items-center justify-center gap-2 rounded-full border p-2 shadow-sm sm:gap-3">
      <div class="dropdown dropdown-end">
        <div tabIndex="-1" role="button" class="btn btn-sm btn-ghost text-base-content/80 hover:bg-base-200/50 rounded-full px-4 font-normal">
          <FileText size={16} class="mr-1 opacity-70" />
          <span class="hidden sm:inline">{t("XML Data")}</span>
          <span class="sm:hidden">{t("XML")}</span>
          <ChevronDown size={14} class="ml-1 opacity-70" />
        </div>
        <ul tabIndex="-1" class="menu menu-sm dropdown-content bg-base-100 border-base-200 z-[1] mt-2 w-56 rounded-xl border p-2 shadow-lg">
          <li class="menu-title text-base-content/50 px-4 py-2 text-xs font-semibold tracking-wider uppercase">
            {t("Format")}
          </li>
          <li>
            <a href={ublUrl} class="rounded-lg py-2.5">{t("Standard UBL XML")}</a>
          </li>
          <li>
            <a href={xmlUblUrl} class="rounded-lg py-2.5">{t("UBL 2.1 (PEPPOL)")}</a>
          </li>
          <li>
            <a href={xmlFxUrl} class="rounded-lg py-2.5">{t("FacturX / ZUGFeRD 2.2")}</a>
          </li>
        </ul>
      </div>

      <div class="bg-base-200 h-6 w-px"></div>

      <a class="btn btn-sm btn-ghost btn-circle text-base-content/80 hover:bg-base-200/50 tooltip tooltip-bottom" href={htmlUrl} target="_blank" data-tip={t("Open in new tab")}>
        <ExternalLink size={16} />
      </a>

      <a class="btn btn-sm btn-primary ml-1 rounded-full px-6 font-medium shadow-sm" href={pdfUrl}>
        <Download size={16} class="mr-1" />
        {t("Download PDF")}
      </a>
    </div>
  </header>

  <!-- Document Container -->
  <main class="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 sm:px-6 md:px-8">
    <div class="bg-base-100 border-base-200 relative flex w-full flex-1 flex-col overflow-hidden rounded-2xl border shadow-sm" style="min-height: 75vh;">
      <iframe src={htmlUrl} title="Invoice Document" class="absolute inset-0 h-full w-full border-0 bg-white"></iframe>
    </div>
  </main>
</div>
