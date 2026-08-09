<script lang="ts">
  import AppShell from '$lib/components/AppShell.svelte';

  let { data, children } = $props();
</script>

<AppShell user={data.user} unreadNotifications={data.unreadNotifications}>
  {@render children()}
</AppShell>
