<script lang="ts">
  import { getContext } from "svelte";
  import { enhance } from "$app/forms";
  import { page } from "$app/state";
  import type { SubmitFunction } from "@sveltejs/kit";
  import { ArrowLeft, Check, CheckCircle, Copy, Download, ExternalLink, FileCode2, Mail, MoreHorizontal, Pencil, ReceiptText, Trash2, Upload, X } from "lucide-svelte";
  import { hasPermission } from "$lib/types";
  import { invoiceStatusLabel } from "$lib/i18n/mod";
  import { formatDate } from "$lib/utils/date";
  import { quoteStatusBadge } from "$lib/utils/documentType";

  let { data, form } = $props();
  let t = getContext("i18n") as (key: string) => string;
  const getLoc = getContext("localization") as () => any;

  let quote = $derived(data.quote);
  let user = $derived(data.user);
  let canUpdate = $derived(hasPermission(user, "quotes", "update"));
  let canDelete = $derived(hasPermission(user, "quotes", "delete"));
  let canPublish = $derived(hasPermission(user, "quotes", "publish"));
  let canExport = $derived(hasPermission(user, "quotes", "export"));
  let canCreate = $derived(hasPermission(user, "quotes", "create"));
  let canCreateInvoice = $derived(hasPermission(user, "invoices", "create"));

  let status = $derived(quote?.status as string);
  // Accepted or declined quotes are final; everything before can be revised
  let canEdit = $derived(canUpdate && status !== "accepted" && status !== "declined");
  let isOpen = $derived(status === "sent" || status === "expired");
  let canInvoice = $derived(canCreateInvoice && (isOpen || status === "accepted"));

  let emailDialog: HTMLDialogElement;
  let emailSending = $state(false);
  let emailEnabled = $derived(Boolean(data.emailEnabled));

  $effect(() => {
    if ((form as any)?.emailSent) emailDialog?.close();
  });

  function fmtDate(d?: string | Date) {
    return formatDate(d, getLoc()?.dateFormat);
  }
  function fmtMoney(v?: number) {
    return `${Number(v || 0).toFixed(2)} ${quote?.currency || "EUR"}`;
  }
  function fmtDateTime(d: Date) {
    if (!d || Number.isNaN(d.getTime())) return "";
    return `${formatDate(d, getLoc()?.dateFormat, false)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function confirmAction(message: string): SubmitFunction {
    return ({ cancel }) => {
      if (!confirm(message)) cancel();
    };
  }
  function copyLink() {
    navigator.clipboard.writeText(`${page.url.origin}/public/invoices/${quote.shareToken}`);
    alert(t("Link copied!"));
  }
</script>

<dialog bind:this={emailDialog} class="modal">
  <div class="modal-box max-w-lg">
    <form method="dialog">
      <button class="btn btn-sm btn-circle btn-ghost absolute top-3 right-3">✕</button>
    </form>
    <h3 class="mb-4 text-lg font-semibold">{t("Send via Email")}</h3>
    {#if (form as any)?.emailError}
      <div class="alert alert-error mb-4 text-sm"><span>{(form as any).emailError}</span></div>
    {/if}
    <form
      method="post"
      use:enhance={() => {
        emailSending = true;
        return async ({ result, update }) => {
          await update({ reset: false });
          emailSending = false;
          if (result.type === "success") emailDialog?.close();
        };
      }}
    >
      <input type="hidden" name="intent" value="send-email" />
      <div class="form-control mb-3">
        <label class="label pb-1" for="emailTo"><span class="label-text font-medium">{t("To")}</span></label>
        <input id="emailTo" type="text" name="emailTo" class="input input-bordered w-full" value={quote?.customer?.email ?? ""} disabled={emailSending} required />
      </div>
      <div class="form-control mb-3">
        <label class="label pb-1" for="emailSubject"><span class="label-text font-medium">{t("Subject")}</span></label>
        <input id="emailSubject" type="text" name="emailSubject" class="input input-bordered w-full" value={`Quote #${quote?.invoiceNumber || ""}`} disabled={emailSending} required />
      </div>
      <div class="form-control mb-4">
        <label class="label pb-1" for="emailMessage"><span class="label-text font-medium">{t("Message")}</span></label>
        <textarea id="emailMessage" name="emailMessage" class="textarea textarea-bordered w-full" rows="4" placeholder={t("Add a personal note...")} disabled={emailSending}></textarea>
      </div>
      <div class="modal-action mt-0">
        <button type="button" class="btn btn-ghost" disabled={emailSending} onclick={() => emailDialog?.close()}>{t("Cancel")}</button>
        <button type="submit" class="btn btn-primary" disabled={emailSending}>
          {#if emailSending}<span class="loading loading-spinner loading-sm"></span>{:else}<Mail size={16} />{/if}
          {t("Send")}
        </button>
      </div>
    </form>
  </div>
  <form method="dialog" class="modal-backdrop"><button>close</button></form>
</dialog>

<div class="mb-6">
  {#if form?.error}
    <div class="alert alert-error mb-4 text-sm shadow"><div class="font-medium">{form.error}</div></div>
  {/if}
  {#if (form as any)?.emailSent}
    <div class="alert alert-success mb-4 text-sm shadow">
      <CheckCircle size={18} />
      <div>{t("Sent to")} {(form as any).emailRecipients?.join(", ")}</div>
    </div>
  {/if}
  {#if data.showPublishedBanner && quote?.shareToken}
    <div class="alert alert-success mb-4 text-sm shadow">
      <CheckCircle size={20} />
      <div class="flex-1 overflow-hidden">
        <div class="font-medium">{t("Quote sent")}</div>
        <div class="truncate text-sm break-all opacity-80">
          {t("Public link")}:
          <a class="link" href="/public/invoices/{quote.shareToken}" target="_blank">{page.url.origin}/public/invoices/{quote.shareToken}</a>
        </div>
      </div>
      <button type="button" class="btn btn-xs sm:btn-sm" onclick={copyLink}>{t("Copy link")}</button>
    </div>
  {/if}

  <div class="border-base-200 flex flex-col justify-between gap-4 border-b pb-4 sm:flex-row sm:items-center">
    <div class="flex items-center gap-3">
      <a href="/quotes" class="btn btn-ghost btn-circle btn-sm"><ArrowLeft size={20} /></a>
      <h1 class="text-2xl font-semibold">{t("Quote #")} {quote?.invoiceNumber}</h1>
      <span class="badge {quoteStatusBadge(status)}">{t(invoiceStatusLabel(status))}</span>
    </div>

    <form id="q-duplicate" method="post" class="hidden" use:enhance><input type="hidden" name="intent" value="duplicate" /></form>
    <form id="q-decline" method="post" class="hidden" use:enhance={confirmAction(t("Mark this quote as declined?"))}><input type="hidden" name="intent" value="decline" /></form>
    <form id="q-delete" method="post" class="hidden" use:enhance={confirmAction(t("Delete this quote? This cannot be undone."))}><input type="hidden" name="intent" value="delete" /></form>

    {#if quote}
      <div class="flex flex-wrap items-center gap-2">
        {#if canEdit}
          <a href="/quotes/{quote.id}/edit" class="btn btn-sm"><Pencil size={16} /><span class="hidden sm:inline">{t("Edit")}</span></a>
        {/if}
        {#if status === "draft" && canPublish}
          <form method="post" use:enhance>
            <input type="hidden" name="intent" value="publish" />
            <button type="submit" class="btn btn-sm btn-success" title={t("Make public and mark as sent")}><Upload size={16} /><span class="hidden sm:inline">{t("Mark as Sent")}</span></button>
          </form>
        {/if}
        {#if isOpen && canUpdate}
          <form method="post" use:enhance>
            <input type="hidden" name="intent" value="accept" />
            <button type="submit" class="btn btn-sm btn-success"><Check size={16} /><span class="hidden sm:inline">{t("Mark as Accepted")}</span></button>
          </form>
        {/if}
        {#if canInvoice}
          <form method="post" use:enhance>
            <input type="hidden" name="intent" value="invoice" />
            <button type="submit" class="btn btn-sm btn-primary" title={t("Create a draft invoice with the lines of this quote")}><ReceiptText size={16} /><span class="hidden sm:inline">{t("Create invoice")}</span></button>
          </form>
        {/if}
        {#if emailEnabled && canExport && status !== "draft"}
          <button type="button" class="btn btn-sm" onclick={() => emailDialog?.showModal()}><Mail size={16} /><span class="hidden sm:inline">{t("Send via Email")}</span></button>
        {/if}
        <div class="dropdown dropdown-end">
          <div tabindex="0" role="button" class="btn btn-ghost btn-sm"><MoreHorizontal size={16} /><span class="hidden sm:inline">{t("More")}</span></div>
          <ul tabindex="-1" class="menu menu-sm dropdown-content bg-base-100 rounded-box border-base-200 z-1 mt-2 w-56 border p-2 shadow">
            {#if canCreate}
              <li><button type="submit" form="q-duplicate" class="flex items-center gap-2 py-2"><Copy size={16} />{t("Duplicate")}</button></li>
            {/if}
            {#if isOpen && canUpdate}
              <li><button type="submit" form="q-decline" class="text-warning flex items-center gap-2 py-2"><X size={16} />{t("Mark as Declined")}</button></li>
            {/if}
            {#if canDelete}
              <li><button type="submit" form="q-delete" class="text-error flex items-center gap-2 py-2"><Trash2 size={16} />{t("Delete")}</button></li>
            {/if}
          </ul>
        </div>
      </div>
    {/if}
  </div>
</div>

{#if quote}
  <div class="mt-6 mb-8 grid grid-cols-1 gap-x-8 gap-y-4 text-sm md:grid-cols-2">
    <div class="space-y-4">
      {#if quote.invoices?.length}
        <div>
          <span class="mr-1 opacity-70">{t("Invoices")}:</span>
          {#each quote.invoices as inv, i (inv.id)}
            {#if i > 0},{/if}
            <a class="link font-medium" href="/invoices/{inv.id}">{inv.invoiceNumber.startsWith("DRAFT-") ? t("Draft") : inv.invoiceNumber}</a>
          {/each}
        </div>
      {/if}
      <div><span class="mr-1 opacity-70">{t("Customer")}:</span> {quote.customer?.name || t("Unknown Customer")}</div>
      <div><span class="mr-1 opacity-70">{t("Issue Date")}:</span> {fmtDate(quote.issueDate) || "-"}</div>
      <div><span class="mr-1 opacity-70">{t("Valid until")}:</span> {fmtDate(quote.dueDate) || "-"}</div>
      <div class="mt-4"><span class="mr-1 opacity-70">{t("Subtotal")}:</span> {fmtMoney(quote.subtotal)}</div>
      <div><span class="mr-1 opacity-70">{t("Tax")}:</span> {fmtMoney(quote.taxAmount)}</div>
      <div><span class="mr-1 opacity-70">{t("Total")}:</span><span class="font-bold">{fmtMoney(quote.total)}</span></div>

      <div class="flex flex-wrap gap-2 pt-4">
        <a class="btn btn-sm btn-outline" href="/api/v1/invoices/{quote.id}/html" target="_blank"><FileCode2 size={16} />{t("View HTML")}</a>
        <a class="btn btn-sm btn-primary" href="/api/v1/invoices/{quote.id}/pdf" target="_blank"><Download size={16} />{t("Download PDF")}</a>
        {#if status !== "draft" && quote.shareToken}
          <a class="btn btn-sm btn-outline" href="/public/invoices/{quote.shareToken}" target="_blank"><ExternalLink size={16} />{t("View public link")}</a>
        {/if}
      </div>
    </div>
    <div class="space-y-4">
      <div><span class="mr-1 opacity-70">{t("Email")}:</span> {quote.customer?.email || ""}</div>
      <div><span class="mr-1 opacity-70">{t("Payment Terms")}:</span> {quote.paymentTerms || "-"}</div>
      {#if quote.notes}
        <div class="whitespace-pre-line"><span class="mr-1 opacity-70">{t("Notes")}:</span> {quote.notes}</div>
      {/if}
    </div>
  </div>

  {#if quote.items?.length}
    <div class="bg-base-100 rounded-box border-base-200 mt-8 overflow-hidden border shadow-sm">
      <table class="table-sm sm:table-md table w-full">
        <thead class="bg-base-200/50">
          <tr>
            <th>{t("Description")}</th>
            <th class="text-right">{t("Qty")}</th>
            <th class="text-right">{t("Price")}</th>
            <th class="text-right">{t("Total")}</th>
          </tr>
        </thead>
        <tbody>
          {#each quote.items as item (item.id)}
            <tr>
              <td class="whitespace-pre-wrap">{item.description || t("Item")}</td>
              <td class="text-right">{item.quantity}</td>
              <td class="text-right">{fmtMoney(item.unitPrice)}</td>
              <td class="text-right font-medium">{fmtMoney(item.quantity * item.unitPrice)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if quote.statusHistory?.length}
    <div class="mt-8">
      <h2 class="mb-3 text-base font-semibold opacity-70">{t("Status History")}</h2>
      <ul class="border-base-300 space-y-4 border-l-2 pl-4">
        {#each quote.statusHistory as entry (entry.id)}
          <li class="relative">
            <span class="bg-base-300 border-base-100 absolute top-1 -left-[1.3rem] h-3 w-3 rounded-full border-2"></span>
            <span class="badge badge-sm {quoteStatusBadge(entry.status)}">{t(invoiceStatusLabel(entry.status))}</span>
            <span class="ml-2 text-sm opacity-60">{fmtDateTime(new Date(entry.changedAt))}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
{/if}
