export const chapterStatusLabels = {
  not_started: 'Not Started',
  introduced: 'Introduced',
  learning: 'Learning',
  practising: 'Practising',
  revision_needed: 'Revision Needed',
  confident: 'Confident'
} as const;

export const taskStatusLabels = {
  inbox: 'Inbox',
  this_week: 'This Week',
  doing: 'Doing',
  waiting: 'Waiting',
  done: 'Done',
  skipped: 'Skipped'
} as const;

export const taskTypeLabels = {
  lecture_review: 'Lecture review',
  reading: 'Reading',
  notes_review: 'Notes review',
  exercise: 'Exercise',
  assignment: 'Assignment',
  project: 'Project',
  coding_work: 'Coding work',
  practice_test: 'Practice test',
  revision: 'Revision',
  physics_preparation: 'Physics preparation',
  question_for_lecturer: 'Question for lecturer',
  administrative_work: 'Administrative work',
  other: 'Other'
} as const;

export const documentTypeLabels = {
  lecturer_notes: 'Lecturer Notes',
  my_notes: 'My Notes',
  worked_exercises: 'Worked Exercises',
  assignment: 'Assignment',
  tutorial_sheet: 'Tutorial Sheet',
  past_paper: 'Past Paper',
  test: 'Test',
  examination: 'Examination',
  formula_sheet: 'Formula Sheet',
  module_catalogue: 'Module Catalogue',
  reference: 'Reference',
  other: 'Other'
} as const;

export const sectionLabels = [
  'Lecturer Materials',
  'My Notes',
  'Worked Exercises',
  'Assignments',
  'Revision',
  'Practice',
  'Mistakes',
  'Questions'
] as const;

export function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
