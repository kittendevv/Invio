<script lang="ts">
  import { getContext } from "svelte";
  import { WORLD_MAP_DOTS, WORLD_MAP_PATHS, WORLD_MAP_VIEWBOX } from "$lib/worldMap";
  import { countryName, type CountrySales } from "$lib/dashboardStats";

  let {
    countries = [],
    formatMoney,
    locale = "en",
  }: {
    countries: CountrySales[];
    formatMoney: (n: number) => string;
    locale?: string;
  } = $props();

  let t = getContext("i18n") as (key: string, params?: Record<string, string | number>) => string;

  let container: HTMLDivElement | undefined = $state();
  let hovered = $state<string | null>(null);
  let pointer = $state({ x: 0, y: 0 });

  let byCode = $derived(new Map(countries.map((c) => [c.code, c])));
  let max = $derived(Math.max(0, ...countries.map((c) => c.total)));
  let total = $derived(countries.reduce((s, c) => s + c.total, 0));

  // Sequential scale in the theme's primary color: the share of primary mixed into
  // the surface grows with sqrt(value) so a few big markets don't wash out the rest.
  function fill(code: string) {
    const v = byCode.get(code)?.total || 0;
    if (v <= 0 || max <= 0) return "color-mix(in oklab, var(--color-base-content) 10%, var(--color-base-100))";
    const pct = Math.round(20 + 80 * Math.sqrt(v / max));
    return `color-mix(in oklab, var(--color-primary) ${pct}%, var(--color-base-100))`;
  }

  let dots = $derived(Object.entries(WORLD_MAP_DOTS).filter(([code]) => byCode.has(code)));

  function onMove(e: PointerEvent) {
    const rect = container?.getBoundingClientRect();
    if (!rect) return;
    pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  let tip = $derived(hovered ? { name: countryName(hovered, locale), sales: byCode.get(hovered) } : null);
  let tipLeft = $derived(Math.min(Math.max(pointer.x, 90), Math.max(90, (container?.clientWidth || 0) - 90)));
</script>

<div class="relative mx-auto w-full max-w-3xl" bind:this={container} onpointermove={onMove} onpointerleave={() => (hovered = null)} role="presentation">
  <svg viewBox={WORLD_MAP_VIEWBOX} class="h-auto w-full" role="img" aria-label={t("Sales by country")}>
    {#each Object.entries(WORLD_MAP_PATHS) as [code, d] (code)}
      <path
        {d}
        fill={fill(code)}
        class="stroke-base-100 transition-[stroke]"
        class:stroke-base-content={hovered === code}
        stroke-width={hovered === code ? 1.5 : 0.5}
        stroke-linejoin="round"
        role="presentation"
        onpointerenter={() => (hovered = code)}
      />
    {/each}
    {#each dots as [code, [x, y]] (code)}
      <circle
        cx={x}
        cy={y}
        r="4"
        fill={fill(code)}
        class="stroke-base-100"
        class:stroke-base-content={hovered === code}
        stroke-width="1.5"
        role="presentation"
        onpointerenter={() => (hovered = code)}
      />
    {/each}
  </svg>

  {#if tip}
    <div class="bg-base-100 border-base-300 rounded-box pointer-events-none absolute z-10 -translate-x-1/2 border px-3 py-2 text-sm shadow-lg" style="left: {tipLeft}px; top: {pointer.y + 16}px">
      <div class="font-medium">{tip.name}</div>
      {#if tip.sales}
        <div class="tabular-nums">{formatMoney(tip.sales.total)}</div>
        <div class="text-xs opacity-60">
          {t("Invoices")}: {tip.sales.count} · {Math.round((tip.sales.total / (total || 1)) * 100)}%
        </div>
      {:else}
        <div class="text-xs opacity-60">{t("No sales")}</div>
      {/if}
    </div>
  {/if}

  {#if max > 0}
    <div class="mt-2 flex items-center justify-end gap-2 text-xs opacity-70">
      <span class="tabular-nums">{formatMoney(0)}</span>
      <div class="h-2 w-32 rounded-full" style="background: linear-gradient(to right, color-mix(in oklab, var(--color-primary) 20%, var(--color-base-100)), var(--color-primary))"></div>
      <span class="tabular-nums">{formatMoney(max)}</span>
    </div>
  {/if}
</div>
