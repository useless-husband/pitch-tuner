// 產生 16-bit PCM 單聲道 WAV（供 Chromium 假麥克風使用）
import { writeFileSync } from 'node:fs';

export function makeWav(path, { freq = 440, seconds = 6, sampleRate = 48000, amp = 0.5, harmonics = [1, 0.4, 0.2] } = {}) {
  const n = Math.round(seconds * sampleRate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  const norm = harmonics.reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i++) {
    let v = 0;
    harmonics.forEach((h, k) => { v += h * Math.sin((2 * Math.PI * freq * (k + 1) * i) / sampleRate); });
    buf.writeInt16LE(Math.round((amp * v * 32767) / norm), 44 + i * 2);
  }
  writeFileSync(path, buf);
}
