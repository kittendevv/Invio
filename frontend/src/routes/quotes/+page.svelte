<script lang="ts">
  import { SquarePen } from "lucide-svelte";
  import { getContext } from "svelte";
  import { formatDate } from "$lib/utils/date";
  import { invoiceStatusLabel } from "$lib/i18n/mod";
  import { quoteStatusBadge } from "$lib/utils/documentType";
  import { hasPermission } from "$lib/types";

  let { data } = $props();

  let t = getContext("i18n") as (key: string) => string;
  let numberFormat = $derived(data.localization?.numberFormat || "comma");
  let dateFormat = $derived(data.localization?.dateFormat || "YYYY-MM-DD");
  let canCreate = $derived(hasPermission(data.user, "quotes", "create"));
  let canViewCustomers = $derived(hasPermission(data.user, "customers", "read"));

  function fmtMoney(cur: string | undefined, n: number) {
    try {
      return new Intl.NumberFormat(numberFormat === "period" ? "de-DE" : "en-US", {
        style: "currency",
        currency: cur || "USD",
      }).format(n || 0);
    } catch {
      return `${cur || "USD"} ${Number(n || 0).toFixed(2)}`;
    }
  }

  const FILTERS = ["all", "draft", "sent", "accepted", "declined", "expired"] as const;
  let quotes = $derived(data.quotes || []);
  let filterStatus = $state<(typeof FILTERS)[number]>("all");
  let filtered = $derived(filterStatus === "all" ? quotes : quotes.filter((q) => q.status === filterStatus));
</script>

<div class="mb-4 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
  <h1 class="text-2xl font-semibold">{t("Quotes")}</h1>
  {#if canCreate}
    <a href="/quotes/new" class="btn btn-primary btn-sm w-full sm:w-auto">
      <SquarePen size={16} />
      {t("Create Quote")}
    </a>
  {/if}
</div>

{#if data.error}
  <div class="alert alert-error mb-4"><span>{data.error}</span></div>
{/if}

<div class="bg-base-100 border-base-300 rounded-box mb-4 overflow-x-auto border p-4">
  <div class="flex gap-2">
    {#each FILTERS as f (f)}
      <button class={`btn btn-sm ${filterStatus === f ? "btn-neutral" : "btn-ghost"}`} onclick={() => (filterStatus = f)}>
        {f === "all" ? t("All") : t(invoiceStatusLabel(f))}
      </button>
    {/each}
  </div>
</div>

{#if quotes.length === 0}
  <div class="bg-base-100 border-base-300 rounded-box border py-12 text-center">
    <div class="mb-4 text-lg opacity-50">{t("No quotes found")}</div>
    {#if canCreate}
      <a href="/quotes/new" class="btn btn-primary">{t("Create your first quote")}</a>
    {/if}
  </div>
{:else}
  <div class="bg-base-100 border-base-300 rounded-box overflow-x-auto border">
    <table class="table-sm sm:table-md table w-full whitespace-nowrap">
      <thead class="bg-base-200">
        <tr>
          <th>{t("Quote No")}</th>
          {#if canViewCustomers}<th>{t("Customer")}</th>{/if}
          <th>{t("Total")}</th>
          <th>{t("Status")}</th>
          <th class="hidden sm:table-cell">{t("Issue Date")}</th>
          <th class="hidden sm:table-cell">{t("Valid until")}</th>
        </tr>
      </thead>
      <tbody>
        {#each filtered as q (q.id)}
          <tr class="hover">
            <td class="font-medium hover:underline"><a href={`/quotes/${q.id}`}>{q.invoiceNumber}</a></td>
            {#if canViewCustomers}
              <td class="max-w-[12rem] truncate sm:max-w-xs" title={q.customer?.name}>{q.customer?.name || "-"}</td>
            {/if}
            <td class="font-medium">{fmtMoney(q.currency, q.total)}</td>
            <td><div class="badge badge-sm {quoteStatusBadge(q.status)}">{t(invoiceStatusLabel(q.status))}</div></td>
            <td class="hidden text-sm tabular-nums sm:table-cell">{q.issueDate ? formatDate(q.issueDate, dateFormat) : ""}</td>
            <td class="hidden text-sm tabular-nums sm:table-cell">{q.dueDate ? formatDate(q.dueDate, dateFormat) : ""}</td>
          </tr>
        {/each}
        {#if filtered.length === 0}
          <tr><td colspan="99" class="py-8 text-center opacity-50">{t("No quotes match this filter")}</td></tr>
        {/if}
      </tbody>
    </table>
  </div>
{/if}
