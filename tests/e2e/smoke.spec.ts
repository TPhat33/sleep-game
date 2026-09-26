import { expect, test } from '@playwright/test';

test.describe('Home', () => {
  test('renders the title with no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await expect(page.getByText('Hushglow')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('Platform spike', () => {
  test('renders and reports platform info', async ({ page }) => {
    await page.goto('/spike.html');
    await expect(
      page.getByRole('heading', { name: 'Hushglow — Platform Spike' }),
    ).toBeVisible();
    await expect(page.getByText(/^unsupported \(web\)/)).toBeVisible();
  });

  test('Unlock audio brings the AudioContext to "running"', async ({ page }) => {
    await page.goto('/spike.html');
    await page.getByRole('button', { name: 'Unlock audio' }).click();
    await expect(page.getByText(/ctx\.state: running/)).toBeVisible();
  });

  test('Start preset applies the A1 configuration with no error entries logged', async ({
    page,
  }) => {
    await page.goto('/spike.html');
    await page.getByRole('button', { name: 'Unlock audio' }).click();
    await expect(page.getByText(/ctx\.state: running/)).toBeVisible();

    await page.getByRole('button', { name: /Apply A1 preset/ }).click();
    await expect(page.getByText(/preset applied/)).toBeVisible();

    const logText = await page.locator('.log').textContent();
    expect(logText ?? '').not.toMatch(/error/i);
  });

  test('the wake-lock panel shows a status without throwing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));

    await page.goto('/spike.html');
    await expect(page.getByText(/supported: (true|false) · held: (true|false)/)).toBeVisible();
    await page.getByRole('button', { name: 'Acquire' }).click();
    await page.waitForTimeout(200);
    // Headless Chromium may deny the lock; only "no exception was thrown" is asserted.
    expect(errors).toEqual([]);
  });

  test('the log persists across a reload', async ({ page }) => {
    await page.goto('/spike.html');
    await page.getByRole('button', { name: 'Unlock audio' }).click();
    await expect(page.getByText(/unlocked, state=running/)).toBeVisible();

    await page.reload();
    await expect(page.getByText(/unlocked, state=running/)).toBeVisible();
  });
});
