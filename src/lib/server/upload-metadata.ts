import { z } from 'zod';
import { documentType } from './db/schema';
import type { DocumentMetadata } from './documents';

const metadataSchema = z.object({
  title: z.string().max(300).nullable().optional(),
  moduleId: z.uuid().nullable().optional(),
  chapterId: z.uuid().nullable().optional(),
  section: z.string().max(80).nullable().optional(),
  type: z.enum(documentType.enumValues).default('other'),
  documentDate: z.string().date().nullable().optional(),
  description: z.string().max(10_000).nullable().optional(),
  tags: z.array(z.string().min(1).max(60)).max(30).default([]),
  notebookName: z.string().max(120).nullable().optional(),
  notebookNumber: z.number().int().min(1).max(999).nullable().optional(),
  notebookPageRange: z.string().max(60).nullable().optional(),
  organiseLater: z.boolean().default(false)
});

export function parseMetadataObject(value: unknown): DocumentMetadata {
  return metadataSchema.parse(value);
}

export function parseMetadataForm(form: FormData): DocumentMetadata {
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };
  const notebook = Number(text('notebookNumber'));
  return metadataSchema.parse({
    title: text('title'),
    moduleId: text('moduleId'),
    chapterId: text('chapterId'),
    section: text('section'),
    type: text('type') ?? 'other',
    documentDate: text('documentDate'),
    description: text('description'),
    tags: (text('tags') ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    notebookName: text('notebookName'),
    notebookNumber: Number.isInteger(notebook) && notebook > 0 ? notebook : null,
    notebookPageRange: text('notebookPageRange'),
    organiseLater: form.get('organiseLater') === 'on' || form.get('organiseLater') === 'true'
  });
}
