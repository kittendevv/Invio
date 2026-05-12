<script lang="ts">
  import { getContext, onMount, untrack } from "svelte";
  import { Plus, GripVertical } from "lucide-svelte";
  import { goto } from "$app/navigation";

  let { data, invoice = null, formId = "invoice-editor-form" } = $props();
  let initInvoice = untrack(() => invoice);
  let initSettings = untrack(() => data?.settings || {});
  let initNextInvoiceNumber = untrack(() => data?.nextInvoiceNumber || "");
  let t = getContext("i18n") as (key: string) => string;
  let loc = getContext("localization") as any;

  let saving = $state(false);
  let error = $state("");

  function createItemId() {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }

    if (typeof globalThis.crypto?.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  let form = $state({
    customerId: initInvoice?.customerId || "",
    invoiceNumber: initInvoice?.invoiceNumber ?? initNextInvoiceNumber,
    currency: initInvoice?.currency || "EUR",
    status: initInvoice?.status || "draft",
    issueDate: initInvoice?.issueDate ? new Date(initInvoice.issueDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    dueDate: initInvoice?.dueDate ? new Date(initInvoice.dueDate).toISOString().slice(0, 10) : "",
    taxMode: initInvoice?.taxMode || "invoice",
    taxRate: initInvoice?.taxRate || 0,
    pricesIncludeTax: initInvoice?.pricesIncludeTax ? "true" : "false",
    roundingMode: initInvoice?.roundingMode || "line",
    paymentTerms: initInvoice?.paymentTerms ?? initSettings.paymentTerms ?? "",
    notes: initInvoice?.notes ?? initSettings.defaultNotes ?? "",
  });

  let items = $state(
    initInvoice?.items?.length
      ? initInvoice.items.map((i: any) => ({
          ...i,
          id: createItemId(),
          unit: i.unit || "",
          productId: i.productId || "",
        }))
      : [
          {
            id: createItemId(),
            productId: "",
            description: "",
            quantity: 1,
            unit: "",
            unitPrice: 0,
            taxPercent: 0,
            notes: "",
          },
        ],
  );

  let customers = $derived(data.customers || []);
  let products = $derived(data.products || []);
  let taxDefinitions = $derived(data.taxDefinitions || []);

  function addItem() {
    items.push({
      id: createItemId(),
      productId: "",
      description: "",
      quantity: 1,
      unit: "",
      unitPrice: 0,
      taxPercent: 0,
      notes: "",
    });
  }

  function applyProductSelection(item: any, productId: string) {
    item.productId = productId;
    if (!productId) return;

    const product = products.find((p: any) => p.id === productId);
    if (!product) return;

    item.description = product.name || item.description;
    item.unitPrice = Number(product.unitPrice ?? product.unit_price ?? item.unitPrice ?? 0);
    item.unit = String(product.unit ?? item.unit ?? "");

    if (form.taxMode === "line" && product.taxDefinitionId) {
      const taxDef = taxDefinitions.find((t: any) => t.id === product.taxDefinitionId);
      if (taxDef) {
        item.taxPercent = Number(taxDef.percent || 0);
      }
    }
  }

  function removeItem(index: number) {
    if (items.length > 1) items.splice(index, 1);
  }

  let draggedId = $state<string | null>(null);
  let dragHoverId = $state<string | null>(null);

  function handleDragStart(e: DragEvent, id: string) {
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    }
    // Defer setting the state to avoid firing dragend immediately
    setTimeout(() => {
      draggedId = id;
    }, 0);
  }

  function handleDragOver(e: DragEvent, id: string) {
    e.preventDefault();
    if (!draggedId || draggedId === id) return;
    dragHoverId = id;
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
  }

  function handleDragLeave(id: string) {
    if (dragHoverId === id) {
      dragHoverId = null;
    }
  }

  function handleDrop(e: DragEvent, targetId: string) {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) {
      draggedId = null;
      dragHoverId = null;
      return;
    }

    const fromIndex = items.findIndex((i: any) => i.id === draggedId);
    const toIndex = items.findIndex((i: any) => i.id === targetId);

    if (fromIndex !== -1 && toIndex !== -1) {
      const removed = items.splice(fromIndex, 1)[0];
      items.splice(toIndex, 0, removed);
    }

    draggedId = null;
    dragHoverId = null;
  }

  function handleDragEnd() {
    draggedId = null;
    dragHoverId = null;
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      handleSubmit(e as unknown as SubmitEvent);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      addItem();
    }
  }

  let subtotal = $derived(items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0));
  let tax = $derived(
    form.taxMode === "invoice"
      ? subtotal * ((Number(form.taxRate) || 0) / 100)
      : items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0) * ((Number(item.taxPercent) || 0) / 100), 0),
  );
  let total = $derived(form.pricesIncludeTax === "true" ? subtotal : subtotal + tax); // Simplified for visual parity

  async function handleSubmit(e: SubmitEvent | Event) {
    if (e && "preventDefault" in e) e.preventDefault();
    saving = true;
    error = "";

    try {
      const payload = {
        ...form,
        pricesIncludeTax: form.pricesIncludeTax === "true",
        items: items.map((i) => ({
          productId: i.productId || undefined,
          description: i.description,
          quantity: Number(i.quantity),
          unit: typeof i.unit === "string" ? i.unit.trim() : "",
          unitPrice: Number(i.unitPrice),
          taxPercent: Number(i.taxPercent || 0),
          notes: i.notes,
        })),
      };
      const url = initInvoice ? "/api/v1/invoices/" + initInvoice.id : "/api/v1/invoices";
      const res = await fetch(url, {
        method: initInvoice ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const d = await res.text();
        let errMsg = "Failed to save invoice";
        try {
          const j = JSON.parse(d);
          errMsg = j.error || errMsg;
        } catch {}
        throw new Error(errMsg);
      }

      const txt = await res.text();
      let result;
      try {
        result = JSON.parse(txt);
      } catch (err: any) {
        throw new Error("JSON parse error: " + err.message + " (Response: " + txt.substring(0, 100) + " )");
      }
      goto("/invoices/" + result.id);
    } catch (err: any) {
      error = err.message;
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    //
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<form id={formId} onsubmit={handleSubmit} class="space-y-6">
  {#if error}
    <div class="alert alert-error">{error}</div>
  {/if}

  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Customer")} <span class="text-error">*</span></span>
      </div>
      <select class="select select-bordered w-full" bind:value={form.customerId} required>
        <option value="">{t("Select customer")}</option>
        {#each customers as c (c.id)}
          <option value={c.id}>{c.name}</option>
        {/each}
      </select>
    </label>

    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Invoice Number")}</span>
      </div>
      <input type="text" class="input input-bordered w-full" placeholder={t("e.g. INV-2025-001")} bind:value={form.invoiceNumber} />
    </label>

    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Currency")}</span>
      </div>
      <input type="text" class="input input-bordered w-full" bind:value={form.currency} />
    </label>

    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Status")}</span>
      </div>
      <select class="select select-bordered w-full" bind:value={form.status}>
        <option value="draft">{t("Draft")}</option>
        <option value="sent">{t("Sent")}</option>
        <option value="paid">{t("Paid")}</option>
        <option value="complete">{t("Complete")}</option>
        <option value="overdue">{t("Overdue")}</option>
        <option value="voided">{t("Voided")}</option>
      </select>
    </label>
  </div>

  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Issue Date")}</span>
      </div>
      <input type="date" class="input input-bordered w-full" bind:value={form.issueDate} required />
    </label>

    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Due Date")}</span>
      </div>
      <input type="date" class="input input-bordered w-full" bind:value={form.dueDate} />
    </label>
  </div>

  <div>
    <div class="mb-2 flex items-center justify-between">
      <div class="block text-sm font-semibold">
        {t("Items")} <span class="text-error">*</span>
      </div>
      <button type="button" class="btn btn-sm" onclick={addItem}>
        <Plus size={16} />
        <span class="ml-2">{t("Add item")}</span>
      </button>
    </div>

    <div class="mb-1 hidden flex-row flex-nowrap items-center gap-2 text-xs font-medium opacity-60 lg:flex">
      <div class="w-6 shrink-0"></div>
      {#if products.length > 0}
        <div class="w-44 max-w-xs shrink-0 text-center">{t("Product")}</div>
      {/if}
      <div class="min-w-0 flex-1 pl-3">{t("Description")}</div>
      <div class="w-16 shrink-0 text-center sm:w-20">{t("Quantity")}</div>
      <div class="w-24 shrink-0 text-center">{t("Unit")}</div>
      <div class="w-24 shrink-0 text-center">{t("Price")}</div>
      {#if form.taxMode === "line"}
        <div class="w-20 shrink-0 text-center">{t("Tax %")}</div>
      {/if}
      <div class="w-40 max-w-xs shrink-0 text-center">{t("Notes")}</div>
      <div class="w-8 shrink-0"></div>
    </div>

    <div class="space-y-3" role="list">
      {#each items as item, i (item.id)}
        <div
          role="listitem"
          class="rounded-box flex flex-nowrap items-center gap-2 p-1 transition-colors {draggedId === item.id ? 'opacity-50' : ''} {dragHoverId === item.id ? 'bg-base-200' : ''}"
          draggable="true"
          ondragstart={(e) => handleDragStart(e, item.id)}
          ondragover={(e) => handleDragOver(e, item.id)}
          ondragleave={() => handleDragLeave(item.id)}
          ondrop={(e) => handleDrop(e, item.id)}
          ondragend={handleDragEnd}
        >
          <button type="button" class="btn btn-ghost btn-sm btn-square shrink-0 cursor-move opacity-40 hover:opacity-100" tabindex="-1">
            <GripVertical size={16} />
          </button>

          {#if products.length > 0}
            <select class="select select-bordered w-44 max-w-xs shrink-0" bind:value={item.productId} onchange={(e) => applyProductSelection(item, (e.currentTarget as HTMLSelectElement).value)}>
              <option value="">{t("Select product")}</option>
              {#each products as p (p.id)}
                <option value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>
              {/each}
            </select>
          {/if}

          <input class="input input-bordered w-full min-w-0" bind:value={item.description} placeholder={t("Description")} required />
          <input type="number" min="0" step="any" class="input input-bordered w-16 shrink-0 text-center sm:w-20" bind:value={item.quantity} />
          <input class="input input-bordered w-24 shrink-0 text-center" bind:value={item.unit} placeholder={t("Unit")} />
          <input type="number" min="0" step="any" class="input input-bordered w-24 shrink-0 text-center" bind:value={item.unitPrice} />
          {#if form.taxMode === "line"}
            <input type="number" min="0" step="any" class="input input-bordered w-20 shrink-0 text-center" bind:value={item.taxPercent} placeholder="%" />
          {/if}
          <input class="input input-bordered w-40 max-w-xs shrink-0" bind:value={item.notes} placeholder={t("Notes")} />

          <button type="button" class="btn btn-ghost btn-square btn-sm shrink-0" onclick={() => removeItem(i)} aria-label={t("Remove item")}>&times;</button>
        </div>
      {/each}
    </div>

    <div class="mt-6 flex flex-col items-end space-y-2 text-sm">
      <div class="flex w-48 justify-between">
        <span>{t("Subtotal")}:</span>
        <span>{subtotal.toFixed(2)}</span>
      </div>
      {#if tax > 0}
        <div class="flex w-48 justify-between">
          <span>{t("Tax")}:</span>
          <span>{tax.toFixed(2)}</span>
        </div>
      {/if}
      <div class="flex w-48 justify-between text-lg font-bold">
        <span>{t("Total")}:</span>
        <span>{total.toFixed(2)} {form.currency}</span>
      </div>
    </div>
  </div>

  <div class="flex gap-4 text-xs opacity-50">
    <span class="flex items-center gap-1"
      ><kbd class="kbd kbd-xs">Ctrl</kbd>+<kbd class="kbd kbd-xs">S</kbd>
      {t("Save")}</span
    >
    <span class="flex items-center gap-1"
      ><kbd class="kbd kbd-xs">Ctrl</kbd>+<kbd class="kbd kbd-xs">Enter</kbd>
      {t("Add item")}</span
    >
  </div>

  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <label class="form-control">
      <div class="label"><span class="label-text">{t("Tax Mode")}</span></div>
      <select class="select select-bordered w-full" bind:value={form.taxMode}>
        <option value="invoice">{t("Invoice total")}</option>
        <option value="line">{t("Per line")}</option>
      </select>
    </label>

    <label class="form-control" class:hidden={form.taxMode !== "invoice"}>
      <div class="label">
        <span class="label-text">{t("Tax Rate (%)")}</span>
      </div>
      <input type="number" class="input input-bordered w-full" bind:value={form.taxRate} step="any" min="0" />
    </label>

    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Prices include tax?")}</span>
      </div>
      <select class="select select-bordered w-full" bind:value={form.pricesIncludeTax}>
        <option value="false">{t("No")}</option>
        <option value="true">{t("Yes")}</option>
      </select>
    </label>

    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Rounding mode")}</span>
      </div>
      <select class="select select-bordered w-full" bind:value={form.roundingMode}>
        <option value="line">{t("Round per line")}</option>
        <option value="total">{t("Round on total")}</option>
      </select>
    </label>
  </div>

  <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Payment Terms")}</span>
      </div>
      <textarea class="textarea textarea-bordered h-24 w-full" bind:value={form.paymentTerms}></textarea>
    </label>

    <label class="form-control">
      <div class="label"><span class="label-text">{t("Notes")}</span></div>
      <textarea class="textarea textarea-bordered h-24 w-full" bind:value={form.notes}></textarea>
    </label>
  </div>
</form>
