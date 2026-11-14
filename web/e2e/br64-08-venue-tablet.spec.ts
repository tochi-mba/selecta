// Browser-level acceptance harness; actual speakers and OS suspension need physical devices.
// This .spec.ts is intentionally outside the legacy *.e2e.ts suite until Agent 10 wires
// the device-qualification Playwright project. No mock may claim real audio proof.
import { expect, test } from '@playwright/test';

const FLEET = '/business-harness.html?scenario=lf13_fleet';

// Generated synthetic PCM, no copyrighted media and no hardware-output claim.
function silentWav(): Buffer {
  const sampleRate = 22050;
  const samples = Math.round(sampleRate / 2);
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVE', 8); bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  return bytes;
}

test('manager has browser-native tablet setup and accurate speaker limitations', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();
  try {
    await page.goto(FLEET);
    await page.getByRole('button', { name: 'Review Demo venue 1 readiness' }).click();
    const setup = page.getByTestId('br64-08-tablet-setup');
    await expect(setup).toBeVisible();
    await expect(setup.getByText(/iPad, Android tablet or laptop/)).toBeVisible();
    await expect(setup.getByRole('button', { name: 'Tap to start here' })).toBeDisabled();
    await expect(setup.getByText(/does not register a Cloud playback session/i)).toBeVisible();
    await setup.getByLabel('Select music from this device (no upload)')
      .setInputFiles({ name: 'synthetic.wav', mimeType: 'audio/wav', buffer: silentWav() });
    await setup.getByLabel(/I have permission to use these local recordings/).check();
    await setup.getByLabel(/I have personally reviewed the selected recordings/).check();
    await expect(setup.getByRole('button', { name: 'Tap to start here' })).toBeEnabled();
    await setup.getByRole('button', { name: 'Tap to start here' }).click();
    await expect(setup.getByText(/Audio started on this device/)).toBeVisible();
    // A real source node ran, but automation cannot confirm audible venue speakers.
    await expect(setup.getByText(/Speaker test: Not verified/)).toBeVisible();
  } finally { await context.close(); }
});

test('staff phone remote view does not put venue music on staff phone', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const page = await context.newPage();
  try {
    await page.goto(FLEET);
    await page.getByRole('button', { name: 'Review Demo venue 4 readiness' }).click();
    await page.getByRole('button', { name: 'Staff phone view' }).click();
    await expect(page.getByTestId('staff-deck')).toBeVisible();
    await expect(page.locator('audio, video, source')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Skip' })).toBeVisible();
  } finally { await context.close(); }
});
