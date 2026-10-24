<script lang="ts">
  import { ShieldOff, SquarePen } from "lucide-svelte";
  import { getContext } from "svelte";
  import { formatDate } from "$lib/utils/date";

  let { data } = $props();

  let t = getContext("i18n") as (key: string) => string;
  let numberFormat = $derived(data.localization?.numberFormat || "comma");
  let dateFormat = $derived(data.localization?.dateFormat || "YYYY-MM-DD");
  let user = $derived(data.user);
  let canCreate = $derived(user?.isAdmin || user?.permissions?.some((p) => p.resource === "invoices" && p.action === "create"));
  let canViewCustomers = $derived(user?.isAdmin || user?.permissions?.some((p) => p.resource === "customers" && p.action === "read"));

  function fmtMoney(cur: string | undefined, n: number) {
    if (!cur) cur = "USD";
    try {
      const locale = numberFormat === "period" ? "de-DE" : "en-US";
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: cur,
      }).format(n || 0);
    } catch {
      return `${cur} ${Number(n || 0).toFixed(2)}`;
    }
  }

  let invoices = $derived(data.invoices || []);
  let filterStatus = $state("all");
  let sortKey = $state<"invoiceNumber" | "customer" | "total" | "status" | "issueDate" | "updatedAt">("invoiceNumber");
  let sortDirection = $state<"asc" | "desc">("desc");

  function toDateMs(v: unknown) {
    return new Date((v as string) || 0).getTime();
  }

  function compareText(a: unknown, b: unknown) {
    return String(a || "").localeCompare(String(b || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }

  function handleSort(key: "invoiceNumber" | "customer" | "total" | "status" | "issueDate" | "updatedAt") {
    if (sortKey === key) {
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
      return;
    }
    sortKey = key;
    sortDirection = key === "invoiceNumber" ? "desc" : "asc";
  }

  function sortMarker(key: "invoiceNumber" | "customer" | "total" | "status" | "issueDate" | "updatedAt") {
    if (sortKey !== key) return "";
    return sortDirection === "asc" ? " ▲" : " ▼";
  }

  let filtered = $derived(
    invoices.filter((i) => {
      if (filterStatus === "all") return true;
      return i.status === filterStatus;
    }),
  );

  let sortedFiltered = $derived(
    [...filtered].sort((a, b) => {
      let result = 0;
      if (sortKey === "invoiceNumber") {
        result = compareText(a.invoiceNumber, b.invoiceNumber);
      } else if (sortKey === "customer") {
        result = compareText(a.customer?.name, b.customer?.name);
      } else if (sortKey === "total") {
        result = Number(a.total || 0) - Number(b.total || 0);
      } else if (sortKey === "status") {
        result = compareText(a.status, b.status);
      } else if (sortKey === "issueDate") {
        result = toDateMs(a.issueDate) - toDateMs(b.issueDate);
      } else if (sortKey === "updatedAt") {
        result = toDateMs(a.updatedAt) - toDateMs(b.updatedAt);
      }

      if (result === 0) {
        result = compareText(a.invoiceNumber, b.invoiceNumber);
      }

      return sortDirection === "asc" ? result : -result;
    }),
  );

  // Show "Paid with" only when at least one visible (filtered) invoice has a payment method.
  // This hides the column automatically when filtering to statuses that can never carry one
  // (e.g. Draft, Sent, Voided) — the column would otherwise appear with all cells empty.
  let showPaidWith = $derived(sortedFiltered.some((i: any) => i.paidWith));
</script>

<div class="mb-4 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
  <h1 class="text-2xl font-semibold">{t("Invoices")}</h1>
  {#if canCreate}
    <a href="/invoices/new" class="btn btn-primary btn-sm w-full sm:w-auto">
      <SquarePen size={16} />
      {t("Create Invoice")}
    </a>
  {/if}
</div>

{#if data.error}
  <div class="alert alert-error mb-4">
    <span>{data.error}</span>
  </div>
{/if}

<div class="bg-base-100 border-base-300 rounded-box mb-4 overflow-x-auto border p-4">
  <div class="flex gap-2">
    <button class={`btn btn-sm ${filterStatus === "all" ? "btn-neutral" : "btn-ghost"}`} onclick={() => (filterStatus = "all")}>{t("All")}</button>
    <button class={`btn btn-sm ${filterStatus === "sent" ? "btn-neutral" : "btn-ghost"}`} onclick={() => (filterStatus = "sent")}>{t("Sent")}</button>
    <button class={`btn btn-sm ${filterStatus === "draft" ? "btn-neutral" : "btn-ghost"}`} onclick={() => (filterStatus = "draft")}>{t("Draft")}</button>
    <button class={`btn btn-sm ${filterStatus === "complete" ? "btn-neutral" : "btn-ghost"}`} onclick={() => (filterStatus = "complete")}>{t("Complete")}</button>
    <button class={`btn btn-sm ${filterStatus === "paid" ? "btn-neutral" : "btn-ghost"}`} onclick={() => (filterStatus = "paid")}>{t("Paid")}</button>
    <button class={`btn btn-sm ${filterStatus === "voided" ? "btn-neutral" : "btn-ghost"}`} onclick={() => (filterStatus = "voided")}>{t("Voided")}</button>
  </div>
</div>

{#if invoices.length === 0}
  <div class="bg-base-100 border-base-300 rounded-box border py-12 text-center">
    <div class="mb-4 text-lg opacity-50">{t("No invoices found")}</div>
    {#if canCreate}
      <a href="/invoices/new" class="btn btn-primary">{t("Create your first invoice")}</a>
    {/if}
  </div>
{:else}
  <div class="bg-base-100 border-base-300 rounded-box overflow-x-auto border">
    <table class="table-sm sm:table-md table w-full whitespace-nowrap">
      <thead class="bg-base-200">
        <tr>
          <th>
            <button type="button" class="btn btn-ghost btn-xs px-1 normal-case" onclick={() => handleSort("invoiceNumber")}>
              {t("Invoice No")}{sortMarker("invoiceNumber")}
            </button>
          </th>
          {#if canViewCustomers}
            <th>
              <button type="button" class="btn btn-ghost btn-xs px-1 normal-case" onclick={() => handleSort("customer")}>
                {t("Customer")}{sortMarker("customer")}
              </button>
            </th>
          {/if}
          <th>
            <button type="button" class="btn btn-ghost btn-xs px-1 normal-case" onclick={() => handleSort("total")}>
              {t("Total")}{sortMarker("total")}
            </button>
          </th>
          <th>
            <button type="button" class="btn btn-ghost btn-xs px-1 normal-case" onclick={() => handleSort("status")}>
              {t("Status")}{sortMarker("status")}
            </button>
          </th>
          <th class="hidden sm:table-cell">
            <button type="button" class="btn btn-ghost btn-xs px-1 normal-case" onclick={() => handleSort("issueDate")}>
              {t("Issue Date")}{sortMarker("issueDate")}
            </button>
          </th>
          {#if showPaidWith}
            <th class="hidden sm:table-cell">
              {t("Paid with")}
            </th>
          {/if}
          <th class="hidden text-right md:table-cell">
            <button type="button" class="btn btn-ghost btn-xs px-1 normal-case" onclick={() => handleSort("updatedAt")}>
              {t("Updated")}{sortMarker("updatedAt")}
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        {#each sortedFiltered as inv (inv.id)}
          <tr class="hover">
            <td class="font-medium hover:underline">
              <a href={`/invoices/${inv.id}`}>{inv.invoiceNumber}</a>
              <div class="text-xs opacity-70 sm:hidden">
                {#if inv.issueDate}
                  {formatDate(inv.issueDate, dateFormat)}
                {/if}
              </div>
            </td>
            {#if canViewCustomers}
              <td class="max-w-[12rem] truncate sm:max-w-xs" title={inv.customer?.name}>
                {inv.customer?.name || "-"}
              </td>
            {/if}
            <td class="font-medium">{fmtMoney(inv.currency, inv.total)}</td>
            <td>
              {#if inv.status === "draft"}
                <div class="badge badge-ghost badge-sm">{t("Draft")}</div>
              {:else if inv.status === "sent"}
                <div class="badge badge-info badge-sm">{t("Sent")}</div>
              {:else if inv.status === "paid"}
                <div class="badge badge-success badge-sm">{t("Paid")}</div>
              {:else if inv.status === "complete"}
                <div class="badge badge-secondary badge-sm">
                  {t("Complete")}
                </div>
              {:else if inv.status === "overdue"}
                <div class="badge badge-error badge-sm">{t("Overdue")}</div>
              {:else if inv.status === "voided"}
                <div class="badge badge-neutral badge-sm">{t("Voided")}</div>
              {/if}
            </td>
            <td class="hidden text-sm tabular-nums sm:table-cell">
              {#if inv.issueDate}
                {formatDate(inv.issueDate, dateFormat)}
              {/if}
            </td>
            {#if showPaidWith}
              <td class="hidden text-sm sm:table-cell">
                {(inv as any).paidWith || ""}
              </td>
            {/if}
            <td class="hidden text-right text-sm tabular-nums opacity-70 md:table-cell">
              {#if inv.updatedAt}
                {formatDate(inv.updatedAt, dateFormat, false)}
              {/if}
            </td>
          </tr>
        {/each}
        {#if sortedFiltered.length === 0}
          <tr>
            <td colspan="99" class="py-8 text-center opacity-50">{t("No invoices match this filter")}</td>
          </tr>
        {/if}
      </tbody>
    </table>
  </div>
{/if}
