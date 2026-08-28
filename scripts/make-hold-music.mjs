// Generates public/hold-music.wav — the audio Twilio plays to a held caller.
//
// Why synthesize: the hold endpoint used to stream demo.twilio.com's sample
// mp3 to real customers. This produces an original, royalty-free ambient chord
// loop we own outright, at telephony-native 8 kHz mono PCM16 (what a PSTN leg
// hears anyway), ~380 KB for a 24 s seamless loop that <Play loop="0"> repeats.
//
// Run: node scripts/make-hold-music.mjs   (deterministic — same file every run)

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 8000; // telephony sample rate
const CHORD_SEC = 6;
const CHORDS = [
  // Gentle Cmaj7 → Am9 → Fmaj7 → G6 progression, low register for warmth.
  [130.81, 164.81, 196.0, 246.94], // C3 E3 G3 B3
  [110.0, 164.81, 220.0, 246.94], // A2 E3 A3 B3
  [87.31, 174.61, 220.0, 261.63], // F2 F3 A3 C4
  [98.0, 196.0, 246.94, 293.66], // G2 G3 B3 D4
];
const AMP = 0.22; // headroom — hold music should sit UNDER speech level

const total = CHORDS.length * CHORD_SEC * SR;
const pcm = new Float64Array(total);

for (let ci = 0; ci < CHORDS.length; ci++) {
  const start = ci * CHORD_SEC * SR;
  const len = CHORD_SEC * SR;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    // Slow swell in/out so chords cross-fade into silence — loop-safe.
    const pos = i / len;
    const env = Math.sin(Math.PI * Math.min(1, Math.max(0, pos))) ** 1.5;
    let s = 0;
    for (const [ni, f] of CHORDS[ci].entries()) {
      // Two slightly detuned partials per note for chorus warmth; the higher
      // notes are quieter so the low root carries.
      const g = 1 / (1 + ni * 0.45);
      s += g * Math.sin(2 * Math.PI * f * t);
      s += g * 0.5 * Math.sin(2 * Math.PI * (f * 1.003) * t + ni);
      // A whisper of the octave for shimmer.
      s += g * 0.18 * Math.sin(2 * Math.PI * f * 2 * t + ni * 2);
    }
    // Very slow tremolo so a long hold doesn't feel static.
    const trem = 0.9 + 0.1 * Math.sin(2 * Math.PI * 0.15 * (start / SR + t));
    pcm[start + i] += s * env * trem;
  }
}

// Normalize to AMP peak, then PCM16.
let peak = 0;
for (const v of pcm) peak = Math.max(peak, Math.abs(v));
const scale = (AMP / (peak || 1)) * 32767;
const data = Buffer.alloc(total * 2);
for (let i = 0; i < total; i++) data.writeInt16LE(Math.round(pcm[i] * scale), i * 2);

// Minimal RIFF/WAVE header (PCM16 mono).
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16); // fmt chunk size
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 2, 28); // byte rate
header.writeUInt16LE(2, 32); // block align
header.writeUInt16LE(16, 34); // bits per sample
header.write("data", 36);
header.writeUInt32LE(data.length, 40);

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "hold-music.wav");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([header, data]));
console.log(`wrote ${out} (${((header.length + data.length) / 1024).toFixed(0)} KB, ${total / SR}s loop)`);
