import { and, asc, eq, sql } from 'drizzle-orm';
import { getDatabase } from '$lib/server/db';
import { chapterBoardColumns, tasks } from '$lib/server/db/schema';

export function defaultChapterBoardColumns(userId: string, chapterId: string) {
  return [
    { userId, chapterId, name: 'To do', position: 0, isDone: false },
    { userId, chapterId, name: 'In progress', position: 1, isDone: false },
    { userId, chapterId, name: 'Done', position: 2, isDone: true }
  ];
}

export async function chapterBoardPlacement({
  userId,
  chapterId,
  mode = 'first',
  currentColumnId = null
}: {
  userId: string;
  chapterId: string;
  mode?: 'first' | 'open' | 'done';
  currentColumnId?: string | null;
}) {
  const db = getDatabase();
  const columns = await db
    .select()
    .from(chapterBoardColumns)
    .where(
      and(eq(chapterBoardColumns.userId, userId), eq(chapterBoardColumns.chapterId, chapterId))
    )
    .orderBy(asc(chapterBoardColumns.position), asc(chapterBoardColumns.createdAt));
  if (!columns.length) return null;
  const current = columns.find((column) => column.id === currentColumnId);
  const column =
    mode === 'done'
      ? (columns.find((item) => item.isDone) ?? columns.at(-1)!)
      : mode === 'open'
        ? current && !current.isDone
          ? current
          : (columns.find((item) => !item.isDone) ?? columns[0])
        : columns[0];
  if (current?.id === column.id) {
    return { column, position: null };
  }
  const [position] = await db
    .select({ value: sql<number>`coalesce(max(${tasks.boardPosition}), -1) + 1` })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.chapterId, chapterId),
        eq(tasks.boardColumnId, column.id)
      )
    );
  return { column, position: Number(position.value) };
}
