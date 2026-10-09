<script lang="ts">
  import { getContext, tick } from "svelte";
  import { ChevronsUpDown, X } from "lucide-svelte";

  let { customers = [], value = $bindable(""), required = false, id = "customer-combobox" } = $props();
  let t = getContext("i18n") as (key: string) => string;

  let input: HTMLInputElement | undefined = $state();
  let listEl: HTMLUListElement | undefined = $state();
  let open = $state(false);
  let query = $state("");
  let activeIndex = $state(0);

  let selected = $derived(customers.find((c: any) => c.id === value) || null);

  // Matches every whitespace-separated term against name, contact, email and
  // customer number, so "acme jo" finds "ACME Corp" with contact "John".
  let results = $derived.by(() => {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return customers;
    return customers.filter((c: any) => {
      const haystack = [c.name, c.contactName, c.email, c.customerNumber]
        .filter((v) => v !== undefined && v !== null)
        .join(" ")
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  });

  // Show the selected customer's name whenever the user isn't actively searching.
  $effect(() => {
    if (!open) query = selected?.name || "";
  });

  // Native form validation: the text input itself is what the browser checks.
  $effect(() => {
    input?.setCustomValidity(required && !value ? t("Select customer") : "");
  });

  function openList() {
    if (open) return;
    open = true;
    query = "";
    activeIndex = Math.max(
      0,
      results.findIndex((c: any) => c.id === value),
    );
    scrollActiveIntoView();
  }

  function close() {
    open = false;
  }

  function select(customer: any) {
    value = customer.id;
    close();
  }

  function clear() {
    value = "";
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

<div class="relative">
  <div class="input input-bordered flex w-full items-center gap-2">
    <input
      bind:this={input}
      {id}
      type="text"
      class="min-w-0 grow"
      role="combobox"
      aria-expanded={open}
      aria-controls="{id}-listbox"
      aria-autocomplete="list"
      aria-activedescendant={open && results[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
      autocomplete="off"
      placeholder={selected?.name || t("Select customer")}
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
      <ChevronsUpDown size={16} class="opacity-50" />
    {/if}
  </div>

  {#if open}
    <ul bind:this={listEl} id="{id}-listbox" role="listbox" class="menu bg-base-100 rounded-box border-base-300 absolute z-20 mt-1 max-h-72 w-full flex-nowrap overflow-y-auto border p-1 shadow-lg">
      {#each results as c, i (c.id)}
        <li role="option" id="{id}-option-{i}" data-index={i} aria-selected={c.id === value}>
          <!-- mousedown is prevented so the input keeps focus and doesn't close the list before the click lands -->
          <button
            type="button"
            tabindex="-1"
            class="flex flex-col items-start gap-0"
            class:menu-active={i === activeIndex}
            onmousedown={(e) => e.preventDefault()}
            onmouseenter={() => (activeIndex = i)}
            onclick={() => select(c)}
          >
            <span class:font-semibold={c.id === value}>{c.name}</span>
            {#if c.contactName || c.email}
              <span class="text-xs opacity-60">{[c.contactName, c.email].filter(Boolean).join(" · ")}</span>
            {/if}
          </button>
        </li>
      {:else}
        <li class="px-3 py-2 text-sm opacity-60">{t("No customers found")}</li>
      {/each}
    </ul>
  {/if}
</div>
