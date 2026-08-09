<script lang="ts">
  import { ArrowLeft } from '@lucide/svelte';
  import type { Snippet } from 'svelte';

  let {
    title,
    description,
    backHref,
    backLabel = 'Back',
    actions
  }: {
    eyebrow?: string;
    title: string;
    description?: string;
    backHref?: string;
    backLabel?: string;
    actions?: Snippet;
  } = $props();
</script>

<header class="page-header">
  <div class="page-header-copy">
    {#if backHref}
      <a class="page-back-link" href={backHref} aria-label={backLabel} title={backLabel}>
        <ArrowLeft size={14} aria-hidden="true" />
        <span>{backLabel}</span>
      </a>
    {/if}
    <h1>{title}</h1>
    {#if description}<p class="lede">{description}</p>{/if}
  </div>
  {#if actions}<div class="page-header-actions">{@render actions()}</div>{/if}
</header>
