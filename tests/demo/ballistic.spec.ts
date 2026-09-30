import { expect, test } from '@playwright/test';

test('ballistic velocity changes restart, pause holds, and particle mode survives updates', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?preset=ballistic-gel');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#scene-name')).toHaveText('Ballistic Gel');
  await expect
    .poll(async () => parseFloat(await page.locator('#sim-time').innerText()))
    .toBeGreaterThan(0.3);
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  await page.getByLabel('Impact speed', { exact: false }).fill('750');
  await page.getByLabel('Impact speed', { exact: false }).dispatchEvent('change');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await expect(page.locator('#sim-time')).toHaveText('0.0 s');
  await expect(page.locator('#value-speed')).toContainText('750');
  await expect(page.locator('#sim-state')).toHaveText('PAUSED');
  await page.getByLabel('Particles', { exact: true }).check();
  await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
  await expect
    .poll(async () => parseFloat(await page.locator('#sim-time').innerText()))
    .toBeGreaterThan(1.5);
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  await page.getByLabel('Surface', { exact: true }).check();
  await expect(page.locator('#error')).toBeHidden();
  await page.getByRole('button', { name: 'Restart simulation', exact: true }).click();
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await expect(page.locator('#sim-time')).toHaveText('0.0 s');
  expect(errors).toEqual([]);
});
