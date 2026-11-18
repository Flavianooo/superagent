// Ses dosyası gerektirmeyen kısa bildirim sesleri (Web Audio ile üretilir).
let ctx: AudioContext | null = null;

function tone(ac: AudioContext, freq: number, start: number, dur: number, gain: number): void {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

/** done: iki notalı çan; waiting: kısa çift "dıt" uyarısı. */
export function chime(kind: 'done' | 'waiting'): void {
  ctx ??= new AudioContext();
  const ac = ctx;
  if (ac.state === 'suspended') void ac.resume();
  const t = ac.currentTime + 0.02;
  if (kind === 'done') {
    // Çan: temel ton + parlak harmonik, uzun sönüm.
    tone(ac, 880, t, 1.2, 0.22);
    tone(ac, 1760, t, 0.6, 0.06);
    tone(ac, 1318.5, t + 0.18, 1.4, 0.2);
    tone(ac, 2637, t + 0.18, 0.5, 0.05);
  } else {
    tone(ac, 1046.5, t, 0.18, 0.18);
    tone(ac, 1046.5, t + 0.22, 0.18, 0.18);
  }
}
