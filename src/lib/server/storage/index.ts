import { LocalStorageProvider } from './local';

let provider: LocalStorageProvider | undefined;

export function getStorage(): LocalStorageProvider {
  provider ??= new LocalStorageProvider();
  return provider;
}

export * from './types';
export * from './local';
