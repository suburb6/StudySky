import { eq } from 'drizzle-orm';
import { getDatabase } from '$lib/server/db';
import { chapters } from '$lib/server/db/schema';
import { listModules } from '$lib/server/services/study';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  const [moduleRows, chapterRows] = await Promise.all([
    listModules(locals.user!.id),
    getDatabase()
      .select({ id: chapters.id, moduleId: chapters.moduleId, title: chapters.title })
      .from(chapters)
      .where(eq(chapters.userId, locals.user!.id))
  ]);
  const requestedChapter = chapterRows.find(
    (chapter) => chapter.id === url.searchParams.get('chapter')
  );
  const requestedModule = moduleRows.find(
    (module) => module.id === (requestedChapter?.moduleId ?? url.searchParams.get('module'))
  );
  const moduleId = requestedModule?.id ?? '';
  const chapterId =
    requestedChapter && requestedChapter.moduleId === moduleId ? requestedChapter.id : '';

  return {
    modules: moduleRows,
    chapters: chapterRows,
    presets: {
      moduleId,
      chapterId,
      section: url.searchParams.get('section') ?? '',
      type: url.searchParams.get('type') ?? 'my_notes'
    },
    returnTo: chapterId
      ? `/chapters/${chapterId}`
      : moduleId
        ? `/modules/${moduleId}?view=materials`
        : '/documents?uploaded=1',
    shared: url.searchParams.get('shared'),
    shareError: url.searchParams.get('shareError')
  };
};
