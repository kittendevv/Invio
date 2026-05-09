<script lang="ts">
  import { Save, CircleAlert, Building2, Palette, Sun, Languages, LayoutTemplate, CreditCard, Percent, Package, Hash, FileCodeCorner, Shield } from "lucide-svelte";
  import { getContext } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import QRCode from "qrcode";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";
  import TaxDefinitionsManager from "./components/TaxDefinitionsManager.svelte";
  import ProductOptionsManager from "./components/ProductOptionsManager.svelte";
  import TemplateOptionsManager from "./components/TemplateOptionsManager.svelte";
  import BrandingManager from "./components/BrandingManager.svelte";

  let { data } = $props();
  let t = getContext("i18n") as (key: string) => string;
  const asBool = (value: unknown) => String(value ?? "false").toLowerCase() === "true";

  let initialSettings = $derived(data.settings || {});
  let baselineSettings = $state({} as Record<string, any>);
  let settings = $state({
    dateFormat: "YYYY-MM-DD",
    numberFormat: "comma",
    postalCityFormat: "auto",
    ...initialSettings,
    allowProtectedInvoiceChanges: asBool((initialSettings as Record<string, unknown>).allowProtectedInvoiceChanges),
  } as Record<string, any>);

  let saving = $state(false);
  let error = $state("");
  let success = $state("");
  let twoFactorLoading = $state(false);
  let twoFactorVerifying = $state(false);
  let twoFactorError = $state("");
  let twoFactorSuccess = $state("");
  let twoFactorToken = $state("");
  let otpAuthUrl = $state("");
  let otpQrDataUrl = $state("");
  let recoveryCodes = $state([] as string[]);
  let twoFactorEnabled = $state(Boolean((data as any)?.user?.twoFactorEnabled));
  let twoFactorDisabling = $state(false);
  let twoFactorDisableConfirm = $state(false);
  let twoFactorDisableCode = $state("");
  let xmlProfiles = $derived((data.xmlProfiles || []) as Array<{ id: string; name: string }>);

  let demoMode = $derived((data as any)?.demoMode === true || (data as any)?.demoMode === "true");
  let requestedSection = $derived(page.url.searchParams.get("section") || "company");
  let section = $derived(requestedSection === "security" && demoMode ? "company" : requestedSection);
  let canUpdateSettings = $derived(true); // TODO: user permissions

  // Keep settings synced if data.settings changes from an external invalidation
  $effect(() => {
    if (data.settings) {
      baselineSettings = { ...data.settings };
      if (Object.keys(settings).length === 0) {
        settings = { ...data.settings };
      } else {
        // Just make sure the references don't break
      }
    }
  });

  async function saveSettings(e: SubmitEvent) {
    e.preventDefault();
    saving = true;
    error = "";
    success = "";

    try {
      const current = JSON.parse(JSON.stringify(settings)) as Record<string, any>;
      const baseline = JSON.parse(JSON.stringify(baselineSettings)) as Record<string, any>;
      const payload: Record<string, any> = {};
      for (const [key, value] of Object.entries(current)) {
        if (key === "allowProtectedInvoiceChanges") {
          const normalized = Boolean(value);
          const baselineNormalized = Boolean(baseline[key]);
          if (normalized !== baselineNormalized) {
            payload[key] = normalized;
          }
          continue;
        }
        if (JSON.stringify(value) !== JSON.stringify(baseline[key])) {
          payload[key] = value;
        }
      }
      if (Object.keys(payload).length === 0) {
        success = t("Settings updated successfully");
        return;
      }
      const res = await fetch("/api/v1/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(t("Failed to save settings"));

      const latestRes = await fetch("/api/v1/settings");
      if (latestRes.ok) {
        const latest = await latestRes.json();
        settings = {
          ...latest,
          dateFormat: latest.dateFormat || "YYYY-MM-DD",
          numberFormat: latest.numberFormat || "comma",
          postalCityFormat: latest.postalCityFormat || "auto",
          allowProtectedInvoiceChanges: String(latest.allowProtectedInvoiceChanges || "false").toLowerCase() === "true",
        };
        baselineSettings = { ...latest };
      }

      success = t("Settings updated successfully");
      await invalidateAll();
    } catch (err: any) {
      error = err.message;
    } finally {
      saving = false;
    }
  }

  async function startTwoFactorSetup() {
    twoFactorLoading = true;
    twoFactorError = "";
    twoFactorSuccess = "";
    recoveryCodes = [];
    twoFactorToken = "";
    try {
      const res = await fetch("/api/v1/users/me/2fa/setup", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || t("Failed to generate 2FA setup"));
      }
      otpAuthUrl = String(body?.otpAuthUrl || "");
      if (!otpAuthUrl) throw new Error(t("Invalid server response"));
      otpQrDataUrl = await QRCode.toDataURL(otpAuthUrl);
      twoFactorSuccess = t("Scan this QR code with your authenticator app");
    } catch (err: any) {
      twoFactorError = err?.message || t("Failed to generate 2FA setup");
    } finally {
      twoFactorLoading = false;
    }
  }

  async function disableTwoFactor(e: SubmitEvent) {
    e.preventDefault();
    twoFactorDisabling = true;
    twoFactorError = "";
    twoFactorSuccess = "";
    try {
      const code = String(twoFactorDisableCode || "")
        .replace(/\s+/g, "")
        .trim();
      if (!/^\d{6}$/.test(code)) throw new Error(t("Enter 6-digit code"));
      const res = await fetch("/api/v1/users/me/2fa", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || t("Failed to disable two-factor authentication"));
      }
      twoFactorEnabled = false;
      twoFactorDisableConfirm = false;
      twoFactorDisableCode = "";
      otpAuthUrl = "";
      otpQrDataUrl = "";
      recoveryCodes = [];
      twoFactorSuccess = t("Two-factor authentication disabled");
      await invalidateAll();
    } catch (err: any) {
      twoFactorError = err?.message || t("Failed to disable two-factor authentication");
    } finally {
      twoFactorDisabling = false;
    }
  }

  async function verifyTwoFactor(e: SubmitEvent) {
    e.preventDefault();
    twoFactorVerifying = true;
    twoFactorError = "";
    twoFactorSuccess = "";
    recoveryCodes = [];
    try {
      const token = String(twoFactorToken || "")
        .replace(/\s+/g, "")
        .trim();
      if (!/^\d{6}$/.test(token)) throw new Error(t("Enter 6-digit code"));
      const res = await fetch("/api/v1/users/me/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || t("Failed to enable two-factor authentication"));
      }
      twoFactorEnabled = true;
      recoveryCodes = Array.isArray(body?.recoveryCodes) ? body.recoveryCodes.map((c: unknown) => String(c)) : [];
      twoFactorSuccess = t("Two-factor authentication enabled");
      otpAuthUrl = "";
      otpQrDataUrl = "";
      twoFactorToken = "";
      await invalidateAll();
    } catch (err: any) {
      twoFactorError = err?.message || t("Failed to enable two-factor authentication");
    } finally {
      twoFactorVerifying = false;
    }
  }

  const sections = [
    { id: "company", label: "Company", icon: Building2 },
    { id: "branding", label: "Branding", icon: Palette },
    { id: "appearance", label: "Appearance", icon: Sun },
    { id: "localization", label: "Localization", icon: Languages },
    {
      id: "templates",
      label: "Templates",
      icon: LayoutTemplate,
      condition: () => data.hasTemplates,
    },
    { id: "payments", label: "Payments", icon: CreditCard },
    { id: "tax", label: "Tax", icon: Percent },
    { id: "products", label: "Products", icon: Package },
    { id: "numbering", label: "Numbering", icon: Hash },
    { id: "xml", label: "XML Export", icon: FileCodeCorner },
    { id: "security", label: "Security", icon: Shield, condition: () => !demoMode },
  ];

  function getSectionUrl(id: string) {
    const url = new URL(page.url);
    url.searchParams.set("section", id);
    return url.toString();
  }
</script>

<div class="mb-4">
  <h1 class="text-2xl font-semibold">{t("Settings")}</h1>
</div>

{#if error || data.error}
  <div class="alert alert-error mb-4">
    <CircleAlert size={20} />
    <span>{error || data.error}</span>
  </div>
{/if}

{#if success}
  <div class="alert alert-success mb-4">
    <span>{success}</span>
  </div>
{/if}

<div class="grid grid-cols-1 gap-6 md:grid-cols-[16rem_1fr]">
  <aside class="hidden md:block">
    <ul class="menu bg-base-200 rounded-box w-full gap-1 p-2">
      {#each sections.filter((s) => (s.condition ? s.condition() : true)) as s (s.id)}
        <li>
          <a href={getSectionUrl(s.id)} class={section === s.id ? "active" : ""}>
            <s.icon size={20} class="mr-2" />
            {t(s.label)}
          </a>
        </li>
      {/each}
    </ul>
  </aside>

  <div class="md:hidden">
    <select class="select select-bordered w-full" onchange={(e) => (window.location.href = getSectionUrl(e.currentTarget.value))}>
      {#each sections.filter((s) => (s.condition ? s.condition() : true)) as s (s.id)}
        <option value={s.id} selected={section === s.id}>{t(s.label)}</option>
      {/each}
    </select>
  </div>

  <section class="space-y-4">
    {#if !canUpdateSettings}
      <div class="alert alert-warning mb-4">
        <CircleAlert size={16} />
        <span>{t("You do not have permission to modify settings.")}</span>
      </div>
    {/if}

    {#if section === "tax"}
      <form onsubmit={saveSettings} class="bg-base-100 rounded-box border-base-200 mb-6 max-w-4xl space-y-6 border p-6">
        <h2 class="text-xl font-semibold">{t("Tax Settings")}</h2>
        <label class="form-control"
          ><div class="label">
            <span class="label-text">{t("Tax Label")}</span>
          </div>
          <input type="text" class="input input-bordered w-full" bind:value={settings.taxLabel} disabled={!canUpdateSettings} />
        </label>
        <label class="form-control"
          ><div class="label">
            <span class="label-text">{t("Default Tax Rate")}</span>
          </div>
          <input type="number" class="input input-bordered w-full" bind:value={settings.defaultTaxRate} disabled={!canUpdateSettings} step="0.01" />
        </label>
        <label class="label cursor-pointer justify-start gap-4">
          <input type="checkbox" class="checkbox" bind:checked={settings.defaultPricesIncludeTax} disabled={!canUpdateSettings} />
          <span class="label-text">{t("Default Prices Include Tax")}</span>
        </label>
        <label class="form-control"
          ><div class="label">
            <span class="label-text">{t("Rounding Mode")}</span>
          </div>
          <input type="text" class="input input-bordered w-full" bind:value={settings.defaultRoundingMode} disabled={!canUpdateSettings} />
        </label>
        <div class="flex justify-end pt-4">
          <button type="submit" class="btn btn-primary" disabled={saving || !canUpdateSettings}><Save size={18} /> {t("Save Settings")}</button>
        </div>
      </form>
      <div class="bg-base-100 rounded-box border-base-200 max-w-4xl border p-6">
        <TaxDefinitionsManager taxDefinitions={data.taxDefinitions} />
      </div>
    {:else if section === "products"}
      <div class="bg-base-100 rounded-box border-base-200 max-w-4xl border p-6">
        <ProductOptionsManager productCategories={data.productCategories} productUnits={data.productUnits} />
      </div>
    {:else if section === "templates"}
      <div class="bg-base-100 rounded-box border-base-200 max-w-4xl border p-6">
        <TemplateOptionsManager templates={data.templates} />
      </div>
    {:else if section === "security"}
      <div class="bg-base-100 rounded-box border-base-200 max-w-4xl space-y-6 border p-6">
        <div class="space-y-2">
          <h2 class="text-xl font-semibold">{t("Security")}</h2>
          <p class="text-sm opacity-80">{t("Protect your account with two-factor authentication.")}</p>
        </div>

        <div class="alert {twoFactorEnabled ? 'alert-success' : 'alert-warning'}">
          <span>
            {twoFactorEnabled ? t("Two-factor authentication is enabled") : t("Two-factor authentication is not enabled")}
          </span>
        </div>

        {#if twoFactorError}
          <div class="alert alert-error"><span>{twoFactorError}</span></div>
        {/if}
        {#if twoFactorSuccess}
          <div class="alert alert-success"><span>{twoFactorSuccess}</span></div>
        {/if}

        <div class="flex flex-wrap gap-3">
          <button class="btn btn-primary" onclick={startTwoFactorSetup} disabled={twoFactorLoading || twoFactorDisabling}>
            {#if twoFactorLoading}
              <span class="loading loading-spinner loading-sm"></span>
            {/if}
            {twoFactorEnabled ? t("Reconfigure 2FA") : t("Set up 2FA")}
          </button>
          {#if twoFactorEnabled && !twoFactorDisableConfirm}
            <button class="btn btn-error btn-outline" onclick={() => (twoFactorDisableConfirm = true)} disabled={twoFactorLoading || twoFactorDisabling}>
              {t("Disable 2FA")}
            </button>
          {/if}
        </div>

        {#if twoFactorDisableConfirm}
          <div class="bg-base-200 rounded-box space-y-3 p-4">
            <p class="font-semibold">{t("Confirm disable two-factor authentication")}</p>
            <p class="text-sm opacity-80">{t("Enter your current 2FA code to confirm.")}</p>
            <form class="flex flex-wrap items-end gap-3" onsubmit={disableTwoFactor}>
              <label class="form-control">
                <div class="label"><span class="label-text">{t("2FA code")}</span></div>
                <input
                  class="input input-bordered input-sm w-40"
                  type="text"
                  bind:value={twoFactorDisableCode}
                  inputmode="numeric"
                  maxlength="6"
                  placeholder={t("Enter 6-digit code")}
                  required
                  disabled={twoFactorDisabling}
                  autocomplete="one-time-code"
                />
              </label>
              <div class="flex gap-2">
                <button type="submit" class="btn btn-error btn-sm" disabled={twoFactorDisabling}>
                  {#if twoFactorDisabling}
                    <span class="loading loading-spinner loading-sm"></span>
                  {/if}
                  {t("Yes, disable")}
                </button>
                <button
                  type="button"
                  class="btn btn-sm"
                  onclick={() => {
                    twoFactorDisableConfirm = false;
                    twoFactorDisableCode = "";
                  }}
                  disabled={twoFactorDisabling}
                >
                  {t("Cancel")}
                </button>
              </div>
            </form>
          </div>
        {/if}

        {#if otpQrDataUrl}
          <div class="space-y-3">
            <img src={otpQrDataUrl} alt={t("2FA QR code")} class="border-base-300 h-48 w-48 rounded border p-2" />
            <p class="text-xs break-all opacity-70">{otpAuthUrl}</p>
            <form class="max-w-sm space-y-3" onsubmit={verifyTwoFactor}>
              <label class="form-control">
                <div class="label">
                  <span class="label-text">{t("2FA code")}</span>
                </div>
                <input
                  class="input input-bordered"
                  type="text"
                  bind:value={twoFactorToken}
                  inputmode="numeric"
                  maxlength="6"
                  placeholder={t("Enter 6-digit code")}
                  required
                  disabled={twoFactorVerifying}
                />
              </label>
              <button type="submit" class="btn btn-success" disabled={twoFactorVerifying}>
                {#if twoFactorVerifying}
                  <span class="loading loading-spinner loading-sm"></span>
                {/if}
                {t("Verify and Enable 2FA")}
              </button>
            </form>
          </div>
        {/if}

        {#if recoveryCodes.length > 0}
          <div class="bg-base-200 rounded-box space-y-2 p-4">
            <p class="font-semibold">{t("Recovery codes (save these now)")}</p>
            <p class="text-sm opacity-80">{t("These codes are shown once and can be used if you lose access to your authenticator app.")}</p>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {#each recoveryCodes as code (code)}
                <code class="bg-base-100 rounded px-3 py-2">{code}</code>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {:else if section !== "templates" && section !== "products" && section !== "tax" && section !== "security"}
      <form onsubmit={saveSettings} class="bg-base-100 rounded-box border-base-200 max-w-4xl space-y-6 border p-6">
        {#if section === "company"}
          <div class="space-y-4">
            <h2 class="text-xl font-semibold">{t("Company Information")}</h2>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label class="form-control"
                ><div class="label">
                  <span class="label-text">{t("Company Name")}</span>
                </div>
                <input type="text" class="input input-bordered w-full" bind:value={settings.companyName} disabled={!canUpdateSettings} />
              </label>
              <label class="form-control"
                ><div class="label">
                  <span class="label-text">{t("Currency")}</span>
                </div>
                <input type="text" class="input input-bordered w-full" bind:value={settings.currency} disabled={!canUpdateSettings} />
              </label>
            </div>
            <label class="form-control"
              ><div class="label">
                <span class="label-text">{t("Company Address")}</span>
              </div>
              <textarea class="textarea textarea-bordered w-full" bind:value={settings.companyAddress} disabled={!canUpdateSettings}></textarea>
            </label>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label class="form-control"
                ><div class="label">
                  <span class="label-text">{t("City")}</span>
                </div>
                <input type="text" class="input input-bordered w-full" bind:value={settings.companyCity} disabled={!canUpdateSettings} />
              </label>
              <label class="form-control"
                ><div class="label">
                  <span class="label-text">{t("Postal Code")}</span>
                </div>
                <input type="text" class="input input-bordered w-full" bind:value={settings.companyPostalCode} disabled={!canUpdateSettings} />
              </label>
            </div>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label class="form-control"
                ><div class="label">
                  <span class="label-text">{t("Email")}</span>
                </div>
                <input type="email" class="input input-bordered w-full" bind:value={settings.companyEmail} disabled={!canUpdateSettings} />
              </label>
              <label class="form-control"
                ><div class="label">
                  <span class="label-text">{t("Phone")}</span>
                </div>
                <input type="text" class="input input-bordered w-full" bind:value={settings.companyPhone} disabled={!canUpdateSettings} />
              </label>
            </div>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label class="form-control"
                ><div class="label">
                  <span class="label-text">{t("Tax ID")}</span>
                </div>
                <input type="text" class="input input-bordered w-full" bind:value={settings.companyTaxId} disabled={!canUpdateSettings} />
              </label>
              <label class="form-control"
                ><div class="label">
                  <span class="label-text">{t("Country Code")}</span>
                </div>
                <input type="text" class="input input-bordered w-full" bind:value={settings.companyCountryCode} disabled={!canUpdateSettings} placeholder="US" />
              </label>
            </div>
          </div>
        {:else if section === "branding"}
          <BrandingManager {settings} templates={data.templates} {canUpdateSettings} />
        {:else if section === "appearance"}
          <div class="space-y-4">
            <h2 class="text-xl font-semibold">{t("Appearance")}</h2>
            <p>{t("Adjust the look and feel of the application.")}</p>
            <ThemeToggle />
          </div>
        {:else if section === "localization"}
          <div class="space-y-4">
            <h2 class="text-xl font-semibold">{t("Localization")}</h2>
            <label class="form-control"
              ><div class="label">
                <span class="label-text">{t("Language")}</span>
              </div>
              <select name="locale" class="select select-bordered w-full" bind:value={settings.locale} disabled={!canUpdateSettings}>
                <option value="en">{t("English")}</option>
                <option value="nl">{t("Nederlands")}</option>
                <option value="de">{t("Deutsch")}</option>
              </select>
            </label>
            <label class="form-control"
              ><div class="label">
                <span class="label-text">{t("Date Format")}</span>
              </div>
              <select class="select select-bordered w-full" bind:value={settings.dateFormat} disabled={!canUpdateSettings}>
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                <option value="DD.MM.YYYY">DD.MM.YYYY</option>
              </select>
            </label>
            <label class="form-control"
              ><div class="label">
                <span class="label-text">{t("Number Format")}</span>
              </div>
              <select class="select select-bordered w-full" bind:value={settings.numberFormat} disabled={!canUpdateSettings}>
                <option value="comma">1,000.00</option>
                <option value="period">1.000,00</option>
              </select>
            </label>
            <label class="form-control"
              ><div class="label">
                <span class="label-text">{t("Postal/City Format")}</span>
              </div>
              <select class="select select-bordered w-full" bind:value={settings.postalCityFormat} disabled={!canUpdateSettings}>
                <option value="auto">{t("Auto (from country)")}</option>
                <option value="postal-city">{t("Postal Code + City")}</option>
                <option value="city-postal">{t("City + Postal Code")}</option>
              </select>
            </label>
          </div>
        {:else if section === "payments"}
          <div class="space-y-4">
            <h2 class="text-xl font-semibold">{t("Payments & Texts")}</h2>
            <div class="alert alert-warning">
              <CircleAlert size={16} />
              <span>{t("Allowing edits/deletes for sent or paid invoices can violate invoice retention laws. Only enable this if you understand the legal impact.")}</span>
            </div>
            <label class="label cursor-pointer justify-start gap-4">
              <input type="checkbox" class="checkbox" bind:checked={settings.allowProtectedInvoiceChanges} disabled={!canUpdateSettings} />
              <span class="label-text">{t("Allow editing and deleting sent/paid invoices")}</span>
            </label>
            <label class="form-control"
              ><div class="label">
                <span class="label-text">{t("Payment Methods")}</span>
              </div>
              <textarea class="textarea textarea-bordered w-full" bind:value={settings.paymentMethods} disabled={!canUpdateSettings}></textarea>
            </label>
            <label class="form-control"
              ><div class="label">
                <span class="label-text">{t("Bank Account")}</span>
              </div>
              <textarea class="textarea textarea-bordered w-full" bind:value={settings.bankAccount} disabled={!canUpdateSettings}></textarea>
            </label>
            <label class="form-control"
              ><div class="label">
                <span class="label-text">{t("Payment Terms")}</span>
              </div>
              <textarea class="textarea textarea-bordered w-full" bind:value={settings.paymentTerms} disabled={!canUpdateSettings}></textarea>
            </label>
            <label class="form-control"
              ><div class="label">
                <span class="label-text">{t("Default Notes")}</span>
              </div>
              <textarea class="textarea textarea-bordered w-full" bind:value={settings.defaultNotes} disabled={!canUpdateSettings}></textarea>
            </label>
          </div>
        {:else if section === "numbering"}
          <div class="space-y-4">
            <h2 class="text-xl font-semibold">{t("Numbering")}</h2>
            <label class="label cursor-pointer justify-start gap-4">
              <input type="checkbox" class="checkbox" bind:checked={settings.invoiceNumberingEnabled} disabled={!canUpdateSettings} />
              <span class="label-text">{t("Enable Automatic Invoice Numbering")}</span>
            </label>
            <label class="form-control"
              ><div class="label">
                <span class="label-text">{t("Invoice Number Pattern")}</span>
              </div>
              <input type="text" class="input input-bordered w-full" bind:value={settings.invoiceNumberPattern} disabled={!canUpdateSettings} placeholder={"INV-{YYYY}-{SEQ}"} />
              <div class="mt-2 space-y-1 text-xs opacity-70">
                <p>{t("Available placeholders")}:</p>
                <p>
                  <code>{"{SEQ}"}</code> (sequential, recommended),
                  <code>{"{YYYY}"}</code>, <code>{"{YY}"}</code>,
                  <code>{"{MM}"}</code>, <code>{"{DD}"}</code>,
                  <code>{"{DATE}"}</code>, <code>{"{RAND4}"}</code>
                </p>
              </div>
            </label>
          </div>
        {:else if section === "xml"}
          <div class="space-y-4">
            <h2 class="text-xl font-semibold">{t("XML Export")}</h2>
            <label class="form-control"
              ><div class="label">
                <span class="label-text">{t("XML Profile ID")}</span>
              </div>
              <select class="select select-bordered w-full" bind:value={settings.xmlProfileId} disabled={!canUpdateSettings}>
                {#if xmlProfiles.length > 0}
                  {#each xmlProfiles as profile (profile.id)}
                    <option value={profile.id}>{profile.name} ({profile.id})</option>
                  {/each}
                {:else}
                  <option value="ubl21">UBL 2.1 (PEPPOL BIS Billing 3.0) (ubl21)</option>
                  <option value="facturx22">Factur-X / ZUGFeRD 2.2 (EN 16931) (facturx22)</option>
                  <option value="fatturapa">FatturaPA (Italian eInvoice) (fatturapa)</option>
                {/if}
              </select>
            </label>
            <label class="label cursor-pointer justify-start gap-4">
              <input type="checkbox" class="checkbox" bind:checked={settings.embedXmlInPdf} disabled={!canUpdateSettings} />
              <span class="label-text">{t("Embed XML in PDF")}</span>
            </label>
            <label class="label cursor-pointer justify-start gap-4">
              <input type="checkbox" class="checkbox" bind:checked={settings.embedXmlInHtml} disabled={!canUpdateSettings} />
              <span class="label-text">{t("Embed XML in HTML")}</span>
            </label>
          </div>
        {/if}

        <div class="border-base-200 mt-6 flex justify-end gap-3 border-t pt-4">
          <button type="submit" class="btn btn-primary" disabled={saving || !canUpdateSettings}>
            {#if saving}
              <span class="loading loading-spinner loading-sm"></span>
            {:else}
              <Save size={18} />
            {/if}
            {t("Save Settings")}
          </button>
        </div>
      </form>
    {/if}
  </section>
</div>
