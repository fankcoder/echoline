import { expect, test } from '@playwright/test';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';

const lesson = (id: string, title: string, cueCount: number, translationStatus: 'idle' | 'running' | 'ready' | 'failed' = 'ready') => ({
  id, sourceUrl: `https://learn.deeplearning.ai/courses/test/lesson/${id}/test`, canonicalUrl: `https://learn.deeplearning.ai/courses/test/lesson/${id}/test`,
  sourceVideoId: id, title, duration: 60, manifestRevision: 1, importStatus: 'ready', captionStatus: 'ready',
  translationStatus, translationProgress: translationStatus === 'ready' ? 1 : .4, cueCount,
});

const manifest = (id: string, title: string, text: string, zh: string, cueCount: number, translationStatus: 'idle' | 'running' | 'ready' | 'failed' = 'ready') => ({
  lesson: lesson(id, title, cueCount, translationStatus),
  cues: Array.from({ length: cueCount }, (_, index) => ({ id: `cue-${index + 1}`, start: index, end: index + .8, en: index ? `${text} ${index + 1}` : text, zh: zh ? (index ? `${zh} ${index + 1}` : zh) : null })),
  captionSource: 'llm', progress: { playbackSeconds: 0, sessionSeconds: 0, positionSeconds: 0, activeCue: 0, completedCueIds: [] },
  playback: null,
});

test('late subtitle response cannot overwrite the newly selected lesson', async ({ page }) => {
  const course = { id: 'course', name: 'Regression course', createdAt: Date.now(), updatedAt: Date.now(), lessons: [lesson(firstId, 'Slow old lesson', 2), lesson(secondId, 'Current lesson', 3)] };
  await page.route('**/api/bootstrap', (route) => route.fulfill({ json: { courses: [course], vocabulary: [], settings: { selectedCourseId: 'course', localStorageMigrated: true }, stats: { playbackSeconds: 0, sessionSeconds: 0, learnedLessons: 0 }, migrationVersion: 1 } }));
  await page.route('**/api/settings', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/lessons/*/progress', (route) => route.fulfill({ json: {} }));
  await page.route(`**/api/lessons/${firstId}/refresh`, (route) => route.fulfill({ json: manifest(firstId, 'Slow old lesson', 'OLD ENGLISH MUST DISAPPEAR', '旧字幕不得出现', 2) }));
  await page.route(`**/api/lessons/${secondId}/refresh`, (route) => route.fulfill({ json: manifest(secondId, 'Current lesson', 'CURRENT ENGLISH', '当前中文字幕', 3) }));
  await page.route(`**/api/lessons/${firstId}`, async (route) => { await new Promise((resolve) => setTimeout(resolve, 700)); await route.fulfill({ json: manifest(firstId, 'Slow old lesson', 'OLD ENGLISH MUST DISAPPEAR', '旧字幕不得出现', 2) }); });
  await page.route(`**/api/lessons/${secondId}`, async (route) => { await new Promise((resolve) => setTimeout(resolve, 30)); await route.fulfill({ json: manifest(secondId, 'Current lesson', 'CURRENT ENGLISH', '当前中文字幕', 3) }); });

  await page.goto(`/learn/${firstId}`);
  await expect(page.getByText('逐句精听播放器', { exact: true })).toBeVisible();
  await page.waitForTimeout(80);
  await page.evaluate((id) => {
    history.pushState({}, '', `/learn/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, secondId);

  await expect(page.getByRole('heading', { name: 'Current lesson' })).toBeVisible();
  await expect(page.getByText('当前句 · 1/3 · 3 条已缓存 · 免费按需')).toBeVisible();
  await expect(page.getByText('CURRENT ENGLISH', { exact: true })).toHaveCount(2);
  await expect(page.getByText('OLD ENGLISH MUST DISAPPEAR')).toHaveCount(0);
  await expect(page.getByText('旧字幕不得出现')).toHaveCount(0);

  const reader = await page.locator('.learning-panel').boundingBox();
  const player = await page.locator('.player-column').boundingBox();
  const video = await page.locator('.video-stage').boundingBox();
  expect(reader!.width).toBeGreaterThan(player!.width);
  expect(video!.width).toBeLessThanOrEqual(390);
  expect(video!.height).toBeLessThanOrEqual(230);
});

test('translation is requested only after clicking a specific cue', async ({ page }) => {
  const course = { id: 'course', name: 'Regression course', createdAt: Date.now(), updatedAt: Date.now(), lessons: [lesson(firstId, 'On-demand lesson', 2, 'idle'), lesson(secondId, 'Current lesson', 3)] };
  let translationRequests = 0;
  await page.route('**/api/bootstrap', (route) => route.fulfill({ json: { courses: [course], vocabulary: [], settings: { selectedCourseId: 'course', localStorageMigrated: true }, stats: { playbackSeconds: 0, sessionSeconds: 0, learnedLessons: 0 }, migrationVersion: 1 } }));
  await page.route('**/api/settings', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/lessons/*/progress', (route) => route.fulfill({ json: {} }));
  await page.route(`**/api/lessons/${firstId}/refresh`, (route) => route.fulfill({ json: manifest(firstId, 'On-demand lesson', 'ON DEMAND ENGLISH', '', 2, 'idle') }));
  await page.route(`**/api/lessons/${secondId}/refresh`, (route) => route.fulfill({ json: manifest(secondId, 'Current lesson', 'CURRENT ENGLISH', '当前中文字幕', 3) }));
  await page.route(`**/api/lessons/${firstId}`, (route) => route.fulfill({ json: manifest(firstId, 'On-demand lesson', 'ON DEMAND ENGLISH', '', 2, 'idle') }));
  await page.route(`**/api/lessons/${secondId}`, (route) => route.fulfill({ json: manifest(secondId, 'Current lesson', 'CURRENT ENGLISH', '当前中文字幕', 3) }));
  await page.route(`**/api/lessons/${firstId}/translations/cue-1`, (route) => {
    translationRequests += 1;
    const translated = manifest(firstId, 'On-demand lesson', 'ON DEMAND ENGLISH', '', 2, 'idle');
    translated.cues[0].zh = '按需翻译成功';
    return route.fulfill({ json: translated });
  });

  await page.goto(`/learn/${firstId}`);
  await expect(page.getByRole('heading', { name: 'On-demand lesson' })).toBeVisible();
  await page.waitForTimeout(2_100);
  expect(translationRequests).toBe(0);
  await page.locator('.cue-row').first().getByRole('button', { name: '免费翻译本句' }).click();
  await expect(page.getByText('按需翻译成功', { exact: true })).toHaveCount(2);
  expect(translationRequests).toBe(1);
  await page.getByRole('button', { name: '下一集' }).click();

  await expect(page.getByRole('heading', { name: 'Current lesson' })).toBeVisible();
  await expect(page.getByText('CURRENT ENGLISH', { exact: true })).toHaveCount(2);
  await expect(page.getByText('ON DEMAND ENGLISH')).toHaveCount(0);
  expect(translationRequests).toBe(1);
});
