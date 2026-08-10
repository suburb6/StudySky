<script lang="ts">
  import {
    Crop,
    Image,
    LoaderCircle,
    RotateCcw,
    RotateCw,
    ScanLine,
    SlidersHorizontal,
    Upload,
    X
  } from '@lucide/svelte';
  import { onDestroy } from 'svelte';
  import { documentTypeLabels } from '$lib/domain/labels';
  import { addOfflineRecord, type OfflineUploadMetadata } from '$lib/offline/queue';

  type ModuleOption = { id: string; code: string; name: string };
  type ChapterOption = { id: string; moduleId: string; title: string };
  type ImageMode = 'color' | 'grayscale' | 'black_and_white';
  type PageEdit = {
    rotation: number;
    mode: ImageMode;
    brightness: number;
    contrast: number;
    cropTop: number;
    cropRight: number;
    cropBottom: number;
    cropLeft: number;
  };
  type ResumeRecord = {
    fingerprint: string;
    sessionId: string;
    expectedBytes: number;
  };

  let {
    ownerUserId,
    modules,
    chapters,
    presetModule = '',
    presetChapter = '',
    presetSection = '',
    presetType = 'my_notes',
    camera = false,
    returnTo = '/documents?uploaded=1',
    oncomplete
  }: {
    ownerUserId: string;
    modules: ModuleOption[];
    chapters: ChapterOption[];
    presetModule?: string;
    presetChapter?: string;
    presetSection?: string;
    presetType?: string;
    camera?: boolean;
    returnTo?: string;
    oncomplete?: (detail: {
      documentIds: string[];
      requestedOcr: boolean;
      title: string;
      mimeType: string;
    }) => void | Promise<void>;
  } = $props();

  const resumeStorageKey = $derived(`studysky-resumable-sessions-v1:${ownerUserId}`);

  let files = $state<File[]>([]);
  let previews = $state<string[]>([]);
  let correctedFiles = $state<Array<File | null>>([]);
  let correctedPreviews = $state<string[]>([]);
  let edits = $state<PageEdit[]>([]);
  let moduleId = $state('');
  let chapterId = $state('');
  let section = $state('');
  let selectedType = $state('my_notes');
  let uploading = $state(false);
  let progress = $state(0);
  let message = $state('');
  let error = $state('');
  let controller: AbortController | null = null;
  let presetsApplied = false;
  let handwritingOcr = $state(false);
  let pausedSessionIds = $state<string[]>([]);
  let correctingPage = $state<number | null>(null);
  let pageErrors = $state<Record<number, string>>({});

  $effect(() => {
    if (!presetsApplied) {
      moduleId = presetModule;
      chapterId = presetChapter;
      section = presetSection;
      selectedType = presetType;
      presetsApplied = true;
    }
  });

  const filteredChapters = $derived(
    chapters.filter((chapter) => !moduleId || chapter.moduleId === moduleId)
  );
  const allImages = $derived(
    files.length > 0 && files.every((file) => file.type.startsWith('image/'))
  );
  const ocrCompatible = $derived(
    files.length > 0 &&
      files.every((file) => file.type === 'application/pdf' || file.type.startsWith('image/'))
  );

  function chooseFiles(event: Event) {
    const selected = Array.from((event.currentTarget as HTMLInputElement).files ?? []);
    const nextFiles = [...files, ...selected].slice(0, 40);
    const accepted = nextFiles.slice(files.length);
    files = nextFiles;
    previews = [
      ...previews,
      ...accepted.map((file) => (file.type.startsWith('image/') ? URL.createObjectURL(file) : ''))
    ];
    correctedFiles = [...correctedFiles, ...accepted.map(() => null)];
    correctedPreviews = [...correctedPreviews, ...accepted.map(() => '')];
    edits = [...edits, ...accepted.map(defaultEdit)];
    (event.currentTarget as HTMLInputElement).value = '';
    error = '';
  }

  function removeFile(index: number) {
    if (correctingPage !== null) return;
    if (previews[index]) URL.revokeObjectURL(previews[index]);
    if (correctedPreviews[index]) URL.revokeObjectURL(correctedPreviews[index]);
    files = files.filter((_, itemIndex) => itemIndex !== index);
    previews = previews.filter((_, itemIndex) => itemIndex !== index);
    correctedFiles = correctedFiles.filter((_, itemIndex) => itemIndex !== index);
    correctedPreviews = correctedPreviews.filter((_, itemIndex) => itemIndex !== index);
    edits = edits.filter((_, itemIndex) => itemIndex !== index);
    pageErrors = {};
  }

  function move(index: number, direction: number) {
    if (correctingPage !== null) return;
    const target = index + direction;
    if (target < 0 || target >= files.length) return;
    const nextFiles = [...files];
    const nextPreviews = [...previews];
    const nextCorrectedFiles = [...correctedFiles];
    const nextCorrectedPreviews = [...correctedPreviews];
    const nextEdits = [...edits];
    [nextFiles[index], nextFiles[target]] = [nextFiles[target], nextFiles[index]];
    [nextPreviews[index], nextPreviews[target]] = [nextPreviews[target], nextPreviews[index]];
    [nextCorrectedFiles[index], nextCorrectedFiles[target]] = [
      nextCorrectedFiles[target],
      nextCorrectedFiles[index]
    ];
    [nextCorrectedPreviews[index], nextCorrectedPreviews[target]] = [
      nextCorrectedPreviews[target],
      nextCorrectedPreviews[index]
    ];
    [nextEdits[index], nextEdits[target]] = [nextEdits[target], nextEdits[index]];
    files = nextFiles;
    previews = nextPreviews;
    correctedFiles = nextCorrectedFiles;
    correctedPreviews = nextCorrectedPreviews;
    edits = nextEdits;
    pageErrors = {};
  }

  function updateEdit(index: number, value: Partial<PageEdit>) {
    edits[index] = { ...edits[index], ...value };
    edits = [...edits];
  }

  function defaultEdit(): PageEdit {
    return {
      rotation: 0,
      mode: 'color',
      brightness: 100,
      contrast: 100,
      cropTop: 0,
      cropRight: 0,
      cropBottom: 0,
      cropLeft: 0
    };
  }

  async function autoCorrectPage(index: number) {
    if (correctingPage !== null || !files[index]?.type.startsWith('image/')) return;
    correctingPage = index;
    pageErrors = { ...pageErrors, [index]: '' };
    try {
      const { autoCorrectDocument } = await import('$lib/client/document-scanner');
      const corrected = await autoCorrectDocument(files[index]);
      if (correctedPreviews[index]) URL.revokeObjectURL(correctedPreviews[index]);
      correctedFiles[index] = corrected;
      correctedFiles = [...correctedFiles];
      correctedPreviews[index] = URL.createObjectURL(corrected);
      correctedPreviews = [...correctedPreviews];
    } catch (caught) {
      pageErrors = {
        ...pageErrors,
        [index]:
          caught instanceof Error
            ? caught.message
            : 'Automatic page correction is unavailable in this browser.'
      };
    } finally {
      correctingPage = null;
    }
  }

  function resetPage(index: number) {
    if (correctingPage !== null) return;
    if (correctedPreviews[index]) URL.revokeObjectURL(correctedPreviews[index]);
    correctedFiles[index] = null;
    correctedFiles = [...correctedFiles];
    correctedPreviews[index] = '';
    correctedPreviews = [...correctedPreviews];
    pageErrors = { ...pageErrors, [index]: '' };
    updateEdit(index, defaultEdit());
  }

  function metadata(form: HTMLFormElement) {
    const values = new FormData(form);
    return {
      title: values.get('title')?.toString() || null,
      moduleId: moduleId || null,
      chapterId: chapterId || null,
      section: section || null,
      type: values.get('type')?.toString() || 'other',
      documentDate: null,
      description: null,
      tags: [],
      notebookName: null,
      notebookNumber: null,
      notebookPageRange: null,
      organiseLater: false
    };
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!files.length || uploading) return;
    uploading = true;
    progress = 0;
    error = '';
    message = 'Preparing upload…';
    controller = new AbortController();
    pausedSessionIds = [];
    const form = event.currentTarget as HTMLFormElement;
    const details = metadata(form);
    let completedFiles = 0;
    const uploadedDocumentIds: string[] = [];
    try {
      const preparedFiles = await prepareFilesForUpload(details);
      let completedBytes = 0;
      const totalBytes = preparedFiles.reduce((sum, file) => sum + file.size, 0);
      if (!navigator.onLine) {
        await queueFilesOnDevice(preparedFiles, details);
        return;
      }
      for (const file of preparedFiles) {
        let documentId: string | null;
        if (file.size >= 8 * 1024 * 1024) {
          documentId = await resumableUpload(file, details, completedBytes, totalBytes);
        } else {
          documentId = await directUpload(file, form, completedBytes, totalBytes);
        }
        if (documentId) uploadedDocumentIds.push(documentId);
        completedBytes += file.size;
        completedFiles += 1;
        progress = Math.round((completedBytes / totalBytes) * 100);
      }
      message = `${preparedFiles.length} file${preparedFiles.length === 1 ? '' : 's'} uploaded.`;
      if (oncomplete) {
        await oncomplete({
          documentIds: uploadedDocumentIds,
          requestedOcr: handwritingOcr,
          title: details.title || preparedFiles[0]?.name || 'Document',
          mimeType: preparedFiles[0]?.type || 'application/octet-stream'
        });
      } else if (handwritingOcr && uploadedDocumentIds[0]) {
        location.assign(`/documents?ocr=${uploadedDocumentIds[0]}`);
      } else {
        location.assign(returnTo);
      }
    } catch (caught) {
      if ((caught as Error).name === 'AbortError') {
        error = pausedSessionIds.length
          ? 'Upload paused. Retry to resume from the last confirmed chunk, or discard it below.'
          : 'Upload cancelled before completion.';
        message = '';
      } else if (!navigator.onLine) {
        const preparedFiles = await prepareFilesForUpload(details);
        await queueFilesOnDevice(preparedFiles.slice(completedFiles), details);
      } else {
        error = caught instanceof Error ? caught.message : 'Upload failed.';
        message = '';
      }
    } finally {
      uploading = false;
      controller = null;
    }
  }

  async function prepareFilesForUpload(details: OfflineUploadMetadata): Promise<File[]> {
    if (!allImages) return files;
    message = 'Optimising pages…';
    const processed = await Promise.all(
      files.map((file, index) =>
        processImage(correctedFiles[index] ?? file, edits[index] ?? defaultEdit())
      )
    );
    const createPdf = camera || files.length > 1;
    if (!createPdf) return processed.map((item) => item.file);
    const totalSourceBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (files.length > 40 || totalSourceBytes > 250 * 1024 * 1024) {
      throw new Error('Create PDFs from at most 40 pages or 250 MB of source images.');
    }
    const pdf = makeImagePdf(
      processed,
      `${safeBaseName(details.title || `scan-${new Date().toISOString().slice(0, 10)}`)}.pdf`
    );
    return [pdf];
  }

  async function processImage(file: File, edit: PageEdit) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      const left = clamp(edit.cropLeft, 0, 35);
      const right = clamp(edit.cropRight, 0, 35);
      const top = clamp(edit.cropTop, 0, 35);
      const bottom = clamp(edit.cropBottom, 0, 35);
      const sourceWidth = Math.max(1, Math.round(bitmap.width * (1 - (left + right) / 100)));
      const sourceHeight = Math.max(1, Math.round(bitmap.height * (1 - (top + bottom) / 100)));
      const sourceX = Math.round(bitmap.width * (left / 100));
      const sourceY = Math.round(bitmap.height * (top / 100));
      const scale = Math.min(1, 2200 / Math.max(sourceWidth, sourceHeight));
      const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
      const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
      const quarterTurn = Math.abs(edit.rotation / 90) % 2 === 1;
      const canvas = document.createElement('canvas');
      canvas.width = quarterTurn ? drawHeight : drawWidth;
      canvas.height = quarterTurn ? drawWidth : drawHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image editing is not available in this browser.');
      const modeFilter =
        edit.mode === 'grayscale'
          ? 'grayscale(1)'
          : edit.mode === 'black_and_white'
            ? 'grayscale(1) contrast(180%)'
            : '';
      context.filter =
        `${modeFilter} brightness(${edit.brightness}%) contrast(${edit.contrast}%)`.trim();
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate((edit.rotation * Math.PI) / 180);
      context.drawImage(
        bitmap,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        -drawWidth / 2,
        -drawHeight / 2,
        drawWidth,
        drawHeight
      );
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('Could not encode edited page.'))),
          'image/jpeg',
          0.82
        )
      );
      return {
        file: new File([blob], `${safeBaseName(file.name)}-edited.jpg`, {
          type: 'image/jpeg',
          lastModified: Date.now()
        }),
        bytes: new Uint8Array(await blob.arrayBuffer()),
        width: canvas.width,
        height: canvas.height
      };
    } finally {
      bitmap.close();
    }
  }

  function makeImagePdf(
    pages: Array<{ bytes: Uint8Array; width: number; height: number }>,
    filename: string
  ): File {
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    const offsets: number[] = [];
    let length = 0;
    const append = (value: string | Uint8Array) => {
      const bytes = typeof value === 'string' ? encoder.encode(value) : value;
      chunks.push(bytes);
      length += bytes.byteLength;
    };
    const object = (id: number, body: string | Uint8Array[]) => {
      offsets[id] = length;
      append(`${id} 0 obj\n`);
      if (typeof body === 'string') append(body);
      else body.forEach(append);
      append('\nendobj\n');
    };

    append('%PDF-1.4\n');
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    const pageIds = pages.map((_, index) => 3 + index * 3);
    object(
      2,
      `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`
    );
    pages.forEach((page, index) => {
      const pageId = 3 + index * 3;
      const imageId = pageId + 1;
      const contentId = pageId + 2;
      const maxWidth = 595;
      const maxHeight = 842;
      const scale = Math.min(maxWidth / page.width, maxHeight / page.height);
      const width = Math.round(page.width * scale * 100) / 100;
      const height = Math.round(page.height * scale * 100) / 100;
      object(
        pageId,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`
      );
      object(imageId, [
        encoder.encode(
          `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.byteLength} >>\nstream\n`
        ),
        page.bytes,
        encoder.encode('\nendstream')
      ]);
      const content = `${width} 0 0 ${height} 0 0 cm /Im0 Do`;
      object(
        contentId,
        `<< /Length ${encoder.encode(content).byteLength} >>\nstream\n${content}\nendstream`
      );
    });
    const objectCount = 2 + pages.length * 3;
    const xrefOffset = length;
    append(`xref\n0 ${objectCount + 1}\n`);
    append('0000000000 65535 f \n');
    for (let id = 1; id <= objectCount; id += 1) {
      append(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
    }
    append(
      `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
    );
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new File([result], filename, {
      type: 'application/pdf',
      lastModified: Date.now()
    });
  }

  function clamp(value: number, minimum: number, maximum: number) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function safeBaseName(value: string) {
    return (
      value
        .replace(/\.[^.]+$/, '')
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 100) || 'scan'
    );
  }

  async function queueFilesOnDevice(pendingFiles: File[], details: OfflineUploadMetadata) {
    for (const file of pendingFiles) {
      await addOfflineRecord({
        ownerUserId,
        kind: 'upload',
        createdAt: new Date().toISOString(),
        file,
        title: details.title ?? undefined,
        metadata: details
      });
    }
    message = `${pendingFiles.length} file${pendingFiles.length === 1 ? '' : 's'} saved on this device—not uploaded yet.`;
    progress = 0;
    files = [];
    previews.forEach(URL.revokeObjectURL);
    correctedPreviews.forEach((preview) => preview && URL.revokeObjectURL(preview));
    previews = [];
    correctedFiles = [];
    correctedPreviews = [];
  }

  async function directUpload(
    file: File,
    form: HTMLFormElement,
    completedBytes: number,
    totalBytes: number
  ) {
    const body = new FormData(form);
    body.set('ownerUserId', ownerUserId);
    body.delete('files');
    body.set('files', file);
    message = `Uploading ${file.name}…`;
    return new Promise<string | null>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('POST', '/api/uploads');
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          progress = Math.round(((completedBytes + event.loaded) / totalBytes) * 100);
        }
      };
      request.onload = () => {
        const response = safeJson(request.responseText);
        if (request.status >= 200 && request.status < 300) {
          const documents = Array.isArray(response.documents) ? response.documents : [];
          const first = documents[0] as { id?: unknown } | undefined;
          resolve(typeof first?.id === 'string' ? first.id : null);
        } else {
          reject(new Error(typeof response.error === 'string' ? response.error : 'Upload failed.'));
        }
      };
      request.onerror = () => reject(new Error('Network error. Try again when connected.'));
      request.onabort = () => reject(new DOMException('Cancelled', 'AbortError'));
      controller?.signal.addEventListener('abort', () => request.abort(), { once: true });
      request.send(body);
    });
  }

  async function resumableUpload(
    file: File,
    details: ReturnType<typeof metadata>,
    completedBytes: number,
    totalBytes: number
  ): Promise<string | null> {
    const fingerprint = resumeFingerprint(file, details);
    let sessionId = '';
    let offset = 0;
    const saved = readResumeRecords().find((record) => record.fingerprint === fingerprint);
    if (saved) {
      message = `Checking resumable upload for ${file.name}…`;
      const existing = await inspectResumeSession(saved.sessionId, file.size);
      if (existing?.status === 'complete') {
        removeResumeRecord(saved.sessionId);
        return null;
      }
      if (existing?.status === 'active') {
        sessionId = saved.sessionId;
        offset = existing.offset;
      } else if (existing?.status === 'finalising') {
        throw new Error(`${file.name} is still being finalised. Retry in a moment.`);
      } else {
        removeResumeRecord(saved.sessionId);
      }
    }
    if (!sessionId) {
      message = `Starting resumable upload for ${file.name}…`;
      const sessionResponse = await fetch('/api/upload-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ownerUserId,
          filename: file.name,
          size: file.size,
          metadata: details
        }),
        signal: controller?.signal
      });
      const session = await sessionResponse.json();
      if (!sessionResponse.ok) throw new Error(session.error ?? 'Could not start upload.');
      sessionId = session.id as string;
      offset = session.offset as number;
      writeResumeRecord({ fingerprint, sessionId, expectedBytes: file.size });
    }
    pausedSessionIds = [...new Set([...pausedSessionIds, sessionId])];
    const chunkSize = 5 * 1024 * 1024;
    let documentId: string | null = null;
    while (offset < file.size) {
      const chunk = file.slice(offset, Math.min(offset + chunkSize, file.size));
      message = `Uploading ${file.name} · ${Math.round((offset / file.size) * 100)}%`;
      const response = await fetch(`/api/upload-sessions/${sessionId}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
          'upload-offset': String(offset)
        },
        body: chunk,
        signal: controller?.signal
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? 'Chunk upload failed.');
      offset = value.offset;
      if (value.complete && typeof value.document?.id === 'string') {
        documentId = value.document.id;
      }
      progress = Math.round(((completedBytes + offset) / totalBytes) * 100);
    }
    removeResumeRecord(sessionId);
    pausedSessionIds = pausedSessionIds.filter((id) => id !== sessionId);
    return documentId;
  }

  async function inspectResumeSession(sessionId: string, expectedBytes: number) {
    const response = await fetch(`/api/upload-sessions/${sessionId}`, {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller?.signal
    });
    if (!response.ok) return null;
    const length = Number(response.headers.get('upload-length'));
    const offset = Number(response.headers.get('upload-offset'));
    const status = response.headers.get('upload-status') ?? '';
    if (
      length !== expectedBytes ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > expectedBytes
    ) {
      return null;
    }
    return { offset, status };
  }

  function resumeFingerprint(file: File, details: ReturnType<typeof metadata>): string {
    return JSON.stringify([file.name, file.size, file.lastModified, details]);
  }

  function readResumeRecords(): ResumeRecord[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(resumeStorageKey) ?? '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (record): record is ResumeRecord =>
          typeof record?.fingerprint === 'string' &&
          typeof record?.sessionId === 'string' &&
          Number.isSafeInteger(record?.expectedBytes)
      );
    } catch {
      return [];
    }
  }

  function writeResumeRecord(record: ResumeRecord) {
    const records = readResumeRecords().filter(
      (value) => value.fingerprint !== record.fingerprint && value.sessionId !== record.sessionId
    );
    try {
      localStorage.setItem(resumeStorageKey, JSON.stringify([...records, record].slice(-20)));
    } catch {
      // The server session still works during this page lifetime.
    }
  }

  function removeResumeRecord(sessionId: string) {
    try {
      localStorage.setItem(
        resumeStorageKey,
        JSON.stringify(readResumeRecords().filter((record) => record.sessionId !== sessionId))
      );
    } catch {
      // An expired server session is cleaned by the maintenance worker.
    }
  }

  async function discardPausedUploads() {
    if (!navigator.onLine) {
      error = 'Reconnect before discarding a paused server upload.';
      return;
    }
    const remaining: string[] = [];
    for (const sessionId of pausedSessionIds) {
      const response = await fetch(`/api/upload-sessions/${sessionId}`, { method: 'DELETE' });
      if (response.ok || response.status === 404) removeResumeRecord(sessionId);
      else remaining.push(sessionId);
    }
    pausedSessionIds = remaining;
    error = remaining.length
      ? 'Some paused uploads could not be discarded. Try again.'
      : 'Paused upload data was discarded.';
  }

  function retry(event: MouseEvent) {
    error = '';
    (event.currentTarget as HTMLElement).closest('form')?.requestSubmit();
  }

  function safeJson(value: string): Record<string, unknown> {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  onDestroy(() => {
    previews.forEach(URL.revokeObjectURL);
    correctedPreviews.forEach((preview) => preview && URL.revokeObjectURL(preview));
  });
</script>

<form class="upload-form" method="POST" enctype="multipart/form-data" onsubmit={submit}>
  <div class="drop-zone">
    <input
      id="upload-files"
      name="files"
      type="file"
      accept="application/pdf,image/jpeg,image/png,image/webp,.txt,.md,.csv,.json"
      capture={camera ? 'environment' : undefined}
      multiple
      onchange={chooseFiles}
    />
    <div>
      {#if camera}<Image size={26} strokeWidth={1.5} />{:else}<Upload
          size={26}
          strokeWidth={1.5}
        />{/if}
      <strong>{camera ? 'Capture pages or choose files' : 'Choose notes or documents'}</strong>
      <span>
        {files.length
          ? 'Capture or add more pages'
          : 'PDF, image, or text · images are optimised automatically'}
      </span>
    </div>
  </div>

  {#if files.length}
    <div class="preview-list" aria-label="Selected files">
      {#each files as file, index}
        <article class="preview-item">
          {#if previews[index]}
            <span class="image-frame">
              <img
                src={correctedPreviews[index] || previews[index]}
                alt={`Preview of ${file.name}`}
                style={`transform: rotate(${edits[index]?.rotation ?? 0}deg); filter: ${edits[index]?.mode === 'grayscale' ? 'grayscale(1)' : edits[index]?.mode === 'black_and_white' ? 'grayscale(1) contrast(180%)' : ''} brightness(${edits[index]?.brightness ?? 100}%) contrast(${edits[index]?.contrast ?? 100}%); clip-path: inset(${edits[index]?.cropTop ?? 0}% ${edits[index]?.cropRight ?? 0}% ${edits[index]?.cropBottom ?? 0}% ${edits[index]?.cropLeft ?? 0}%);`}
              />
            </span>
          {:else}
            <span class="file-placeholder">{file.name.split('.').pop()?.toUpperCase()}</span>
          {/if}
          <span class="preview-copy">
            <strong>{file.name}</strong>
            <small>{(file.size / 1024 / 1024).toFixed(1)} MB</small>
          </span>
          {#if files.length > 1}
            <button
              class="icon-button"
              type="button"
              onclick={() => move(index, -1)}
              disabled={index === 0 || correctingPage !== null}
              aria-label="Move page earlier">↑</button
            >
            <button
              class="icon-button"
              type="button"
              onclick={() => move(index, 1)}
              disabled={index === files.length - 1 || correctingPage !== null}
              aria-label="Move page later">↓</button
            >
          {/if}
          <button
            class="icon-button"
            type="button"
            onclick={() => removeFile(index)}
            disabled={correctingPage !== null}
            aria-label={`Remove ${file.name}`}
          >
            <X size={15} />
          </button>
          {#if previews[index]}
            <details class="edit-controls">
              <summary class="button button-sm"><SlidersHorizontal size={14} /> Edit page</summary>
              <div class="surface edit-popover">
                <div class="row edit-actions">
                  <button
                    class="button button-sm"
                    type="button"
                    onclick={() => autoCorrectPage(index)}
                    disabled={correctingPage !== null}
                  >
                    {#if correctingPage === index}
                      <LoaderCircle class="spinner" size={14} /> Finding page…
                    {:else}
                      <ScanLine size={14} />
                      {correctedFiles[index] ? 'Correct again' : 'Auto-correct page'}
                    {/if}
                  </button>
                  <button
                    class="button button-sm"
                    type="button"
                    onclick={() =>
                      updateEdit(index, { rotation: ((edits[index]?.rotation ?? 0) + 90) % 360 })}
                    disabled={correctingPage !== null}
                  >
                    <RotateCw size={14} /> Rotate
                  </button>
                  <button
                    class="button button-sm"
                    type="button"
                    onclick={() => resetPage(index)}
                    disabled={correctingPage !== null}
                  >
                    <RotateCcw size={14} /> Reset
                  </button>
                </div>
                {#if pageErrors[index]}
                  <p class="error-message" role="alert">{pageErrors[index]}</p>
                {/if}
                <div class="field">
                  <label for={`page-mode-${index}`}>Colour mode</label>
                  <select
                    id={`page-mode-${index}`}
                    value={edits[index]?.mode ?? 'color'}
                    onchange={(event) =>
                      updateEdit(index, { mode: event.currentTarget.value as ImageMode })}
                  >
                    <option value="color">Colour</option>
                    <option value="grayscale">Grayscale</option>
                    <option value="black_and_white">Black and white</option>
                  </select>
                </div>
                <label class="range-field">
                  <span>Brightness <output>{edits[index]?.brightness ?? 100}%</output></span>
                  <input
                    type="range"
                    min="60"
                    max="150"
                    value={edits[index]?.brightness ?? 100}
                    oninput={(event) =>
                      updateEdit(index, { brightness: Number(event.currentTarget.value) })}
                  />
                </label>
                <label class="range-field">
                  <span>Contrast <output>{edits[index]?.contrast ?? 100}%</output></span>
                  <input
                    type="range"
                    min="60"
                    max="180"
                    value={edits[index]?.contrast ?? 100}
                    oninput={(event) =>
                      updateEdit(index, { contrast: Number(event.currentTarget.value) })}
                  />
                </label>
                <p class="field-label"><Crop size={13} /> Manual crop edges</p>
                <div class="crop-grid">
                  {#each [['cropTop', 'Top'], ['cropRight', 'Right'], ['cropBottom', 'Bottom'], ['cropLeft', 'Left']] as [key, label]}
                    <label>
                      <span>{label}</span>
                      <input
                        type="number"
                        min="0"
                        max="35"
                        value={edits[index]?.[key as keyof PageEdit] ?? 0}
                        oninput={(event) =>
                          updateEdit(index, { [key]: Number(event.currentTarget.value) })}
                      />
                    </label>
                  {/each}
                </div>
                <p class="subtle">
                  Auto-correction runs locally and is optional. Check its result; use these manual
                  crop controls when the page boundary is unclear.
                </p>
              </div>
            </details>
          {/if}
        </article>
      {/each}
    </div>
  {/if}

  <div class="form-grid metadata-grid">
    <div class="field">
      <label for="upload-module">Module</label>
      <select id="upload-module" name="moduleId" bind:value={moduleId}>
        <option value="">Document inbox</option>
        {#each modules as module}
          <option value={module.id}>{module.code} · {module.name}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="upload-chapter">Chapter</label>
      <select id="upload-chapter" name="chapterId" bind:value={chapterId}>
        <option value="">No chapter</option>
        {#each filteredChapters as chapter}<option value={chapter.id}>{chapter.title}</option
          >{/each}
      </select>
    </div>
    <div class="field">
      <label for="upload-type">Document type</label>
      <select id="upload-type" name="type" bind:value={selectedType}>
        {#each Object.entries(documentTypeLabels) as [value, label]}
          <option {value}>{label}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="upload-title">Title (optional)</label>
      <input id="upload-title" name="title" placeholder="Derived from filename when blank" />
    </div>
  </div>

  <label class:disabled={!ocrCompatible} class="ocr-option">
    <input
      type="checkbox"
      name="handwritingOcr"
      bind:checked={handwritingOcr}
      disabled={!ocrCompatible}
    />
    <span
      ><strong>Digitise text after upload</strong><small
        >Optional. Opens the first PDF or image in the on-device text reader; the original remains
        unchanged. Formula to LaTeX is available from the same reader when enabled by the host.</small
      ></span
    >
  </label>

  {#if uploading || progress > 0}
    <div class="upload-progress" aria-live="polite">
      <div class="row-between"><span>{message}</span><strong>{progress}%</strong></div>
      <div class="progress-track">
        <div class="progress-value" style={`width: ${progress}%`}></div>
      </div>
    </div>
  {/if}
  {#if error}<p class="error-message" role="alert">{error}</p>{/if}

  <div class="form-actions">
    {#if uploading}
      <button class="button" type="button" onclick={() => controller?.abort()}>
        <X size={15} /> Pause
      </button>
    {:else if error}
      <button class="button" type="button" onclick={retry}>
        <RotateCcw size={15} /> Retry
      </button>
      {#if pausedSessionIds.length}
        <button class="button button-danger" type="button" onclick={discardPausedUploads}>
          Discard paused upload
        </button>
      {/if}
    {/if}
    <button class="button button-primary" type="submit" disabled={!files.length || uploading}>
      <Upload size={16} /> Upload {files.length || ''}
    </button>
  </div>
</form>

<style>
  .upload-form {
    display: grid;
    gap: 20px;
  }

  .drop-zone {
    position: relative;
    display: grid;
    min-height: 150px;
    place-items: center;
    padding: 24px;
    border: 1px dashed var(--border-strong);
    border-radius: 9px;
    background: var(--surface);
    text-align: center;
  }

  .drop-zone:hover {
    background: var(--surface-hover);
  }

  .drop-zone input {
    position: absolute;
    z-index: 2;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
  }

  .drop-zone > div {
    display: grid;
    place-items: center;
    gap: 7px;
  }

  .drop-zone :global(svg) {
    color: var(--text-soft);
  }

  .drop-zone span {
    color: var(--text-faint);
    font-size: 11px;
  }

  .preview-list {
    display: grid;
    gap: 6px;
  }

  .preview-item {
    display: flex;
    min-height: 58px;
    align-items: center;
    gap: 9px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 7px;
  }

  .image-frame,
  .file-placeholder {
    width: 44px;
    height: 44px;
    flex: 0 0 auto;
    border-radius: 5px;
    object-fit: cover;
    background: var(--surface-hover);
  }

  .image-frame {
    display: grid;
    overflow: hidden;
    place-items: center;
  }

  .image-frame img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .file-placeholder {
    display: grid;
    place-items: center;
    color: var(--text-faint);
    font-size: 9px;
    font-weight: 700;
  }

  .preview-copy {
    display: grid;
    min-width: 0;
    flex: 1;
  }

  .preview-copy strong {
    overflow: hidden;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview-copy small {
    color: var(--text-faint);
  }

  .icon-button {
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

  .icon-button:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .metadata-grid {
    padding-top: 18px;
    border-top: 1px solid var(--border);
  }

  .edit-controls {
    position: relative;
  }

  .edit-controls > summary {
    list-style: none;
  }

  .edit-popover {
    position: absolute;
    z-index: 12;
    top: 42px;
    right: 0;
    display: grid;
    width: min(340px, calc(100vw - 36px));
    gap: 12px;
    padding: 14px;
    box-shadow: 0 14px 44px rgba(0, 0, 0, 0.16);
  }

  .edit-actions {
    flex-wrap: wrap;
  }

  .range-field {
    display: grid;
    gap: 5px;
    color: var(--text-soft);
    font-size: 11px;
  }

  .range-field > span {
    display: flex;
    justify-content: space-between;
  }

  .range-field input {
    width: 100%;
  }

  .crop-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }

  .crop-grid label {
    display: grid;
    gap: 3px;
    color: var(--text-faint);
    font-size: 10px;
  }

  .crop-grid input {
    min-height: 34px;
    padding: 5px 7px;
  }

  .ocr-option {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px;
    border-radius: 7px;
    background: var(--surface-hover);
    cursor: pointer;
  }

  .ocr-option.disabled {
    cursor: default;
    opacity: 0.58;
  }

  .ocr-option input {
    width: 17px;
    height: 17px;
  }

  .ocr-option span {
    display: grid;
  }

  .ocr-option small {
    color: var(--text-soft);
  }

  .upload-progress {
    display: grid;
    gap: 8px;
    color: var(--text-soft);
    font-size: 11px;
  }

  .upload-form :global(.spinner) {
    animation: spin 900ms linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 620px) {
    .drop-zone {
      min-height: 130px;
    }

    .icon-button {
      width: 44px;
      height: 44px;
    }

    .edit-actions .button {
      min-height: 44px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .upload-form :global(.spinner) {
      animation-duration: 1.8s;
    }
  }
</style>
