export function defaultStorageQuotaBytes(): number {
  const fallback = 10 * 1024 ** 3;
  const configured = Number(process.env.DEFAULT_STORAGE_QUOTA_BYTES ?? fallback);
  return Number.isSafeInteger(configured) && configured >= 256 * 1024 ** 2 ? configured : fallback;
}
