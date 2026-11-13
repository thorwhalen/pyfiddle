/** The example page in a real browser, with real Python: run, check, stop, release, concepts, notebook. */
import { expect, test, type Locator, type Page } from '@playwright/test';

const cell = (page: Page, id: string) => page.locator(`[data-cell="${id}"]`);

/** Put `lines` in the fiddle's editor. On an emulated phone, fill() sometimes leaves the old code beside the new, so fill until the editor holds exactly these lines. */
const fillCode = async (scope: Locator, lines: string[]) => {
  const editor = scope.locator('.pf-editor').first();
  await expect(async () => {
    await editor.locator('.cm-content').fill(lines.join('\n'));
    await expect(editor.locator('.cm-line')).toHaveText(lines, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
};

test('runs real Python, and Stop ends a runaway loop', async ({ page }, info) => {
  await page.goto('/#first-steps');
  // The isolated projects really are isolated, so their Stop goes through the interrupt buffer.
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(info.project.name.endsWith('-isolated'));
  const warm = cell(page, 'warm-up');
  await warm.getByRole('button', { name: 'Run' }).click();
  await expect(warm.getByLabel('Output')).toHaveText('43 characters', { timeout: 60_000 });

  await fillCode(warm, ['while True:', '    pass']);
  await warm.getByRole('button', { name: /Run/ }).click();
  await warm.getByRole('button', { name: 'Stop' }).click();
  await expect(warm.getByLabel('Output')).toContainText('Stopped.');
  await warm.getByRole('button', { name: 'Undo reset' }).or(warm.getByRole('button', { name: 'Reset' })).click();
  await warm.getByRole('button', { name: 'Run' }).click();
  await expect(warm.getByLabel('Output')).toHaveText('43 characters', { timeout: 60_000 });
});

test('a teacher releases a part; the student sees it, checks a solution, and the page remembers', async ({ page, context }) => {
  await page.goto('/#first-steps');
  await expect(cell(page, 'count-t')).toBeHidden();
  await expect(page.getByText('More of this page opens when your teacher releases it.')).toBeVisible();

  const teacher = await context.newPage();
  await teacher.goto('/?teacher#first-steps');
  await teacher.getByRole('button', { name: 'Release next part' }).click();
  await expect(teacher.getByText('Part 2 of 3 released')).toBeVisible();

  // Same browser, same storage: the student's open page follows the release.
  const task = cell(page, 'count-t');
  await expect(task).toBeVisible();
  await task.getByRole('button', { name: 'Show a hint' }).click();
  await expect(task.getByText('is the sentence in small letters')).toBeVisible();
  await task.getByRole('button', { name: 'Run' }).click();
  await expect(task.getByText(/^Not yet\. n should count both T and t/)).toBeVisible({ timeout: 60_000 });

  await expect(task.getByRole('textbox', { name: 'Make n the number of times the letter t appears in sentence, whether it is written T or t.' })).toBeVisible();
  await fillCode(task, ['sentence = "The quick brown fox jumps over the lazy dog"', 'n = sentence.lower().count("t")', 'print(n)']);
  await task.getByRole('button', { name: 'Run' }).click();
  await expect(task.getByText('✓ Check passed.')).toBeVisible({ timeout: 60_000 });
  await expect(task.getByText('✓ Done')).toBeVisible();

  await page.reload();
  await expect(cell(page, 'count-t').locator('.pf-editor .cm-content').first()).toContainText('sentence.lower().count("t")');
  await expect(cell(page, 'count-t').getByText('✓ Done')).toBeVisible();
});

test('concepts fold under a cell and link to their own page, which has its own fiddles', async ({ page }) => {
  await page.goto('/#first-steps');
  const concepts = cell(page, 'warm-up').locator('details.pf-concepts');
  await expect(concepts.locator('summary')).toHaveText('In this cell: len()');
  await page.goto('/?teacher#first-steps');
  const loop = cell(page, 'every-letter').locator('details.pf-concepts');
  await loop.locator('summary').click();
  await loop.getByRole('link', { name: 'More on for loops →' }).click();
  await expect(page.locator('h1')).toHaveText('for loops');
  await expect(page.locator('.pf-fiddle')).toHaveCount(2);
});

test('downloads the page as a notebook', async ({ page }) => {
  await page.goto('/#first-steps');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download notebook' }).click()]);
  expect(download.suggestedFilename()).toBe('first-steps.ipynb');
  const nb = JSON.parse(await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8')));
  expect(nb.nbformat).toBe(4);
  // A student's notebook has only what has been released.
  expect(JSON.stringify(nb)).not.toContain('count-t');
});
