import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

const email = process.env.E2E_ADMIN_EMAIL || 'e2e@example.test';
const password = process.env.E2E_ADMIN_PASSWORD || 'e2e-password-123';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/);
}

test('authenticates and presents the calm Today decision view', async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(navigation).toContainText('Modules');
  await expect(navigation).not.toContainText('Documents');
  await expect(navigation).not.toContainText('Practice');
  await expect(page.getByRole('heading', { name: 'Today’s timetable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Revision', exact: true })).toBeVisible();
  const todayCards = page.locator('.today-card');
  const cardBounds = await todayCards.evaluateAll((cards) =>
    cards.map((card) => {
      const bounds = card.getBoundingClientRect();
      return { top: Math.round(bounds.top), width: Math.round(bounds.width) };
    })
  );
  expect(cardBounds).toHaveLength(2);
  expect(cardBounds[0]?.top).toBe(cardBounds[1]?.top);
  expect(Math.abs((cardBounds[0]?.width ?? 0) - (cardBounds[1]?.width ?? 0))).toBeLessThanOrEqual(
    1
  );
  const response = await page.request.get('/health/ready');
  expect(response.ok()).toBe(true);
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['content-security-policy']).toContain("font-src 'self' data:");
});

test('creates a module and task through real forms', async ({ page }) => {
  await signIn(page);
  const suffix = Date.now().toString().slice(-6);
  await page.goto('/modules');
  await page.getByRole('button', { name: 'Add module' }).click();
  const moduleDialog = page.getByRole('dialog', { name: 'Add module' });
  await expect(moduleDialog).toBeVisible();
  await moduleDialog.getByLabel('Code').fill(`E${suffix}`);
  await moduleDialog.getByLabel('Name').fill(`E2E module ${suffix}`);
  await moduleDialog.getByRole('button', { name: 'Add module' }).click();
  await expect(page.getByText('Module added.')).toBeVisible();
  await expect(page.getByText(`E2E module ${suffix}`)).toBeVisible();

  await page
    .locator('.module-row')
    .filter({ hasText: `E2E module ${suffix}` })
    .click();
  await expect(page.getByRole('button', { name: 'Add task' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Add chapter' })).toHaveCount(0);

  await page.getByRole('link', { name: /^Chapters/ }).click();
  await expect(page.getByRole('button', { name: 'Add chapter' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Add task' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Import' }).click();
  const importDialog = page.getByRole('dialog', { name: 'Import chapters' });
  await expect(importDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(importDialog).toBeHidden();

  await page.getByRole('button', { name: 'Add chapter' }).click();
  const chapterDialog = page.getByRole('dialog', { name: 'Add chapter' });
  await chapterDialog.getByLabel('Chapter title').fill(`Chapter ${suffix}`);
  await chapterDialog.getByRole('button', { name: 'Add chapter' }).click();
  await expect(page).toHaveURL(/view=chapters/);
  await expect(page.getByRole('link', { name: `Chapter ${suffix}`, exact: true })).toBeVisible();

  await page.getByRole('button', { name: `Rename Chapter ${suffix}` }).click();
  const renameDialog = page.getByRole('dialog', { name: 'Rename chapter' });
  await renameDialog.getByLabel('Chapter title').fill(`Renamed ${suffix}`);
  await renameDialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('link', { name: `Renamed ${suffix}`, exact: true })).toBeVisible();

  await page.getByRole('link', { name: /^Materials/ }).click();
  await expect(page.getByRole('button', { name: 'Add material' })).toHaveCount(1);

  await page
    .getByRole('navigation', { name: `E${suffix} sections` })
    .getByRole('link', { name: 'Settings' })
    .click();
  await expect(page.getByRole('button', { name: 'Save module' })).toHaveCount(1);

  await page.goto('/tasks?new=1');
  const taskDialog = page.getByRole('dialog', { name: 'Add task' });
  await expect(taskDialog).toBeVisible();
  await taskDialog.locator('#task-title').fill(`E2E study task ${suffix}`);
  await taskDialog.locator('#task-estimate').fill('25');
  await taskDialog.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  await page.goto('/tasks?view=all');
  await expect(
    page.getByRole('heading', { name: `E2E study task ${suffix}`, exact: true })
  ).toBeVisible();
});

test('keeps every main route aligned and offers a Monday-first themed timetable', async ({
  page
}) => {
  await signIn(page);
  await page.goto('/timetable');
  await page.getByRole('button', { name: 'Add entry' }).click();
  const entryDialog = page.getByRole('dialog', { name: 'Add timetable entry' });
  await entryDialog.getByLabel('Title').fill('Synthetic weekly class');
  await entryDialog.getByLabel('Start').fill('09:00');
  await entryDialog.getByLabel('End').fill('10:00');
  await entryDialog.getByRole('button', { name: 'Add to timetable' }).click();
  await expect(page.getByText('Timetable updated.')).toBeVisible();
  const routes = [
    '/today',
    '/modules',
    '/tasks',
    '/timetable',
    '/documents',
    '/scan',
    '/practice',
    '/revision',
    '/progress',
    '/search',
    '/notifications',
    '/settings'
  ];
  const positions: Array<{ left: number; top: number }> = [];

  for (const route of routes) {
    await page.goto(route);
    const title = page.locator('.page-header h1');
    await expect(title).toBeVisible();
    positions.push(
      await title.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return { left: Math.round(bounds.left), top: Math.round(bounds.top) };
      })
    );
    await expect(page.locator('.page-header .eyebrow')).toHaveCount(0);
  }

  expect(new Set(positions.map((position) => position.left)).size).toBe(1);
  expect(new Set(positions.map((position) => position.top)).size).toBe(1);

  const calendarConsoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') calendarConsoleErrors.push(message.text());
  });
  await page.goto('/timetable');
  await expect(page.locator('.fc-col-header-cell-cushion')).toHaveCount(7);
  expect(
    (await page.locator('.fc-col-header-cell-cushion').allInnerTexts()).map((text) =>
      text.trim().slice(0, 3)
    )
  ).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  await expect(page.getByRole('link', { name: /Manage schedule/ })).toBeVisible();
  await expect(page.getByText('Plan study week')).toHaveCount(0);
  await page.locator('.fc-event').first().click();
  const editor = page.getByRole('dialog', { name: 'Edit timetable entry' });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Start')).toBeVisible();
  await editor.getByRole('button', { name: 'Cancel' }).click();
  expect(calendarConsoleErrors.filter((message) => message.includes('font-src'))).toEqual([]);

  await page.goto('/settings#appearance');
  await page.getByRole('radio', { name: 'Violet' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Violet' })).toHaveAttribute('aria-checked', 'true');
});

test('uploads a scanned image and never reports a false client success', async ({ page }) => {
  await signIn(page);
  await page.goto('/scan');
  await expect(page.getByLabel('Module')).toBeVisible();
  await expect(page.getByLabel('Chapter')).toBeVisible();
  await expect(page.getByLabel('Document type')).toBeVisible();
  await expect(page.getByLabel('Read handwriting after upload')).toBeVisible();
  await expect(page.getByLabel('Section')).toHaveCount(0);
  await expect(page.getByLabel('Notebook title')).toHaveCount(0);
  await expect(page.getByLabel('Page range')).toHaveCount(0);
  await expect(page.getByText(/images are optimised automatically/i)).toBeVisible();
  await page.locator('#upload-files').setInputFiles({
    name: `scan-${Date.now()}.png`,
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGUlEQVQokWP49esHSYhhVMOv0VD6NVyTBgCoJ+wfoEF/sQAAAABJRU5ErkJggg==',
      'base64'
    )
  });
  await expect(page.getByText(/scan-/).first()).toBeVisible();
  await page.getByRole('button', { name: /^Upload/ }).click();
  await expect(page).toHaveURL(/\/documents\?uploaded=1$/);
  await expect(page.getByText(/scan-/).first()).toBeVisible();
  await expect(page.locator('.preview-section')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Upload files' })).toBeVisible();
});

test('loads page correction only when requested and optimises without extra choices', async ({
  page
}) => {
  await signIn(page);
  await page.goto('/scan');
  const pageImage = await sharp({
    create: { width: 800, height: 1000, channels: 3, background: '#7d7d7d' }
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="800" height="1000"><polygon points="105,90 710,125 680,915 80,860" fill="white" stroke="#181818" stroke-width="10"/><text x="180" y="260" font-size="42">StudySky notes</text></svg>'
        )
      }
    ])
    .png()
    .toBuffer();
  await page.locator('#upload-files').setInputFiles({
    name: 'page-correction.png',
    mimeType: 'image/png',
    buffer: pageImage
  });
  await page.getByText('Edit page', { exact: true }).click();
  await page.getByRole('button', { name: 'Auto-correct page' }).click();
  await expect(page.getByRole('button', { name: 'Correct again' })).toBeVisible({
    timeout: 30_000
  });
  await expect(page.getByText('Also retain original image files')).toHaveCount(0);
  await expect(page.getByText('Create one PDF')).toHaveCount(0);
});

test('uses a configurable chapter board without duplicate progress labels', async ({ page }) => {
  await signIn(page);
  const suffix = Date.now().toString().slice(-6);
  await page.goto('/modules');
  await page.getByRole('button', { name: 'Add module' }).click();
  const moduleDialog = page.getByRole('dialog', { name: 'Add module' });
  await moduleDialog.getByLabel('Code').fill(`K${suffix}`);
  await moduleDialog.getByLabel('Name').fill(`Board module ${suffix}`);
  await moduleDialog.getByRole('button', { name: 'Add module' }).click();
  await page
    .locator('.module-row')
    .filter({ hasText: `Board module ${suffix}` })
    .click();
  await page.getByRole('link', { name: /^Chapters/ }).click();
  await page.getByRole('button', { name: 'Add chapter' }).click();
  const chapterDialog = page.getByRole('dialog', { name: 'Add chapter' });
  await chapterDialog.getByLabel('Chapter title').fill(`Board chapter ${suffix}`);
  await chapterDialog.getByRole('button', { name: 'Add chapter' }).click();
  await page.getByRole('link', { name: `Board chapter ${suffix}`, exact: true }).click();

  await expect(page.getByRole('heading', { name: 'To do' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'In progress' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Done', exact: true })).toBeVisible();
  await expect(page.getByText(/confidence/i)).toHaveCount(0);
  await expect(page.getByText('Recent materials')).toHaveCount(0);

  await page.locator('.page-header-actions').getByRole('button', { name: 'Add card' }).click();
  const cardDialog = page.getByRole('dialog', { name: 'Add card' });
  await cardDialog.getByLabel('Card title').fill(`Read topic ${suffix}`);
  await cardDialog.getByRole('button', { name: 'Add card' }).click();
  await expect(page.getByText(`Read topic ${suffix}`, { exact: true })).toBeVisible();

  await page.locator('.page-header-actions').getByRole('button', { name: 'Add column' }).click();
  const columnDialog = page.getByRole('dialog', { name: 'Add column' });
  await columnDialog.getByLabel('Column name').fill('Blocked');
  await columnDialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Blocked' })).toBeVisible();

  const chapterUrl = page.url();
  const linkedTask = `Linked task ${suffix}`;
  await page.goto('/tasks?new=1');
  const taskDialog = page.getByRole('dialog', { name: 'Add task' });
  await taskDialog.getByLabel('Title').fill(linkedTask);
  await taskDialog
    .getByLabel('Module')
    .selectOption({ label: `K${suffix} · Board module ${suffix}` });
  await taskDialog
    .getByLabel('Chapter (optional)')
    .selectOption({ label: `Board chapter ${suffix}` });
  await taskDialog.getByRole('button', { name: 'Add task' }).click();
  await page.goto(chapterUrl);
  await expect(page.getByRole('group', { name: 'To do' }).getByText(linkedTask)).toBeVisible();

  await page.goto('/tasks?view=all');
  const taskRow = page.locator('.task-row').filter({ hasText: linkedTask });
  await taskRow.getByRole('button', { name: `Complete ${linkedTask}` }).click();
  await page.goto(chapterUrl);
  await expect(page.getByRole('group', { name: 'Done' }).getByText(linkedTask)).toBeVisible();
});

test('exposes four focused mobile destinations plus a valid share target', async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(mobile.getByText('Today', { exact: true })).toBeVisible();
  await expect(mobile.getByText('Modules', { exact: true })).toBeVisible();
  await expect(mobile.getByText('Tasks', { exact: true })).toBeVisible();
  await expect(mobile.getByText('Timetable', { exact: true })).toBeVisible();

  const manifestResponse = await page.request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.share_target).toMatchObject({
    action: '/share-target',
    method: 'POST',
    enctype: 'multipart/form-data'
  });
});
