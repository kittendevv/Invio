<script lang="ts">
  import { page } from "$app/state";
  import "@fontsource-variable/inter/wght.css";
  import { FileText, LayoutDashboard, LogOut, Ellipsis, Package, ReceiptText, Settings, UserCog, Users } from "lucide-svelte";
  import Breadcrumbs from "$lib/components/Breadcrumbs.svelte";
  import "./layout.css";
  import DemoAlert from "$lib/components/DemoAlert.svelte";
  import { setContext } from "svelte";
  import { createTranslator } from "$lib/i18n/mod";
  let { data, children } = $props();

  let authUser = $derived(data.user);
  let localizationData = $derived(data.localization);
  let translator = $derived(createTranslator(localizationData?.locale));
  let t = $derived(translator.t);

  // Expose to children as a function that delegates to the derived `t`
  setContext("i18n", (key: string, params?: Record<string, string | number>) => t(key, params));
  setContext("localization", () => localizationData);

  let demoMode = false;
  let isAdmin = $derived(authUser?.isAdmin ?? false);

  function hasPermission(resource: string, action: string) {
    if (!authUser) return false;
    if (authUser.isAdmin) return true;
    return authUser.permissions.some((p: any) => p.resource === resource && p.action === action);
  }

  let canViewInvoices = $derived(hasPermission("invoices", "read"));
  let canViewQuotes = $derived(hasPermission("quotes", "read"));
  let canViewProducts = $derived(hasPermission("products", "read"));
  let canViewCustomers = $derived(hasPermission("customers", "read"));
  let canViewSettings = $derived(hasPermission("settings", "read"));
  let canViewUsers = $derived(hasPermission("users", "read"));
  let authed = $derived(!!authUser);
  let wide = $derived(page.data.wide ?? false);
  let isPublic = $derived(page.url.pathname.startsWith("/public"));
  let moreMenuDetails = $state<HTMLDetailsElement | null>(null);

  function closeMoreMenuOnOutsideClick(event: MouseEvent) {
    if (!moreMenuDetails?.open) return;
    const target = event.target as Node | null;
    if (target && !moreMenuDetails.contains(target)) {
      moreMenuDetails.open = false;
    }
  }

  $effect(() => {
    document.addEventListener("click", closeMoreMenuOnOutsideClick, true);
    return () => {
      document.removeEventListener("click", closeMoreMenuOnOutsideClick, true);
    };
  });
</script>

{#if isPublic}
  <main class="bg-base-100 flex min-h-screen flex-col">
    {@render children()}
  </main>
{:else}
  <div class="bg-base-200 min-h-screen">
    <div class="navbar bg-base-100 border-base-300 border-b px-3 sm:px-4" data-demo={demoMode ? "true" : "false"}>
      <div class="container mx-auto flex items-center">
        <div class="navbar-start flex-1">
          <a href="/" class="btn btn-ghost text-lg sm:text-xl">
            <span class="brand-logo inline-flex items-center">
              <svg class="mr-2 h-4 w-4 sm:h-5 sm:w-5" viewBox="0 0 500 500" aria-hidden="true" focusable="false">
                <path
                  d="M104.16661834716797,437.5000305175781L104.16661834716797,104.1666488647461C104.16661834716797,81.1548080444336,122.82152557373047,62.50002670288086,145.83335876464844,62.50002670288086L354.1666259765625,62.50002670288086C377.1785888671875,62.50002670288086,395.8333740234375,81.1548080444336,395.8333740234375,104.1666488647461L395.8333740234375,437.5000305175781L333.3333740234375,395.8334045410156L291.6666259765625,437.5000305175781L249.99998474121094,395.8334045410156L208.33335876464844,437.5000305175781L166.66661071777344,395.8334045410156ZM187.49998474121094,145.83340454101562L312.5,145.83340454101562M187.49998474121094,229.16665649414062L312.5,229.16665649414062M270.8333740234375,312.5000305175781L312.5,312.5000305175781"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="41.6667"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span>{t("Invio")}</span>
            </span>
          </a>
        </div>
        <div class="navbar-end ml-auto items-center justify-end gap-2">
          {#if authed}
            <ul class="menu menu-horizontal hidden px-1 md:flex">
              <li>
                <a href="/dashboard">
                  <LayoutDashboard size={16} />
                  {t("Dashboard")}
                </a>
              </li>
              {#if canViewQuotes}
                <li>
                  <a href="/quotes">
                    <FileText size={16} />
                    {t("Quotes")}
                  </a>
                </li>
              {/if}
              {#if canViewInvoices}
                <li>
                  <a href="/invoices">
                    <ReceiptText size={16} />
                    {t("Invoices")}
                  </a>
                </li>
              {/if}
              {#if canViewCustomers}
                <li>
                  <a href="/customers">
                    <Users size={16} />
                    {t("Customers")}
                  </a>
                </li>
              {/if}
              <li>
                <details bind:this={moreMenuDetails}>
                  <summary>
                    <Ellipsis size={16} />
                    {t("More")}
                  </summary>
                  <ul class="bg-base-100 rounded-box z-20 w-52 p-2">
                    {#if canViewProducts}
                      <li>
                        <a href="/products">
                          <Package size={16} />
                          {t("Products")}
                        </a>
                      </li>
                    {/if}
                    {#if canViewSettings}
                      <li>
                        <a href="/settings">
                          <Settings size={16} />
                          {t("Settings")}
                        </a>
                      </li>
                    {/if}
                    {#if canViewUsers}
                      <li>
                        <a href="/users">
                          <UserCog size={16} />
                          {t("Users")}
                        </a>
                      </li>
                    {/if}
                    <li>
                      <a href="/logout">
                        <LogOut size={16} />
                        {t("Logout")}
                      </a>
                    </li>
                  </ul>
                </details>
              </li>
            </ul>

            <div class="dropdown dropdown-end md:hidden">
              <div tabindex="0" role="button" class="btn btn-ghost">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </div>
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <ul tabindex="0" class="menu dropdown-content bg-base-100 rounded-box z-10 mt-2 w-52 p-2 shadow">
                <li>
                  <a href="/dashboard">
                    <LayoutDashboard size={16} />
                    {t("Dashboard")}
                  </a>
                </li>
                {#if canViewQuotes}
                  <li>
                    <a href="/quotes">
                      <FileText size={16} />
                      {t("Quotes")}
                    </a>
                  </li>
                {/if}
                {#if canViewInvoices}
                  <li>
                    <a href="/invoices">
                      <ReceiptText size={16} />
                      {t("Invoices")}
                    </a>
                  </li>
                {/if}
                {#if canViewProducts}
                  <li>
                    <a href="/products">
                      <Package size={16} />
                      {t("Products")}
                    </a>
                  </li>
                {/if}
                {#if canViewCustomers}
                  <li>
                    <a href="/customers">
                      <Users size={16} />
                      {t("Customers")}
                    </a>
                  </li>
                {/if}
                {#if canViewSettings}
                  <li>
                    <a href="/settings">
                      <Settings size={16} />
                      {t("Settings")}
                    </a>
                  </li>
                {/if}
                {#if canViewUsers}
                  <li>
                    <a href="/users">
                      <UserCog size={16} />
                      {t("Users")}
                    </a>
                  </li>
                {/if}
                <li>
                  <a href="/logout">
                    <LogOut size={16} />
                    {t("Logout")}
                  </a>
                </li>
              </ul>
            </div>
          {/if}
        </div>
      </div>
    </div>
    <main class={"container mx-auto px-3 py-4 sm:px-4 sm:py-6 " + (wide ? "max-w-screen-2xl" : "")}>
      {#if authed}
        <DemoAlert data={page.data} />
        <Breadcrumbs {t} />
      {/if}
      {@render children()}
    </main>
  </div>
{/if}
