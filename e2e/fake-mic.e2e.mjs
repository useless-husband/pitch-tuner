// 端到端測試：Chromium 假麥克風餵入合成的 A4 440 Hz WAV，驗證畫面顯示 A4 且偏差在 ±5 音分內。
// 用法：PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node e2e/fake-mic.e2e.mjs
// （零依賴專案；Playwright 只有這個選用的 e2e 腳本會用到，CI 不執行）
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { makeWav } from './make-wav.mjs';
import { startServer } from './serve.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = mkdtempSync(join(tmpdir(), 'pitch-tuner-e2e-'));
const wav = join(dir, 'a4.wav');
const FREQ = Number(process.env.E2E_FREQ || 440);
makeWav(wav, { freq: FREQ });

const server = await startServer(0);
const base = `http://localhost:${server.address().port}/`;
const errors = [];
let failed = false;

async function run(mode, algorithm) {
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`],
  });
  try {
    const ctx = await browser.newContext({ permissions: ['microphone'], viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(base + (mode ? `?mode=${mode}` : ''));
    await page.selectOption('#algorithm', algorithm);
    await page.click('#mic-toggle');
    await page.waitForFunction(() => document.querySelector('#tuner').dataset.state !== 'idle', null, { timeout: 15000 });
    await page.waitForTimeout(1500);
    const read = await page.evaluate(() => ({
      name: document.querySelector('#note-name').textContent,
      octave: document.querySelector('#note-octave').textContent,
      freq: parseFloat(document.querySelector('#freq-value').textContent),
      cents: parseFloat(document.querySelector('#cents-value').textContent.replace('−', '-')),
      state: document.querySelector('#tuner').dataset.state,
      mode: window.__tuner.mode,
    }));
    console.log(`[${mode || 'auto'}/${algorithm}]`, JSON.stringify(read));
    assert.equal(read.name + read.octave, 'A4');
    assert.ok(Math.abs(read.cents) <= 5, `cents ${read.cents}`);
    assert.ok(Math.abs(read.freq - FREQ) < 1.5, `freq ${read.freq}`);
    assert.equal(read.state, 'in-tune');
    if (mode) assert.equal(read.mode, mode);
    if (process.env.E2E_SHOT && !mode && algorithm === 'yin') await page.screenshot({ path: process.env.E2E_SHOT });
  } finally {
    await browser.close();
  }
}

try {
  await run(null, 'yin');
  await run(null, 'mpm');
  await run('script', 'yin');
  await run('analyser', 'mpm');
  assert.deepEqual(errors, []);
  console.log('e2e OK');
} catch (e) {
  failed = true;
  console.error('e2e FAILED:', e.message, errors);
} finally {
  server.close();
  rmSync(dir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
