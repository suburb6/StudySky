/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';
import {
  addOfflineRecord,
  appendOfflineUploadMetadata,
  deleteOfflineRecord,
  getActiveOfflineAccount,
  listOfflineRecords
} from '$lib/offline/queue';

declare const self: ServiceWorkerGlobalScope;

const CACHE = `studysky-shell-${version}`;
const PRECACHE_ASSETS = [
  ...new Set([
    ...files.filter((file) => !file.startsWith('/ocr-runtime/')),
    '/offline.html',
    '/manifest.webmanifest',
    '/favicon.svg'
  ])
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE_ASSETS)));
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('studysky-shell-') && key !== CACHE)
            .map((key) => caches.delete(key))
        )
      )
  );
  void self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method === 'POST' &&
    url.origin === location.origin &&
    url.pathname === '/share-target'
  ) {
    event.respondWith(handleShare(event.request));
    return;
  }
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/offline.html') as Promise<Response>)
    );
    return;
  }

  if (PRECACHE_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request)));
    return;
  }

  if (build.includes(url.pathname) || url.pathname.startsWith('/_app/immutable/')) {
    event.respondWith(cacheImmutableAsset(event.request));
  }
});

self.addEventListener('sync', (event) => {
  const syncEvent = event as ExtendableEvent & { tag: string };
  if (syncEvent.tag === 'studysky-upload-queue') {
    syncEvent.waitUntil(flushUploadQueue());
  }
});

self.addEventListener('push', (event) => {
  const value = safePushData(event);
  event.waitUntil(
    self.registration.showNotification(value.title, {
      body: value.body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: { href: value.href }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const href =
    event.notification.data && typeof event.notification.data.href === 'string'
      ? event.notification.data.href
      : '/notifications';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const existing = clients.find((client) => 'focus' in client);
      if (existing && 'navigate' in existing) {
        await existing.navigate(href);
        return existing.focus();
      }
      return self.clients.openWindow(href);
    })
  );
});

async function handleShare(request: Request): Promise<Response> {
  const fallbackRequest = request.clone();
  try {
    const ownerUserId = await getActiveOfflineAccount();
    if (!ownerUserId) throw new Error('No active StudySky account is available.');
    const form = await request.formData();
    const title = form.get('title')?.toString();
    const text = form.get('text')?.toString();
    const sharedFiles = form
      .getAll('files')
      .filter((value): value is File => value instanceof File && value.size > 0);
    for (const file of sharedFiles) {
      await addOfflineRecord({
        ownerUserId,
        kind: 'upload',
        createdAt: new Date().toISOString(),
        file,
        title,
        text
      });
    }
    if (!sharedFiles.length) throw new Error('No shared file was received.');
    return Response.redirect('/scan?shared=pending', 303);
  } catch {
    // An uncontrolled/unsupported storage path still has a server-side inbox fallback.
    return fetch(fallbackRequest);
  }
}

async function flushUploadQueue(): Promise<void> {
  const ownerUserId = await getActiveOfflineAccount();
  if (!ownerUserId) return;
  const records = await listOfflineRecords(ownerUserId);
  for (const record of records) {
    if (record.kind !== 'upload' || !record.id) continue;
    const body = new FormData();
    body.set('ownerUserId', ownerUserId);
    body.set('files', record.file);
    appendOfflineUploadMetadata(body, record);
    const response = await fetch('/api/uploads', { method: 'POST', body });
    if (!response.ok) throw new Error('Queued upload needs attention');
    await deleteOfflineRecord(record.id, ownerUserId);
  }
}

async function cacheImmutableAsset(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

function safePushData(event: PushEvent): { title: string; body: string; href: string } {
  try {
    const value = event.data?.json() as Partial<{
      title: string;
      body: string;
      href: string;
    }>;
    return {
      title: value.title || 'StudySky',
      body: value.body || 'A study reminder is ready.',
      href: value.href || '/notifications'
    };
  } catch {
    return {
      title: 'StudySky',
      body: 'A study reminder is ready.',
      href: '/notifications'
    };
  }
}
