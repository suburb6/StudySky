<script lang="ts">
  import { BookOpen } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { clearActiveOfflineAccount } from '$lib/offline/queue';

  let { form } = $props();

  onMount(() => {
    void clearActiveOfflineAccount().catch(() => undefined);
  });
</script>

<svelte:head>
  <title>Sign in · StudySky</title>
  <meta name="description" content="Sign in to your private StudySky study workspace." />
</svelte:head>

<main id="main-content" class="login-page">
  <div class="login-shell">
    <a class="brand" href="/login" aria-label="StudySky">
      <span class="brand-mark" aria-hidden="true">
        <BookOpen size={20} strokeWidth={2} />
      </span>
      <span>StudySky</span>
    </a>

    <section class="login-panel" aria-labelledby="login-title">
      <h1 id="login-title">Sign in</h1>

      <form method="POST" class="login-form">
        {#if form?.error}
          <p class="error-message" role="alert">{form.error}</p>
        {/if}
        <div class="field">
          <label for="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autocomplete="username"
            value={form?.email ?? ''}
            required
          />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
          />
        </div>
        <button class="button button-primary login-button" type="submit">Sign in</button>
      </form>
    </section>
  </div>
</main>

<style>
  .login-page {
    display: grid;
    min-height: 100vh;
    place-items: center;
    padding: 24px;
    background: var(--surface);
  }

  .login-shell {
    width: min(100%, 400px);
  }

  .brand {
    display: flex;
    width: fit-content;
    align-items: center;
    gap: 10px;
    margin: 0 auto 28px;
    font-size: 18px;
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  .login-panel {
    padding: 32px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
  }

  .brand-mark {
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    border-radius: 7px;
    color: var(--accent-text);
    background: var(--accent);
  }

  h1 {
    margin-bottom: 24px;
    font-size: 22px;
    text-align: center;
  }

  .login-form {
    display: grid;
    gap: 18px;
  }

  .login-button {
    width: 100%;
    min-height: 44px;
    margin-top: 2px;
  }

  @media (max-width: 480px) {
    .login-page {
      place-items: start center;
      padding: 56px 20px 24px;
    }

    .login-panel {
      padding: 0;
      border: 0;
    }

    .brand {
      margin-bottom: 44px;
    }
  }
</style>
