<script lang="ts">
  import { getContext, tick } from "svelte";
  import { ChevronsUpDown, X } from "lucide-svelte";

  let { products = [], value = "", id = "product-combobox", class: className = "", onchange = (_productId: string) => {} } = $props();
  let t = getContext("i18n") as (key: string) => string;

  let input: HTMLInputElement | undefined = $state();
  let listEl: HTMLUListElement | undefined = $state();
  let open = $state(false);
  let query = $state("");
  let activeIndex = $state(0);

  let selected = $derived(products.find((p: any) => p.id === value) || null);

  function label(p: any) {
    return p.sku ? `${p.name} (${p.sku})` : p.name;
  }

  // Matches every whitespace-separated term against name, SKU, description and
  // category, so "web hour" finds "Web development" billed per hour.
  let results = $derived.by(() => {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return products;
    return products.filter((p: any) => {
      const haystack = [p.name, p.sku, p.description, p.category, p.unit]
        .filter((v) => v !== undefined && v !== null)
        .join(" ")
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  });

  // Show the selected product whenever the user isn't actively searching.
  $effect(() => {
    if (!open) query = selected ? label(selected) : "";
  });

  function openList() {
    if (open) return;
    open = true;
    query = "";
    activeIndex = Math.max(
      0,
      results.findIndex((p: any) => p.id === value),
    );
    scrollActiveIntoView();
  }

  function close() {
    open = false;
  }

  function select(product: any) {
    // Re-picking the current product must not overwrite manual edits to the line.
    if (product.id !== value) onchange(product.id);
    close();
  }

  function clear() {
    onchange("");
    query = "";
    input?.focus();
  }

  async function scrollActiveIntoView() {
    await tick();
    listEl?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }

  function handleKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) return openList();
        activeIndex = Math.min(activeIndex + 1, results.length - 1);
        scrollActiveIntoView();
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) return openList();
        activeIndex = Math.max(activeIndex - 1, 0);
        scrollActiveIntoView();
        break;
      case "Enter":
        if (open) {
          e.preventDefault();
          if (results[activeIndex]) select(results[activeIndex]);
        }
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          close();
        }
        break;
      case "Tab":
        close();
        break;
    }
  }
</script>

<div class="relative {className}">
  <div class="input input-bordered flex w-full items-center gap-2">
    <input
      bind:this={input}
      {id}
      type="text"
      class="min-w-0 grow"
      role="combobox"
      aria-label={t("Product")}
      aria-expanded={open}
      aria-controls="{id}-listbox"
      aria-autocomplete="list"
      aria-activedescendant={open && results[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
      autocomplete="off"
      placeholder={selected ? label(selected) : t("Select product")}
      bind:value={query}
      onfocus={openList}
      onclick={openList}
      onblur={close}
      oninput={() => {
        open = true;
        activeIndex = 0;
      }}
      onkeydown={handleKeydown}
    />
    {#if value}
      <button type="button" class="opacity-50 hover:opacity-100" tabindex="-1" aria-label={t("Clear")} onmousedown={(e) => e.preventDefault()} onclick={clear}>
        <X size={16} />
      </button>
    {:else}
      <ChevronsUpDown size={16} class="shrink-0 opacity-50" />
    {/if}
  </div>

  {#if open}
    <!-- min-w keeps the list readable even though the trigger sits in a narrow table column -->
    <ul
      bind:this={listEl}
      id="{id}-listbox"
      role="listbox"
      class="menu bg-base-100 rounded-box border-base-300 absolute z-20 mt-1 max-h-72 w-full min-w-72 flex-nowrap overflow-y-auto border p-1 shadow-lg"
    >
      {#each results as p, i (p.id)}
        <li role="option" id="{id}-option-{i}" data-index={i} aria-selected={p.id === value}>
          <!-- mousedown is prevented so the input keeps focus and doesn't close the list before the click lands -->
          <button
            type="button"
            tabindex="-1"
            class="flex flex-col items-start gap-0"
            class:menu-active={i === activeIndex}
            onmousedown={(e) => e.preventDefault()}
            onmouseenter={() => (activeIndex = i)}
            onclick={() => select(p)}
          >
            <span class:font-semibold={p.id === value}>{p.name}</span>
            <span class="text-xs opacity-60">
              {[p.sku, `${Number(p.unitPrice ?? p.unit_price ?? 0).toFixed(2)}${p.unit ? ` / ${p.unit}` : ""}`].filter(Boolean).join(" · ")}
            </span>
          </button>
        </li>
      {:else}
        <li class="px-3 py-2 text-sm opacity-60">{t("No products found")}</li>
      {/each}
    </ul>
  {/if}
</div>
