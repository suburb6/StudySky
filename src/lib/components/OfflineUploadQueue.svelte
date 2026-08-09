<script lang="ts">
  import { onMount } from 'svelte';
  import { CloudUpload, FileImage, Trash2 } from '@lucide/svelte';
  import {
    deleteOfflineRecord,
    appendOfflineUploadMetadata,
    listOfflineRecords,
    type OfflineRecord
  } from '$lib/offline/queue';
  import { documentTypeLabels, sectionLabels } from '$lib/domain/labels';

  let {
    ownerUserId,
    modules = [],
    chapters = []
  }: {
    ownerUserId: string;
    modules?: Array<{ id: string; code: string; name: string }>;
    chapters?: Array<{ id: string; moduleId: string; title: string }>;
  } = $props();
  let records = $state<OfflineRecord[]>([]);
  let busy = $state<number | null>(null);
  let message = $state('');
  let online = $state(true);

  onMount(() => {
    online = navigator.onLine;
    const updateConnection = () => {
      online = navigator.onLine;
    };
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    void refresh();
    return () => {
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  });

  async function refresh() {
    records = (await listOfflineRecords(ownerUserId)).filter((record) => record.kind === 'upload');
  }

  async function upload(
    record: Extract<OfflineRecord, { kind: 'upload' }>,
    form?: HTMLFormElement
  ) {
    if (!record.id) return;
    busy = record.id;
    message = '';
    const body = new FormData();
    body.set('files', record.file);
    appendOfflineUploadMetadata(body, record);
    if (form) {
      for (const [key, value] of new FormData(form)) {
        if (typeof value === 'string') body.set(key, value);
      }
    }
    body.set('ownerUserId', ownerUserId);
    try {
      const response = await fetch('/api/uploads', { method: 'POST', body });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? 'Upload failed.');
      await deleteOfflineRecord(record.id, ownerUserId);
      message = 'Queued scan uploaded to the document inbox.';
      await refresh();
    } catch (caught) {
      message = caught instanceof Error ? caught.message : 'Upload failed.';
    } finally {
      busy = null;
    }
  }

  async function remove(record: OfflineRecord) {
    if (!record.id) return;
    await deleteOfflineRecord(record.id, ownerUserId);
    await refresh();
  }
</script>

{#if records.length}
  <section class="offline-queue surface" aria-labelledby="offline-queue-title">
    <div class="row-between queue-heading">
      <div>
        <p class="eyebrow">Saved on this device</p>
        <h2 id="offline-queue-title">Pending scan uploads</h2>
      </div>
      <span class="pill">{records.length} pending</span>
    </div>
    {#each records as item}
      {@const record = item as Extract<OfflineRecord, { kind: 'upload' }>}
      <article class="queue-record">
        <div class="queue-row">
          <FileImage size={18} />
          <span>
            <strong>{record.file.name}</strong>
            <small>{(record.file.size / 1024 / 1024).toFixed(1)} MB · not uploaded yet</small>
          </span>
          <button
            class="button button-icon button-quiet"
            type="button"
            onclick={() => remove(record)}
            aria-label={`Remove ${record.file.name} from device queue`}
          >
            <Trash2 size={14} />
          </button>
        </div>
        <details class="queue-review" open={Boolean(record.title || record.text)}>
          <summary>Review details and upload</summary>
          <form
            class="panel form-grid"
            onsubmit={(event) => {
              event.preventDefault();
              void upload(record, event.currentTarget);
            }}
          >
            <div class="field form-span">
              <label for={`queue-title-${record.id}`}>Title</label>
              <input
                id={`queue-title-${record.id}`}
                name="title"
                value={record.metadata?.title ?? record.title ?? ''}
                placeholder="Derived from filename when blank"
              />
            </div>
            <div class="field">
              <label for={`queue-module-${record.id}`}>Module</label>
              <select
                id={`queue-module-${record.id}`}
                name="moduleId"
                value={record.metadata?.moduleId ?? ''}
              >
                <option value="">Document inbox</option>
                {#each modules as module}
                  <option value={module.id}>{module.code} · {module.name}</option>
                {/each}
              </select>
            </div>
            <div class="field">
              <label for={`queue-chapter-${record.id}`}>Chapter</label>
              <select
                id={`queue-chapter-${record.id}`}
                name="chapterId"
                value={record.metadata?.chapterId ?? ''}
              >
                <option value="">No chapter</option>
                {#each chapters as chapter}
                  <option value={chapter.id}>
                    {modules.find((module) => module.id === chapter.moduleId)?.code ?? ''} ·
                    {chapter.title}
                  </option>
                {/each}
              </select>
            </div>
            <div class="field">
              <label for={`queue-section-${record.id}`}>Section</label>
              <select
                id={`queue-section-${record.id}`}
                name="section"
                value={record.metadata?.section ?? ''}
              >
                <option value="">No section</option>
                {#each sectionLabels as section}<option value={section}>{section}</option>{/each}
              </select>
            </div>
            <div class="field">
              <label for={`queue-type-${record.id}`}>Document type</label>
              <select
                id={`queue-type-${record.id}`}
                name="type"
                value={record.metadata?.type ?? 'my_notes'}
              >
                {#each Object.entries(documentTypeLabels) as [value, label]}
                  <option {value}>{label}</option>
                {/each}
              </select>
            </div>
            <div class="field">
              <label for={`queue-date-${record.id}`}>Date</label>
              <input
                id={`queue-date-${record.id}`}
                name="documentDate"
                type="date"
                value={record.metadata?.documentDate ?? record.createdAt.slice(0, 10)}
              />
            </div>
            <div class="form-actions form-span">
              <span class="subtle">
                {online ? 'Nothing is uploaded until you confirm.' : 'Reconnect to upload.'}
              </span>
              <button
                class="button button-primary"
                type="submit"
                disabled={!online || busy === record.id}
              >
                <CloudUpload size={14} />
                {busy === record.id ? 'Uploading…' : 'Confirm upload'}
              </button>
            </div>
          </form>
        </details>
      </article>
    {/each}
    {#if message}<p class="info-message" role="status">{message}</p>{/if}
  </section>
{/if}

<style>
  .offline-queue {
    overflow: hidden;
    margin-bottom: 22px;
  }

  .queue-heading {
    padding: 14px;
    border-bottom: 1px solid var(--border);
  }

  .queue-heading h2,
  .queue-heading p {
    margin-bottom: 0;
  }

  .queue-row {
    display: flex;
    min-height: 62px;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
  }

  .queue-row > span {
    display: grid;
    min-width: 0;
    flex: 1;
  }

  .queue-row strong,
  .queue-row small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .queue-row small {
    color: var(--warning);
  }

  .queue-record {
    border-bottom: 1px solid var(--border);
  }

  .queue-review summary {
    min-height: 40px;
    padding: 8px 12px 8px 40px;
    color: var(--text-soft);
    font-size: 11px;
    font-weight: 600;
  }

  .queue-review[open] summary {
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
</style>
