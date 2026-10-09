<script lang="ts">
  import { ShieldOff } from "lucide-svelte";
  import { getContext } from "svelte";
  import { formatDate } from "$lib/utils/date";
  import { invoiceStatusLabel } from "$lib/i18n/mod";

  let { data } = $props();

  let t = getContext("i18n") as (key: string) => string;
  let numberFormat = $derived(data.localization?.numberFormat || "comma");
  let dateFormat = $derived(data.localization?.dateFormat || "YYYY-MM-DD");
  let statusCounts = $derived((data.status || {}) as Record<string, number>);
  let user = $derived(data.user);
  let canViewInvoices = $derived(user?.isAdmin || user?.permissions?.some((p) => p.resource === "invoices" && p.action === "read"));
  let canViewCustomers = $derived(user?.isAdmin || user?.permissions?.some((p) => p.resource === "customers" && p.action === "read"));

  function fmtMoney(n: number) {
    const cur = data.money?.currency || "USD";
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
</script>

<div class="mb-4">
  <h1 class="text-2xl font-semibold">{t("Dashboard")}</h1>
</div>

{#if data.error}
  <div class="alert alert-error mb-4">
    <span>{data.error}</span>
  </div>
{/if}

{#if !canViewInvoices}
  <div class="card bg-base-100 border-base-300 rounded-box mb-4 border">
    <div class="card-body flex flex-row items-center gap-4 p-6">
      <ShieldOff size={24} class="shrink-0 opacity-50" />
      <div>
        <div class="font-semibold">{t("Invoice data hidden")}</div>
        <div class="text-sm opacity-70">
          {t("You do not have permission to view invoices. Contact an administrator to request access.")}
        </div>
      </div>
    </div>
  </div>
{/if}

{#if !canViewCustomers}
  <div class="card bg-base-100 border-base-300 rounded-box mb-4 border">
    <div class="card-body flex flex-row items-center gap-4 p-6">
      <ShieldOff size={24} class="shrink-0 opacity-50" />
      <div>
        <div class="font-semibold">{t("Customer data hidden")}</div>
        <div class="text-sm opacity-70">
          {t("You do not have permission to view customers. Contact an administrator to request access.")}
        </div>
      </div>
    </div>
  </div>
{/if}

{#if data.counts}
  <div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Invoices")}</div>
        <div class="text-2xl font-extrabold sm:text-3xl">
          {data.counts.invoices}
        </div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Customers")}</div>
        <div class="text-2xl font-extrabold sm:text-3xl">
          {data.counts.customers}
        </div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Open Invoices")}</div>
        <div class="text-2xl font-extrabold sm:text-3xl">
          {(statusCounts.sent || 0) + (statusCounts.overdue || 0)}
        </div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Version")}</div>
        <div class="text-2xl font-extrabold sm:text-3xl">{data.version}</div>
      </div>
    </div>
  </div>
{/if}

{#if data.money}
  <div class="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Total Billed")}</div>
        <div class="text-xl font-bold sm:text-2xl">
          {fmtMoney(data.money.billed)}
        </div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Outstanding")}</div>
        <div class="text-xl font-bold sm:text-2xl">
          {fmtMoney(data.money.outstanding)}
        </div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Paid")}</div>
        <div class="text-xl font-bold sm:text-2xl">
          {fmtMoney(data.money.paid)}
        </div>
      </div>
    </div>
  </div>
{/if}

{#if data.status}
  <div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-6">
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Draft")}</div>
        <div class="text-lg font-semibold sm:text-xl">
          {statusCounts.draft || 0}
        </div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Sent")}</div>
        <div class="text-lg font-semibold sm:text-xl">
          {statusCounts.sent || 0}
        </div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Complete")}</div>
        <div class="text-lg font-semibold sm:text-xl">
          {statusCounts.complete || 0}
        </div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Paid")}</div>
        <div class="text-lg font-semibold sm:text-xl">
          {statusCounts.paid || 0}
        </div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Overdue")}</div>
        <div class={`text-lg font-semibold sm:text-xl ${statusCounts.overdue > 0 ? "text-error" : ""}`}>
          {statusCounts.overdue || 0}
        </div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Voided")}</div>
        <div class="text-lg font-semibold sm:text-xl">
          {statusCounts.voided || 0}
        </div>
      </div>
    </div>
  </div>
{/if}

{#if data.recent && data.recent.length > 0}
  <h2 class="mb-3 text-xl font-semibold">{t("Recent Invoices")}</h2>
  <div class="bg-base-100 border-base-300 rounded-box overflow-x-auto border">
    <table class="table-sm sm:table-md table w-full">
      <thead>
        <tr class="bg-base-200">
          <th>{t("Invoice No")}</th>
          <th>{t("Customer")}</th>
          <th>{t("Total")}</th>
          <th class="hidden sm:table-cell">{t("Status")}</th>
          <th class="text-right">{t("Issue Date")}</th>
        </tr>
      </thead>
      <tbody>
        {#each data.recent as inv (inv.id)}
          <tr class="hover">
            <td class="font-medium hover:underline">
              <a href={`/invoices/${inv.id}`}>{inv.invoiceNumber}</a>
              <div class="text-xs opacity-70 sm:hidden">
                {t(invoiceStatusLabel(inv.status))}
              </div>
            </td>
            <td>{inv.customer?.name || ""}</td>
            <td>{fmtMoney(inv.total || 0)}</td>
            <td class="hidden sm:table-cell">
              {#if inv.status === "draft"}
                <div class="badge badge-ghost badge-sm">{t("Draft")}</div>
              {:else if inv.status === "sent"}
                <div class="badge badge-info badge-sm">{t("Sent")}</div>
              {:else if inv.status === "paid"}
                <div class="badge badge-success badge-sm">{t("Paid")}</div>
              {:else if (inv.status as string | undefined) === "complete"}
                <div class="badge badge-secondary badge-sm">
                  {t("Complete")}
                </div>
              {:else if inv.status === "overdue"}
                <div class="badge badge-error badge-sm">{t("Overdue")}</div>
              {:else if inv.status === "voided"}
                <div class="badge badge-neutral badge-sm">{t("Voided")}</div>
              {/if}
            </td>
            <td class="text-right text-sm tabular-nums">
              {#if inv.issueDate}
                {formatDate(inv.issueDate, dateFormat)}
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
