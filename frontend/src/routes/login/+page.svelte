<script lang="ts">
  import { page } from "$app/state";
  import { getContext } from "svelte";
  import { enhance } from "$app/forms";

  let { form } = $props();

  let t = getContext("i18n") as (key: string, params?: Record<string, string>) => string;

  let isLoading = $state(false);
  let oidcLoading = $state(false);
</script>

<div class="hero bg-base-200 min-h-[80vh]">
  <div class="hero-content w-full max-w-md flex-col">
    <div class="card bg-base-100 border-base-300 w-full shrink-0 border shadow-xl">
      <div class="card-body">
        <h2 class="mb-2 text-center text-2xl font-semibold">
          {t("Welcome to Invio")}
        </h2>
        {#if page.data.demoMode == true}
          <div role="alert" class="alert alert-info">
            <span class="text-center">
              Invio is running in demo mode, log in using the following username and password:
              <br class="mb-2" />
              Username: <span class="font-medium">demo</span>
              <br />
              Password: <span class="font-medium">demo</span>
            </span>
          </div>
        {/if}

        {#if page.data.oidcError}
          <div class="alert alert-error mb-3">
            <span>{page.data.oidcError}</span>
          </div>
        {/if}

        {#if page.data.oidcEnabled && !form?.twoFactorRequired}
          <form
            method="POST"
            action="?/oidcLogin"
            use:enhance={() => {
              oidcLoading = true;
              return async ({ update }) => {
                await update();
                oidcLoading = false;
              };
            }}
          >
            <button
              class="btn btn-outline w-full mb-4"
              type="submit"
              disabled={oidcLoading || isLoading}
            >
              {#if oidcLoading}
                <span class="loading loading-spinner"></span>
              {/if}
              {t("Login with SSO")}
            </button>
          </form>
          <div class="divider">{t("or")}</div>
        {/if}

        <form
          method="POST"
          action="?/login"
          enctype="multipart/form-data"
          use:enhance={() => {
            isLoading = true;
            return async ({ update }) => {
              await update();
              isLoading = false;
            };
          }}
        >
          {#if form?.error}
            <div class="alert alert-error mb-3">
              <span>{t(form.error, (form as any)?.errorParams)}</span>
            </div>
          {/if}

          {#if form?.twoFactorRequired}
            <input type="hidden" name="twoFactorToken" value={form?.twoFactorToken ?? ""} />
            <input type="hidden" name="username" value={form?.username ?? ""} />
          {/if}

          {#if !form?.twoFactorRequired}
            <div class="form-control">
              <label class="label" for="username">
                <span class="label-text">{t("Username")}</span>
              </label>
              <input
                id="username"
                type="text"
                name="username"
                placeholder={t("Enter your username")}
                class="input input-bordered w-full"
                value={form?.username ?? ""}
                autocomplete="username"
                required
                disabled={isLoading}
              />
            </div>

            <div class="form-control mt-2">
              <label class="label" for="password">
                <span class="label-text">{t("Password")}</span>
              </label>
              <input
                id="password"
                type="password"
                name="password"
                placeholder={t("Enter your password")}
                class="input input-bordered w-full"
                autocomplete="current-password"
                required
                disabled={isLoading}
              />
            </div>
          {:else}
            <div class="alert alert-info mb-2">
              <span>{t("Two-factor authentication required")}</span>
            </div>
            <div class="form-control">
              <label class="label" for="token">
                <span class="label-text">{t("2FA code")}</span>
              </label>
              <input id="token" type="text" name="token" placeholder={t("Enter 6-digit code")} class="input input-bordered w-full" inputmode="numeric" maxlength="6" disabled={isLoading} />
            </div>

            <div class="divider">{t("or")}</div>

            <div class="form-control mt-2">
              <label class="label" for="recoveryCode">
                <span class="label-text">{t("Recovery code")}</span>
              </label>
              <input id="recoveryCode" type="text" name="recoveryCode" placeholder={t("Enter recovery code")} class="input input-bordered w-full" autocomplete="one-time-code" disabled={isLoading} />
            </div>
          {/if}

          <div class="form-control mt-6">
            <button class="btn btn-primary w-full" type="submit" disabled={isLoading}>
              {#if isLoading}
                <span class="loading loading-spinner"></span>
              {/if}
              {t("Login")}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</div>
