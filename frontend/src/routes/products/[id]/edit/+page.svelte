<script lang="ts">
  import { getContext } from "svelte";
  import { Save } from "lucide-svelte";
  import { enhance } from "$app/forms";

  let { data, form } = $props();
  let t = getContext("i18n") as (key: string) => string;
  let p = $derived(data.product || {});
</script>

{#if p.id}
  <form method="post" use:enhance>
    <div class="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
      <h1 class="text-2xl font-semibold">{t("Edit Product")}</h1>
      <div class="flex w-full items-center gap-2 sm:w-auto">
        <a href={`/products/${p.id}`} class="btn btn-ghost btn-sm flex-1 sm:flex-none">
          {t("Cancel")}
        </a>
        <button type="submit" class="btn btn-primary btn-sm flex-1 sm:flex-none">
          <Save size={16} />
          {t("Save Changes")}
        </button>
      </div>
    </div>

    {#if form?.error || data.error}
      <div class="alert alert-error mb-4">
        <span>{form?.error || data.error}</span>
      </div>
    {/if}

    <div class="space-y-4">
      <div class="form-control w-full">
        <label class="label cursor-pointer justify-start gap-3 pb-1">
          <input type="checkbox" name="isActive" class="toggle toggle-success" value="true" checked={p.isActive !== false} />
          <span class="label-text">{t("Active (Available in dropdowns)")}</span>
        </label>
      </div>

      <div class="form-control w-full">
        <label class="label pb-1" for="name">
          <span class="label-text">
            {t("Name")} <span class="text-error">*</span>
          </span>
        </label>
        <input type="text" id="name" name="name" class="input input-sm input-bordered w-full" value={p.name} required />
      </div>

      <div class="form-control w-full">
        <label class="label pb-1" for="description">
          <span class="label-text">{t("Description")}</span>
        </label>
        <textarea id="description" name="description" class="textarea textarea-bordered w-full" rows="3" value={p.description}></textarea>
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="form-control w-full">
          <label class="label pb-1" for="unitPrice">
            <span class="label-text">
              {t("Unit Price")} <span class="text-error">*</span>
            </span>
          </label>
          <input type="number" id="unitPrice" name="unitPrice" step="0.01" min="0" class="input input-sm input-bordered w-full" value={p.unitPrice} required />
        </div>

        <div class="form-control w-full">
          <label class="label pb-1" for="sku">
            <span class="label-text">{t("SKU")}</span>
          </label>
          <input type="text" id="sku" name="sku" class="input input-sm input-bordered w-full" value={p.sku} />
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="form-control w-full">
          <label class="label pb-1" for="unit">
            <span class="label-text">{t("Unit")}</span>
          </label>
          <select id="unit" name="unit" class="select select-sm select-bordered w-full" value={p.unit || ""}>
            <option value="">{t("Select unit")}</option>
            {#if data.units}
              {#each data.units as u (u.id)}
                <option value={u.code}>{u.name}</option>
              {/each}
            {/if}
          </select>
        </div>

        <div class="form-control w-full">
          <label class="label pb-1" for="category">
            <span class="label-text">{t("Category")}</span>
          </label>
          <select id="category" name="category" class="select select-sm select-bordered w-full" value={p.category || ""}>
            <option value="">{t("Select category")}</option>
            {#if data.categories}
              {#each data.categories as c (c.id)}
                <option value={c.code}>{c.name}</option>
              {/each}
            {/if}
          </select>
        </div>
      </div>

      {#if data.taxDefinitions && data.taxDefinitions.length > 0}
        <div class="form-control w-full pr-0 sm:w-1/2 sm:pr-2">
          <label class="label pb-1" for="taxDefinitionId">
            <span class="label-text">{t("Tax Definition")}</span>
          </label>
          <select id="taxDefinitionId" name="taxDefinitionId" class="select select-sm select-bordered w-full" value={p.taxDefinitionId || ""}>
            <option value="">{t("No default tax")}</option>
            {#each data.taxDefinitions as tax (tax.id)}
              <option value={tax.id}>
                {tax.name || tax.code || `${tax.percent}%`} ({tax.percent}%)
              </option>
            {/each}
          </select>
        </div>
      {/if}

      <div class="divider text-sm opacity-70">{t("Shipping & Customs")}</div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="form-control w-full">
          <label class="label pb-1" for="hsCode">
            <span class="label-text">{t("HS Code")}</span>
          </label>
          <input type="text" id="hsCode" name="hsCode" maxlength="16" class="input input-sm input-bordered w-full" value={p.hsCode ?? ""} />
        </div>

        <div class="form-control w-full">
          <label class="label pb-1" for="countryOfOrigin">
            <span class="label-text">{t("Country of Origin")}</span>
          </label>
          <input type="text" id="countryOfOrigin" name="countryOfOrigin" maxlength="2" pattern={"[A-Za-z]{2}"} placeholder={t("Country code placeholder")} class="input input-sm input-bordered w-full uppercase" value={p.countryOfOrigin ?? ""} />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div class="form-control w-full">
          <label class="label pb-1" for="lengthMm">
            <span class="label-text">{t("Length (mm)")}</span>
          </label>
          <input type="number" id="lengthMm" name="lengthMm" step="any" min="0" class="input input-sm input-bordered w-full" value={p.lengthMm ?? ""} />
        </div>
        <div class="form-control w-full">
          <label class="label pb-1" for="widthMm">
            <span class="label-text">{t("Width (mm)")}</span>
          </label>
          <input type="number" id="widthMm" name="widthMm" step="any" min="0" class="input input-sm input-bordered w-full" value={p.widthMm ?? ""} />
        </div>
        <div class="form-control w-full">
          <label class="label pb-1" for="heightMm">
            <span class="label-text">{t("Height (mm)")}</span>
          </label>
          <input type="number" id="heightMm" name="heightMm" step="any" min="0" class="input input-sm input-bordered w-full" value={p.heightMm ?? ""} />
        </div>
        <div class="form-control w-full">
          <label class="label pb-1" for="weightG">
            <span class="label-text">{t("Weight (g)")}</span>
          </label>
          <input type="number" id="weightG" name="weightG" step="any" min="0" class="input input-sm input-bordered w-full" value={p.weightG ?? ""} />
        </div>
      </div>
    </div>
  </form>
{:else if data.error}
  <div class="alert alert-error">
    <span>{data.error}</span>
  </div>
{/if}
