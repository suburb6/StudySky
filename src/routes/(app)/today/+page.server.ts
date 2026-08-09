import { dateKeyInTimeZone, dateTimeInTimeZone } from '$lib/domain/time';
import { todayOverview } from '$lib/server/services/study';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const timeZone = locals.user!.timezone;
  const date = dateKeyInTimeZone(new Date(), timeZone);
  const overview = await todayOverview(
    locals.user!.id,
    dateTimeInTimeZone(date, '00:00', timeZone),
    dateTimeInTimeZone(date, '23:59:59', timeZone)
  );

  return {
    date,
    revisions: overview.revisions,
    timetable: overview.timetable
  };
};
