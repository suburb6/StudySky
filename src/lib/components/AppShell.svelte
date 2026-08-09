<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import type { Component, Snippet } from 'svelte';
  import type { LucideProps } from '@lucide/svelte';
  import {
    Bell,
    BookOpen,
    CalendarDays,
    CheckSquare2,
    Focus,
    Menu,
    Moon,
    MoreHorizontal,
    RefreshCw,
    Search,
    Settings,
    Sun
  } from '@lucide/svelte';
  import OnlineStatus from './OnlineStatus.svelte';
  import OfflineSync from './OfflineSync.svelte';
  import { clearActiveOfflineAccount, setActiveOfflineAccount } from '$lib/offline/queue';

  type IconComponent = Component<LucideProps>;
  type NavItem = { href: string; label: string; icon: IconComponent };

  let {
    user,
    children,
    unreadNotifications = 0
  }: {
    user: NonNullable<App.Locals['user']>;
    children: Snippet;
    unreadNotifications?: number;
  } = $props();

  const mainNav: NavItem[] = [
    { href: '/today', label: 'Today', icon: Focus },
    { href: '/modules', label: 'Modules', icon: BookOpen },
    { href: '/tasks', label: 'Tasks', icon: CheckSquare2 },
    { href: '/timetable', label: 'Timetable', icon: CalendarDays },
    { href: '/search', label: 'Search', icon: Search },
    { href: '/notifications', label: 'Notifications', icon: Bell },
    { href: '/settings', label: 'Settings', icon: Settings }
  ];
  const mobilePrimary = ['/today', '/modules', '/tasks', '/timetable'];
  let dark = $state(false);

  onMount(() => {
    void setActiveOfflineAccount(user.id).catch(() => undefined);
    dark = document.documentElement.dataset.theme === 'dark';
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        void goto('/search').then(() => {
          requestAnimationFrame(() =>
            document.querySelector<HTMLInputElement>('#search-query')?.focus()
          );
        });
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  });

  function active(href: string): boolean {
    return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
  }

  function toggleTheme(): void {
    dark = !dark;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('studysky-theme', dark ? 'dark' : 'light');
  }

  async function prepareSignOut(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement | null;
    if (!form) return;
    try {
      await clearActiveOfflineAccount(user.id);
    } finally {
      form.submit();
    }
  }
</script>

<div class="app-shell">
  <aside class="sidebar" aria-label="Workspace sidebar">
    <a class="workspace" href="/today">
      <span class="workspace-icon"><BookOpen size={18} strokeWidth={1.8} /></span>
      <span class="workspace-name">StudySky</span>
    </a>

    <nav class="nav-list" aria-label="Primary navigation">
      {#each mainNav as item}
        {@const Icon = item.icon}
        {#if item.href === '/search'}<span class="nav-divider" aria-hidden="true"></span>{/if}
        <a class:active={active(item.href)} class="nav-item" href={item.href}>
          <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
          <span>{item.label}</span>
          {#if item.href === '/search'}<kbd class="nav-shortcut">⌘K</kbd>{/if}
          {#if item.href === '/notifications' && unreadNotifications > 0}
            <span class="nav-badge" aria-label={`${unreadNotifications} unread notifications`}>
              {unreadNotifications > 9 ? '9+' : unreadNotifications}
            </span>
          {/if}
        </a>
      {/each}
    </nav>

    <div class="sidebar-footer">
      <div class="sidebar-status"><OnlineStatus /></div>
      <button class="nav-item theme-button" type="button" onclick={toggleTheme}>
        {#if dark}
          <Sun size={17} aria-hidden="true" />
          <span>Light mode</span>
        {:else}
          <Moon size={17} aria-hidden="true" />
          <span>Dark mode</span>
        {/if}
      </button>
      <div class="user-row">
        <span class="avatar" aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span>
        <span class="user-copy">
          <strong>{user.name}</strong>
          <small>{user.email}</small>
        </span>
        <form method="POST" action="/logout" onsubmit={prepareSignOut}>
          <button class="icon-quiet" title="Sign out" aria-label="Sign out" type="submit">
            <RefreshCw size={15} aria-hidden="true" />
          </button>
        </form>
      </div>
    </div>
  </aside>

  <section class="workspace-content">
    <main id="main-content">
      {@render children()}
    </main>
  </section>

  <nav class="mobile-nav" aria-label="Mobile navigation">
    {#each mainNav.filter((item) => mobilePrimary.includes(item.href)) as item}
      {@const Icon = item.icon}
      <a class:active={active(item.href)} class="mobile-nav-item" href={item.href}>
        <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
        <span>{item.label}</span>
      </a>
    {/each}
    <details class="mobile-more">
      <summary class="mobile-nav-item">
        <MoreHorizontal size={20} aria-hidden="true" />
        <span>More</span>
      </summary>
      <div class="mobile-more-menu">
        <p class="eyebrow">StudySky</p>
        {#each mainNav.filter((item) => !mobilePrimary.includes(item.href)) as item}
          {@const Icon = item.icon}
          {#if item.href === '/search'}<span class="nav-divider" aria-hidden="true"></span>{/if}
          <a class:active={active(item.href)} class="nav-item" href={item.href}>
            <Icon size={18} aria-hidden="true" />
            <span>{item.label}</span>
            {#if item.href === '/notifications' && unreadNotifications > 0}
              <span class="nav-badge" aria-label={`${unreadNotifications} unread notifications`}>
                {unreadNotifications > 9 ? '9+' : unreadNotifications}
              </span>
            {/if}
          </a>
        {/each}
        <div class="mobile-status"><OnlineStatus /></div>
        <button class="nav-item" type="button" onclick={toggleTheme}>
          {#if dark}<Sun size={18} />{:else}<Moon size={18} />{/if}
          <span>{dark ? 'Light mode' : 'Dark mode'}</span>
        </button>
        <form method="POST" action="/logout" onsubmit={prepareSignOut}>
          <button class="nav-item" type="submit">
            <Menu size={18} />
            <span>Sign out</span>
          </button>
        </form>
      </div>
    </details>
  </nav>
  <OfflineSync ownerUserId={user.id} />
</div>

<style>
  .app-shell {
    min-height: 100vh;
  }

  .sidebar {
    position: fixed;
    z-index: 20;
    inset: 0 auto 0 0;
    display: flex;
    width: var(--sidebar-width);
    flex-direction: column;
    padding: 8px;
    border-right: 1px solid var(--border);
    background: var(--sidebar);
  }

  .workspace {
    display: flex;
    min-height: 44px;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 6px;
    font-weight: 650;
  }

  .workspace:hover {
    background: var(--surface-hover);
  }

  .workspace-icon {
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border-radius: 6px;
    color: var(--accent-text);
    background: var(--accent);
  }

  .nav-list {
    display: grid;
    min-height: 0;
    overflow-y: auto;
    gap: 2px;
    margin-top: 14px;
    padding-bottom: 8px;
  }

  .nav-item {
    position: relative;
    display: flex;
    width: 100%;
    min-height: 36px;
    align-items: center;
    gap: 10px;
    padding: 6px 9px;
    border: 0;
    border-radius: 6px;
    color: var(--text-soft);
    background: transparent;
    font-size: 13px;
    text-align: left;
  }

  .nav-item:hover,
  .nav-item.active {
    color: var(--text);
    background: var(--surface-hover);
  }

  .nav-item.active {
    font-weight: 600;
  }

  .nav-divider {
    display: block;
    height: 1px;
    margin: 8px 9px 6px;
    background: var(--border);
  }

  .nav-shortcut {
    margin-left: auto;
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-faint);
    background: transparent;
    font: inherit;
    font-size: 9px;
  }

  .nav-badge {
    display: grid;
    min-width: 18px;
    height: 18px;
    margin-left: auto;
    place-items: center;
    padding: 0 5px;
    border-radius: 999px;
    color: white;
    background: var(--danger);
    font-size: 9px;
    font-weight: 700;
  }

  .sidebar-footer {
    display: grid;
    gap: 4px;
    margin-top: auto;
  }

  .sidebar-status,
  .mobile-status {
    display: flex;
    min-height: 32px;
    align-items: center;
    padding: 0 9px;
  }

  .sidebar-status :global(.sync-status),
  .mobile-status :global(.sync-status) {
    width: 100%;
  }

  .theme-button {
    font-weight: 400;
  }

  .user-row {
    display: flex;
    min-height: 48px;
    align-items: center;
    gap: 9px;
    padding: 6px;
    border-top: 1px solid var(--border);
  }

  .avatar {
    display: grid;
    width: 28px;
    height: 28px;
    flex: 0 0 auto;
    place-items: center;
    border-radius: 6px;
    color: var(--text-soft);
    background: var(--surface-pressed);
    font-size: 12px;
    font-weight: 700;
  }

  .user-copy {
    display: grid;
    min-width: 0;
    flex: 1;
  }

  .user-copy strong,
  .user-copy small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .user-copy strong {
    font-size: 12px;
  }

  .user-copy small {
    color: var(--text-faint);
    font-size: 10px;
  }

  .icon-quiet {
    position: relative;
    display: grid;
    width: 34px;
    height: 34px;
    padding: 0;
    place-items: center;
    border: 0;
    border-radius: 6px;
    color: var(--text-soft);
    background: transparent;
  }

  .icon-quiet:hover {
    color: var(--text);
    background: var(--surface-hover);
  }

  .workspace-content {
    min-width: 0;
    min-height: 100vh;
    margin-left: var(--sidebar-width);
  }

  .mobile-nav {
    display: none;
  }

  @media (max-width: 760px) {
    .sidebar {
      display: none;
    }

    .workspace-content {
      margin-left: 0;
    }

    .mobile-nav {
      position: fixed;
      z-index: 30;
      right: 0;
      bottom: 0;
      left: 0;
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      min-height: calc(68px + env(safe-area-inset-bottom));
      padding: 5px 5px calc(5px + env(safe-area-inset-bottom));
      border-top: 1px solid var(--border);
      background: color-mix(in srgb, var(--surface) 96%, transparent);
      box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.04);
      backdrop-filter: blur(14px);
    }

    .mobile-nav-item {
      display: flex;
      min-width: 0;
      min-height: 56px;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 3px;
      padding: 4px 2px;
      border: 0;
      border-radius: 8px;
      color: var(--text-faint);
      background: transparent;
      font-size: 10px;
      list-style: none;
    }

    .mobile-nav-item.active {
      color: var(--text);
      background: var(--surface-hover);
    }

    .mobile-more {
      position: relative;
    }

    .mobile-more[open] > summary {
      color: var(--text);
      background: var(--surface-hover);
    }

    .mobile-more-menu {
      position: fixed;
      right: 10px;
      bottom: calc(72px + env(safe-area-inset-bottom));
      width: min(280px, calc(100vw - 20px));
      max-height: calc(100dvh - 92px - env(safe-area-inset-bottom));
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 12px;
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      background: var(--surface);
      box-shadow: 0 14px 44px rgba(0, 0, 0, 0.16);
    }

    .mobile-more-menu .eyebrow {
      padding: 2px 9px 8px;
    }

    .mobile-more-menu .nav-item {
      min-height: 44px;
    }
  }
</style>
