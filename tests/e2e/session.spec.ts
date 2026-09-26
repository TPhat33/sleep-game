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
  await expect(page.getByText('ปกติคุณใช้เวลานานแค่ไหนกว่าจะหลับ?')).toBeVisible();
  await page.getByRole('button', { name: '15–30 นาที' }).click();
}

test.describe('Onboarding -> Home', () => {
  test('asks one sleep-latency question, then shows Home', async ({ page }) => {
    const errors = trackErrors(page);
    await completeOnboarding(page);
    await expect(page.getByRole('button', { name: 'เริ่ม' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('Home -> Settle -> Play', () => {
  test('starting a session enters Settle, and skipping enters Play', async ({ page }) => {
    const errors = trackErrors(page);
    await completeOnboarding(page);

    await page.getByRole('button', { name: 'เริ่ม' }).click();
    await expect(page.getByText('มีอะไรอยากเก็บไว้ในขวดก่อนนอนไหม?')).toBeVisible();

    await page.getByRole('button', { name: 'ข้าม' }).click();
    await expect(page.locator('.pond canvas')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('the jar accepts typed items and closing the lid enters Play', async ({ page }) => {
    const errors = trackErrors(page);
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'เริ่ม' }).click();

    await page.getByPlaceholder('พิมพ์ที่นี่...').fill('กังวลเรื่องพรุ่งนี้');
    await page.getByRole('button', { name: 'เพิ่ม' }).click();
    await expect(page.getByText('กังวลเรื่องพรุ่งนี้')).toBeVisible();

    await page.getByRole('button', { name: 'ปิดฝาขวด' }).click();
    await expect(page.locator('.pond canvas')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('tapping the pond canvas does not throw', async ({ page }) => {
    const errors = trackErrors(page);
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'เริ่ม' }).click();
    await page.getByRole('button', { name: 'ข้าม' }).click();

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

    await page.getByRole('button', { name: 'ฟังอย่างเดียว' }).click();
    const listen = page.locator('.listen');
    await expect(listen).toBeVisible();
    await expect(page.getByRole('button', { name: 'หยุด' })).not.toBeVisible();

    await listen.click();
    await expect(page.getByRole('button', { name: 'หยุด' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ต่อเวลา' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('the stop button ends the session and returns to Home', async ({ page }) => {
    const errors = trackErrors(page);
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'ฟังอย่างเดียว' }).click();
    await page.locator('.listen').click();
    await page.getByRole('button', { name: 'หยุด' }).click();
    await expect(page.getByRole('button', { name: 'เริ่ม' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('Home navigation', () => {
  test('Sky, Journal and Settings are reachable and return to Home', async ({ page }) => {
    const errors = trackErrors(page);
    await completeOnboarding(page);

    await page.getByRole('button', { name: 'ท้องฟ้า' }).click();
    await expect(page.getByRole('heading', { name: 'ท้องฟ้า' })).toBeVisible();
    await page.getByRole('button', { name: '‹ กลับ' }).click();
    await expect(page.getByRole('button', { name: 'เริ่ม' })).toBeVisible();

    await page.getByRole('button', { name: 'สมุดความฝัน' }).click();
    await expect(page.getByRole('heading', { name: 'สมุดความฝัน' })).toBeVisible();
    await page.getByRole('button', { name: '‹ กลับ' }).click();
    await expect(page.getByRole('button', { name: 'เริ่ม' })).toBeVisible();

    await page.getByRole('button', { name: 'ตั้งค่า' }).click();
    await expect(page.getByRole('heading', { name: 'ตั้งค่า' })).toBeVisible();
    await page.getByRole('button', { name: '‹ กลับ' }).click();
    await expect(page.getByRole('button', { name: 'เริ่ม' })).toBeVisible();

    await page.getByRole('button', { name: 'สถิติของฉัน' }).click();
    await expect(page.getByRole('heading', { name: 'สถิติของฉัน' })).toBeVisible();
    await expect(page.getByText('ยังไม่มีข้อมูลเซสชัน')).toBeVisible();
    await page.getByRole('button', { name: '‹ กลับ' }).click();
    await expect(page.getByRole('button', { name: 'เริ่ม' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('toggling a bed layer and changing the listen duration persists', async ({ page }) => {
    const errors = trackErrors(page);
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'ตั้งค่า' }).click();

    await page.getByText('เสียงจิ้งหรีด').click();
    await expect(page.getByRole('checkbox').nth(1)).toBeChecked();

    await page.getByRole('button', { name: '90', exact: true }).click();
    await expect(page.getByRole('button', { name: '90', exact: true })).toHaveClass(/active/);

    // Both writes above are async (IndexedDB); the assertions just waited
    // for them to land in the DOM, which only happens after they resolve —
    // safe to reload now.
    await page.reload();
    await page.getByRole('button', { name: 'ตั้งค่า' }).click();
    await expect(page.getByRole('checkbox').nth(1)).toBeChecked();
    await expect(page.getByRole('button', { name: '90', exact: true })).toHaveClass(/active/);

    expect(errors).toEqual([]);
  });

  test('the opt-in export downloads a JSON file with no jar content', async ({ page }) => {
    const errors = trackErrors(page);
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'ตั้งค่า' }).click();

    await expect(page.getByRole('button', { name: /ส่งออกข้อมูล/ })).not.toBeVisible();
    await page.getByText('อนุญาตให้ส่งออกข้อมูลสถิติได้').click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /ส่งออกข้อมูล/ }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('firefly-pond-export.json');

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
