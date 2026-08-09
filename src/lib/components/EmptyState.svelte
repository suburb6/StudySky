<script lang="ts">
  import { Inbox } from '@lucide/svelte';
  import type { Snippet } from 'svelte';

  let { title, description, action }: { title: string; description: string; action?: Snippet } =
    $props();
</script>

<div class="empty-state">
  <div>
    <Inbox size={28} strokeWidth={1.5} aria-hidden="true" />
    <h2>{title}</h2>
    <p>{description}</p>
    {#if action}{@render action()}{/if}
  </div>
</div>
