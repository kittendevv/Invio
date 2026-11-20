<script lang="ts">
  import { getContext } from "svelte";
  import type { MonthlySales } from "$lib/dashboardStats";

  let {
    monthly = [],
    formatMoney,
    formatCompact,
    locale = "en",
  }: {
    monthly: MonthlySales[];
    formatMoney: (n: number) => string;
    formatCompact: (n: number) => string;
    locale?: string;
  } = $props();

  let t = getContext("i18n") as (key: string, params?: Record<string, string | number>) => string;

  const MARGIN = { top: 12, right: 8, bottom: 26, left: 56 };

  // The chart fills whatever height its parent gives it (at least 160px, via min-h-40).
  let width = $state(0);
  let height = $state(0);
  let hovered = $state<number | null>(null);

  let innerW = $derived(Math.max(0, width - MARGIN.left - MARGIN.right));
  let innerH = $derived(Math.max(0, height - MARGIN.top - MARGIN.bottom));

  // Rounds the axis maximum up to 1/2/2.5/5 x 10^n so ticks land on readable values.
  let ticks = $derived.by(() => {
    const max = Math.max(0, ...monthly.map((m) => m.total));
    if (max <= 0) return [0];
    const raw = max / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? 10 * mag;
    const out: number[] = [];
    for (let v = 0; v < max + step * 0.999; v += step) out.push(v);
    return out;
  });
  let yMax = $derived(ticks[ticks.length - 1] || 1);
  const y = (v: number) => MARGIN.top + innerH - (v / yMax) * innerH;

  let step = $derived(monthly.length ? innerW / monthly.length : 0);
  // 2px gap between bars; cap the width so a 12-bar year doesn't look like slabs.
  let barW = $derived(Math.max(1, Math.min(48, step - 2)));
  const barX = (i: number) => MARGIN.left + i * step + (step - barW) / 2;

  function monthDate(key: string) {
    return new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1);
  }
  let shortMonth = $derived(new Intl.DateTimeFormat(locale, { month: "short" }));
  let longMonth = $derived(new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }));

  // One label per month for a single year; otherwise label January of every Nth year.
  let labels = $derived.by(() => {
    if (monthly.length <= 12) {
      return monthly.map((m, i) => ({ i, text: shortMonth.format(monthDate(m.month)) })).filter((_, i) => step >= 28 || i % 2 === 0);
    }
    const yearEvery = Math.max(1, Math.ceil(40 / (step * 12 || 1)));
    return monthly
      .map((m, i) => ({ i, m }))
      .filter(({ m, i }) => (m.month.endsWith("-01") || i === 0) && Number(m.month.slice(0, 4)) % yearEvery === 0)
      .map(({ m, i }) => ({ i, text: m.month.slice(0, 4) }));
  });

  // Column path with 4px rounded top corners and a square base on the axis.
  function barPath(i: number, value: number) {
    const x = barX(i);
    const top = y(value);
    const h = MARGIN.top + innerH - top;
    if (h <= 0) return "";
    const r = Math.min(4, barW / 2, h);
    return `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + barW - r}Q${x + barW},${top} ${x + barW},${top + r}V${top + h}Z`;
  }

  let tooltip = $derived(hovered !== null ? monthly[hovered] : null);
  let tooltipLeft = $derived(hovered !== null ? Math.min(Math.max(barX(hovered) + barW / 2, 80), Math.max(80, width - 80)) : 0);
  let hasSales = $derived(monthly.some((m) => m.total > 0));
</script>

<div class="relative min-h-40 w-full flex-1" bind:clientWidth={width} bind:clientHeight={height}>
  {#if !hasSales}
    <div class="absolute inset-0 flex items-center justify-center text-sm opacity-60">{t("No sales in this period")}</div>
  {:else if width > 0 && height > 0}
    <svg class="absolute inset-0" {width} {height} role="img" aria-label={t("Sales per month")} onpointerleave={() => (hovered = null)}>
      {#each ticks as tick (tick)}
        <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} class="stroke-base-content/10" stroke-width="1" />
        <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" text-anchor="end" class="fill-base-content/60 text-[11px] tabular-nums">{formatCompact(tick)}</text>
      {/each}

      {#each monthly as m, i (m.month)}
        {#if hovered === i}
          <rect x={MARGIN.left + i * step} y={MARGIN.top} width={step} height={innerH} class="fill-base-content/5" />
        {/if}
        <path d={barPath(i, m.total)} class="fill-primary" />
      {/each}

      <line x1={MARGIN.left} x2={width - MARGIN.right} y1={MARGIN.top + innerH} y2={MARGIN.top + innerH} class="stroke-base-content/30" stroke-width="1" />

      {#each labels as l (l.i)}
        <text x={barX(l.i) + (monthly.length <= 12 ? barW / 2 : 0)} y={height - 8} text-anchor={monthly.length <= 12 ? "middle" : "start"} class="fill-base-content/60 text-[11px]">{l.text}</text>
      {/each}

      <!-- Full-height hit targets so thin or empty months are still easy to hover -->
      {#each monthly as m, i (m.month)}
        <rect x={MARGIN.left + i * step} y={MARGIN.top} width={step} height={innerH} fill="transparent" role="presentation" onpointerenter={() => (hovered = i)} />
      {/each}
    </svg>

    {#if tooltip}
      <div class="bg-base-100 border-base-300 rounded-box pointer-events-none absolute z-10 -translate-x-1/2 border px-3 py-2 text-sm shadow-lg" style="left: {tooltipLeft}px; top: 0">
        <div class="font-medium">{longMonth.format(monthDate(tooltip.month))}</div>
        <div class="tabular-nums">{formatMoney(tooltip.total)}</div>
        <div class="text-xs opacity-60">{t("Invoices")}: {tooltip.count}</div>
      </div>
    {/if}
  {/if}

  <table class="sr-only">
    <caption>{t("Sales per month")}</caption>
    <thead><tr><th>{t("Month")}</th><th>{t("Sales")}</th><th>{t("Invoices")}</th></tr></thead>
    <tbody>
      {#each monthly as m (m.month)}
        <tr><td>{longMonth.format(monthDate(m.month))}</td><td>{formatMoney(m.total)}</td><td>{m.count}</td></tr>
      {/each}
    </tbody>
  </table>
</div>
