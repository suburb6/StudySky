import { z } from 'zod';

export function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function optionalFormString(form: FormData, key: string): string | null {
  const value = formString(form, key);
  return value.length > 0 ? value : null;
}

export function formInteger(form: FormData, key: string, fallback = 0): number {
  const value = Number.parseInt(formString(form, key), 10);
  return Number.isFinite(value) ? value : fallback;
}

export function nullableDate(form: FormData, key: string): Date | null {
  const value = formString(form, key);
  if (!value) return null;
  const result = new Date(value);
  return Number.isNaN(result.getTime()) ? null : result;
}

export function intendedOwnerMatches(form: FormData, userId: string): boolean {
  const value = form.get('ownerUserId');
  return value === null || (typeof value === 'string' && value === userId);
}

export function issueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Please check the form.';
}
