import { expect, test } from '@playwright/test';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';

const lesson = (id: string, title: string, cueCount: number) => ({
  id, sourceUrl: `https://learn.deeplearning.ai/courses/test/lesson/${id}/test`, canonicalUrl: `https://learn.deeplearning.ai/courses/test/lesson/${id}/test`,
  sourceVideoId: id, title, duration: 60, manifestRevision: 1, importStatus: 'ready', captionStatus: 'ready',
  translationStatus: 'ready', translationProgress: 1, cueCount,
});

const manifest = (id: string, title: string, text: string, zh: string, cueCount: number) => ({
  lesson: lesson(id, title, cueCount),
  cues: Array.from({ length: cueCount }, (_, index) => ({ id: `cue-${index + 1}`, start: index, end: index + .8, en: index ? `${text} ${index + 1}` : text, zh: index ? `${zh} ${index + 1}` : zh })),
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
  await expect(page.getByText('当前句 · 1/3 · AI 已缓存')).toBeVisible();
  await expect(page.getByText('CURRENT ENGLISH', { exact: true })).toHaveCount(2);
  await expect(page.getByText('OLD ENGLISH MUST DISAPPEAR')).toHaveCount(0);
  await expect(page.getByText('旧字幕不得出现')).toHaveCount(0);
});
