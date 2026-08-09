<script lang="ts">
  import { onMount } from 'svelte';

  const themes = [
    { value: 'blue', label: 'Cloud blue', color: '#126bfa' },
    { value: 'graphite', label: 'Graphite', color: '#24262b' },
    { value: 'violet', label: 'Violet', color: '#7357d9' },
    { value: 'forest', label: 'Forest', color: '#16845b' },
    { value: 'amber', label: 'Amber', color: '#c4630c' }
  ] as const;

  let selected = $state<(typeof themes)[number]['value']>('blue');

  onMount(() => {
    const saved = document.documentElement.dataset.accent;
    if (themes.some((theme) => theme.value === saved)) {
      selected = saved as (typeof themes)[number]['value'];
    }
  });

  function select(value: (typeof themes)[number]['value']) {
    selected = value;
    if (value === 'blue') {
      delete document.documentElement.dataset.accent;
      localStorage.removeItem('studysky-accent');
      return;
    }
    document.documentElement.dataset.accent = value;
    localStorage.setItem('studysky-accent', value);
  }
</script>

<div class="theme-grid" role="radiogroup" aria-label="Interface colour">
  {#each themes as theme}
    <button
      class:selected={selected === theme.value}
      class="theme-option"
      type="button"
      role="radio"
      aria-checked={selected === theme.value}
      onclick={() => select(theme.value)}
    >
      <span class="swatch" style={`--swatch: ${theme.color}`}></span>
      <span>{theme.label}</span>
      <span class="check" aria-hidden="true">{selected === theme.value ? '✓' : ''}</span>
    </button>
  {/each}
</div>

<style>
  .theme-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
  }

  .theme-option {
    display: grid;
    min-width: 0;
    min-height: 74px;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--text);
    background: var(--surface);
    font-size: 12px;
    text-align: left;
  }

  .theme-option:hover {
    border-color: var(--border-strong);
    background: var(--surface-hover);
  }

  .theme-option.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .swatch {
    width: 24px;
    height: 24px;
    border: 1px solid color-mix(in srgb, var(--swatch) 80%, black);
    border-radius: 6px;
    background: var(--swatch);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25);
  }

  .check {
    color: var(--accent);
    font-weight: 700;
  }

  @media (max-width: 900px) {
    .theme-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 480px) {
    .theme-grid {
      grid-template-columns: 1fr;
    }

    .theme-option {
      min-height: 48px;
    }
  }
</style>
