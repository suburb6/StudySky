import { dateKeyAddDays, dateKeyInTimeZone, dateTimeInTimeZone } from '$lib/domain/time';
import { todayOverview } from '$lib/server/services/study';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const timeZone = locals.user!.timezone;
  const date = dateKeyInTimeZone(new Date(), timeZone);
  const overview = await todayOverview(
    locals.user!.id,
    dateTimeInTimeZone(date, '00:00', timeZone),
    dateTimeInTimeZone(dateKeyAddDays(date, 1), '00:00', timeZone)
  );

  return {
    date,
    scheduled: overview.scheduled,
    revisions: overview.revisions,
    timetable: overview.timetable
  };
};
