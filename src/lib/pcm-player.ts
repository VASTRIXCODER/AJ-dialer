"use client";

// Plays mixed PCM16 8kHz frames (base64) streamed from the live-audio relay via
// the Web Audio API, with a small jitter buffer so monitoring stays close to
// real time. Shared by the AI call dashboard and the human-call monitor.

export type PcmPlayer = { play: (b64: string) => void; close: () => void };

export function createPcmPlayer(): PcmPlayer {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new Ctx();
  void ctx.resume?.();
  let next = 0;
  return {
    play(b64) {
      const bin = atob(b64);
      const len = bin.length >> 1;
      const f32 = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        let v = (bin.charCodeAt(i * 2 + 1) << 8) | bin.charCodeAt(i * 2);
        if (v >= 32768) v -= 65536;
        f32[i] = v / 32768;
      }
      const buf = ctx.createBuffer(1, len, 8000);
      buf.getChannelData(0).set(f32);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      const now = ctx.currentTime;
      if (next < now) next = now + 0.12; // jitter buffer
      src.start(next);
      next += buf.duration;
    },
    close() {
      try {
        void ctx.close();
      } catch {
        /* noop */
      }
    },
  };
}
