export interface OfflineUploadMetadata {
  title?: string | null;
  moduleId?: string | null;
  chapterId?: string | null;
  section?: string | null;
  type?: string;
  documentDate?: string | null;
  description?: string | null;
  tags?: string[];
  notebookName?: string | null;
  notebookNumber?: number | null;
  notebookPageRange?: string | null;
  organiseLater?: boolean;
}

export type OfflineRecord =
  | {
      id?: number;
      ownerUserId: string;
      kind: 'upload';
      createdAt: string;
      file: File;
      title?: string;
      text?: string;
      metadata?: OfflineUploadMetadata;
    }
  | {
      id?: number;
      ownerUserId: string;
      kind: 'task';
      createdAt: string;
      action: string;
      fields: Array<[string, string]>;
    };

const DATABASE = 'studysky-offline';
const DATABASE_VERSION = 2;
const QUEUE_STORE = 'queue';
const ACCOUNT_STORE = 'account';
const OWNER_INDEX = 'ownerUserId';
const ACTIVE_ACCOUNT_KEY = 'active';

export async function addOfflineRecord(record: OfflineRecord): Promise<number> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(QUEUE_STORE, 'readwrite');
    const request = transaction.objectStore(QUEUE_STORE).add(record);
    request.onsuccess = () => resolve(Number(request.result));
    request.onerror = () => reject(request.error);
  });
}

export function appendOfflineUploadMetadata(
  body: FormData,
  record: Extract<OfflineRecord, { kind: 'upload' }>
): void {
  const metadata = record.metadata;
  body.set('title', metadata?.title ?? record.title ?? '');
  body.set('moduleId', metadata?.moduleId ?? '');
  body.set('chapterId', metadata?.chapterId ?? '');
  body.set('section', metadata?.section ?? '');
  body.set('type', metadata?.type ?? 'my_notes');
  body.set('documentDate', metadata?.documentDate ?? record.createdAt.slice(0, 10));
  body.set('description', metadata?.description ?? record.text ?? '');
  body.set('tags', metadata?.tags?.join(', ') ?? '');
  body.set('notebookName', metadata?.notebookName ?? '');
  body.set('notebookNumber', metadata?.notebookNumber ? String(metadata.notebookNumber) : '');
  body.set('notebookPageRange', metadata?.notebookPageRange ?? '');
  if (metadata?.organiseLater ?? !metadata) body.set('organiseLater', 'true');
}

export async function listOfflineRecords(ownerUserId: string): Promise<OfflineRecord[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(QUEUE_STORE)
      .objectStore(QUEUE_STORE)
      .index(OWNER_INDEX)
      .getAll(ownerUserId);
    request.onsuccess = () => resolve(request.result as OfflineRecord[]);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteOfflineRecord(id: number, ownerUserId: string): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(QUEUE_STORE, 'readwrite');
    const store = transaction.objectStore(QUEUE_STORE);
    const read = store.get(id);
    read.onsuccess = () => {
      const record = read.result as OfflineRecord | undefined;
      if (record?.ownerUserId === ownerUserId) store.delete(id);
    };
    read.onerror = () => reject(read.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function setActiveOfflineAccount(ownerUserId: string): Promise<void> {
  const database = await openDatabase();
  await writeAccountValue(database, { key: ACTIVE_ACCOUNT_KEY, ownerUserId });
}

export async function clearActiveOfflineAccount(ownerUserId?: string): Promise<void> {
  const database = await openDatabase();
  const current = await readAccountValue(database);
  if (ownerUserId && current !== ownerUserId) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(ACCOUNT_STORE, 'readwrite');
    transaction.objectStore(ACCOUNT_STORE).delete(ACTIVE_ACCOUNT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function getActiveOfflineAccount(): Promise<string | null> {
  return readAccountValue(await openDatabase());
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      const queue = database.objectStoreNames.contains(QUEUE_STORE)
        ? request.transaction!.objectStore(QUEUE_STORE)
        : database.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
      if (!queue.indexNames.contains(OWNER_INDEX)) {
        queue.createIndex(OWNER_INDEX, OWNER_INDEX, { unique: false });
      }
      if ((event as IDBVersionChangeEvent).oldVersion < DATABASE_VERSION) {
        const cursor = queue.openCursor();
        cursor.onsuccess = () => {
          const value = cursor.result;
          if (!value) return;
          const record = value.value as Partial<OfflineRecord>;
          if (!record.ownerUserId) value.delete();
          value.continue();
        };
      }
      if (!database.objectStoreNames.contains(ACCOUNT_STORE)) {
        database.createObjectStore(ACCOUNT_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readAccountValue(database: IDBDatabase): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(ACCOUNT_STORE)
      .objectStore(ACCOUNT_STORE)
      .get(ACTIVE_ACCOUNT_KEY);
    request.onsuccess = () => {
      const value = request.result as { ownerUserId?: unknown } | undefined;
      resolve(typeof value?.ownerUserId === 'string' ? value.ownerUserId : null);
    };
    request.onerror = () => reject(request.error);
  });
}

async function writeAccountValue(
  database: IDBDatabase,
  value: { key: string; ownerUserId: string }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(ACCOUNT_STORE, 'readwrite');
    transaction.objectStore(ACCOUNT_STORE).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
