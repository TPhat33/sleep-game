import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { sampleLuminanceGrid } from './helpers/luminance';

// spec §14: no area of the screen exceeds relative luminance 0.35 —
// design pillar 4 ("โทนมืดและอุ่น ห้ามใช้สีฟ้า/ขาวจ้า", dark and warm, no
// blue/harsh white). Checked across every reachable screen.
const MAX_LUMINANCE = 0.35;

async function assertScreenIsDark(page: Page, label: string): Promise<void> {
  const buffer = await page.screenshot();
  const samples = sampleLuminanceGrid(buffer);
  const violations = samples.filter((s) => s.luminance > MAX_LUMINANCE);
  expect(violations, `${label}: luminance violations at ${JSON.stringify(violations)}`).toEqual([]);
}

async function completeOnboarding(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByText('ปกติคุณใช้เวลานานแค่ไหนกว่าจะหลับ?').waitFor();
  await page.getByRole('button', { name: '15–30 นาที' }).click();
  await page.getByRole('button', { name: 'เริ่ม' }).waitFor();
}

test.describe('spec §14: relative luminance', () => {
  test('Onboarding', async ({ page }) => {
    await page.goto('/');
    await page.getByText('ปกติคุณใช้เวลานานแค่ไหนกว่าจะหลับ?').waitFor();
    await assertScreenIsDark(page, 'Onboarding');
  });

  test('Home', async ({ page }) => {
    await completeOnboarding(page);
    await assertScreenIsDark(page, 'Home');
  });

  test('Settle', async ({ page }) => {
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'เริ่ม' }).click();
    await page.getByText('มีอะไรอยากเก็บไว้ในขวดก่อนนอนไหม?').waitFor();
    await assertScreenIsDark(page, 'Settle');
  });

  test('Pond (play)', async ({ page }) => {
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'เริ่ม' }).click();
    await page.getByRole('button', { name: 'ข้าม' }).click();
    await page.locator('.pond canvas').waitFor();
    await page.waitForTimeout(500); // let the scene draw its first frame
    await assertScreenIsDark(page, 'Pond');
  });

  test('Listen', async ({ page }) => {
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'ฟังอย่างเดียว' }).click();
    await page.locator('.listen').waitFor();
    await assertScreenIsDark(page, 'Listen');
  });

  test('Sky', async ({ page }) => {
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'ท้องฟ้า' }).click();
    await page.getByRole('heading', { name: 'ท้องฟ้า' }).waitFor();
    await assertScreenIsDark(page, 'Sky');
  });

  test('Journal', async ({ page }) => {
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'สมุดความฝัน' }).click();
    await page.getByRole('heading', { name: 'สมุดความฝัน' }).waitFor();
    await assertScreenIsDark(page, 'Journal');
  });

  test('Stats', async ({ page }) => {
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'สถิติของฉัน' }).click();
    await page.getByRole('heading', { name: 'สถิติของฉัน' }).waitFor();
    await assertScreenIsDark(page, 'Stats');
  });

  test('Settings', async ({ page }) => {
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'ตั้งค่า' }).click();
    await page.getByRole('heading', { name: 'ตั้งค่า' }).waitFor();
    await assertScreenIsDark(page, 'Settings');
  });
});
