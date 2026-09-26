import { expect, test } from '@playwright/test';

// Full-timing idle -> fade transitions (45s+ real time) are covered by
// SessionDirector's 33 FakeClock unit tests instead of here — this file's
// job is to prove the DOM/Vue/Pixi wiring, which doesn't need real timers.

function trackErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

async function completeOnboarding(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByText('How long does it usually take you to fall asleep?')).toBeVisible();
  await page.getByRole('button', { name: '15–30 minutes' }).click();
}

test.describe('Onboarding -> Home', () => {
  test('asks one sleep-latency question, then shows Home', async ({ page }) => {
    const errors = trackErrors(page);
    await completeOnboarding(page);
    await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('Home -> Settle -> Play', () => {
  test('starting a session enters Settle, and skipping enters Play', async ({ page }) => {
    const errors = trackErrors(page);
    await completeOnboarding(page);

    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByText("Anything you'd like to put in the jar before sleep?")).toBeVisible();

    await page.getByRole('button', { name: 'Skip' }).click();
    await expect(page.locator('.pond canvas')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('the jar accepts typed items and closing the lid enters Play', async ({ page }) => {
    const errors = trackErrors(page);
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'Start' }).click();

    await page.getByPlaceholder('Type here...').fill('Worried about tomorrow');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText('Worried about tomorrow')).toBeVisible();

    await page.getByRole('button', { name: 'Close the jar' }).click();
    await expect(page.locator('.pond canvas')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('tapping the pond canvas does not throw', async ({ page }) => {
    const errors = trackErrors(page);
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'Start' }).click();
    await page.getByRole('button', { name: 'Skip' }).click();

    const canvas = page.locator('.pond canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }

    expect(errors).toEqual([]);
  });
});

test.describe('Home -> Listen only', () => {
  test('shows a pure-black Listen screen, and a tap reveals controls', async ({ page }) => {
    const errors = trackErrors(page);
    await completeOnboarding(page);

    await page.getByRole('button', { name: 'Listen only' }).click();
    const listen = page.locator('.listen');
    await expect(listen).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop' })).not.toBeVisible();

    await listen.click();
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Extend' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('the stop button ends the session and returns to Home', async ({ page }) => {
    const errors = trackErrors(page);
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'Listen only' }).click();
    await page.locator('.listen').click();
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('Home navigation', () => {
  test('Sky, Journal and Settings are reachable and return to Home', async ({ page }) => {
    const errors = trackErrors(page);
    await completeOnboarding(page);

    await page.getByRole('button', { name: 'Sky' }).click();
    await expect(page.getByRole('heading', { name: 'Sky' })).toBeVisible();
    await page.getByRole('button', { name: '‹ Back' }).click();
    await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();

    await page.getByRole('button', { name: 'Journal' }).click();
    await expect(page.getByRole('heading', { name: 'Dream Journal' })).toBeVisible();
    await page.getByRole('button', { name: '‹ Back' }).click();
    await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();

    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await page.getByRole('button', { name: '‹ Back' }).click();
    await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();

    await page.getByRole('button', { name: 'My Stats' }).click();
    await expect(page.getByRole('heading', { name: 'My Stats' })).toBeVisible();
    await expect(page.getByText('No session data yet')).toBeVisible();
    await page.getByRole('button', { name: '‹ Back' }).click();
    await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('toggling a bed layer and changing the listen duration persists', async ({ page }) => {
    const errors = trackErrors(page);
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'Settings' }).click();

    await page.getByText('Crickets').click();
    await expect(page.getByRole('checkbox').nth(1)).toBeChecked();

    await page.getByRole('button', { name: '90', exact: true }).click();
    await expect(page.getByRole('button', { name: '90', exact: true })).toHaveClass(/active/);

    // Both writes above are async (IndexedDB); the assertions just waited
    // for them to land in the DOM, which only happens after they resolve —
    // safe to reload now.
    await page.reload();
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('checkbox').nth(1)).toBeChecked();
    await expect(page.getByRole('button', { name: '90', exact: true })).toHaveClass(/active/);

    expect(errors).toEqual([]);
  });

  test('the opt-in export downloads a JSON file with no jar content', async ({ page }) => {
    const errors = trackErrors(page);
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'Settings' }).click();

    await expect(page.getByRole('button', { name: /Export data/ })).not.toBeVisible();
    await page.getByText('Allow exporting my stats data').click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Export data/ }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('hushglow-export.json');

    const path = await download.path();
    const text = path ? await import('node:fs').then((fs) => fs.readFileSync(path, 'utf8')) : '';
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(parsed)).not.toContain('jar');
    expect(parsed).toHaveProperty('settings');
    expect(parsed).toHaveProperty('progress');
    expect(parsed).toHaveProperty('sessions');

    expect(errors).toEqual([]);
  });
});
