<script lang="ts">
  let { settings, t, canUpdateSettings } = $props<{
    settings: any;
    t: any;
    canUpdateSettings: boolean;
  }>();
</script>

<div class="space-y-4">
  <h2 class="text-xl font-semibold">{t("Company Information")}</h2>
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Company Name")}</span>
      </div>
      <input type="text" class="input input-bordered w-full" bind:value={settings.companyName} disabled={!canUpdateSettings} />
    </label>
    <label class="form-control">
      <div class="label"><span class="label-text">{t("Currency")}</span></div>
      <input type="text" class="input input-bordered w-full" bind:value={settings.currency} disabled={!canUpdateSettings} placeholder="USD" />
    </label>
  </div>

  <label class="form-control">
    <div class="label">
      <span class="label-text">{t("Company Address")}</span>
    </div>
    <textarea class="textarea textarea-bordered h-24 w-full" bind:value={settings.companyAddress} disabled={!canUpdateSettings}></textarea>
  </label>

  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <label class="form-control">
      <div class="label"><span class="label-text">{t("City")}</span></div>
      <input type="text" class="input input-bordered w-full" bind:value={settings.companyCity} disabled={!canUpdateSettings} />
    </label>
    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Postal Code")}</span>
      </div>
      <input type="text" class="input input-bordered w-full" bind:value={settings.companyPostalCode} disabled={!canUpdateSettings} />
    </label>
  </div>

  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <label class="form-control">
      <div class="label"><span class="label-text">{t("Email")}</span></div>
      <input type="email" class="input input-bordered w-full" bind:value={settings.companyEmail} disabled={!canUpdateSettings} />
    </label>
    <label class="form-control">
      <div class="label"><span class="label-text">{t("Phone")}</span></div>
      <input type="text" class="input input-bordered w-full" bind:value={settings.companyPhone} disabled={!canUpdateSettings} />
    </label>
  </div>

  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <label class="form-control">
      <div class="label"><span class="label-text">{t("Tax ID")}</span></div>
      <input type="text" class="input input-bordered w-full" bind:value={settings.companyTaxId} disabled={!canUpdateSettings} />
    </label>
    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Country Code")}</span>
      </div>
      <input type="text" class="input input-bordered w-full" bind:value={settings.companyCountryCode} disabled={!canUpdateSettings} placeholder="US" />
    </label>
  </div>
</div>
