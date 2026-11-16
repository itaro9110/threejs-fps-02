// audio.js — all sound is synthesized with WebAudio. No audio files, no network.
export function createAudio() {
  const a = { ctx: null, master: null, muted: false, noiseBuf: null };
  a.ensure = () => {
    if (a.ctx) { if (a.ctx.state === 'suspended') a.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    a.ctx = new AC();
    a.master = a.ctx.createGain();
    a.master.gain.value = 0.5;
    a.master.connect(a.ctx.destination);
    const len = a.ctx.sampleRate * 0.5;
    a.noiseBuf = a.ctx.createBuffer(1, len, a.ctx.sampleRate);
    const d = a.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  };
  a.setMuted = (m) => {
    a.muted = m;
    if (a.master) a.master.gain.value = m ? 0 : 0.5;
  };
  // Short oscillator blip with pitch slide.
  a.tone = (f0, f1, dur, type, vol, delay = 0) => {
    if (!a.ctx || a.muted) return;
    const t = a.ctx.currentTime + delay;
    const o = a.ctx.createOscillator();
    const g = a.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(a.master);
    o.start(t); o.stop(t + dur + 0.02);
  };
  // Filtered noise burst (gunshots, explosions, footsteps).
  a.noise = (dur, freq, vol, q = 1, delay = 0, type = 'lowpass') => {
    if (!a.ctx || a.muted) return;
    const t = a.ctx.currentTime + delay;
    const s = a.ctx.createBufferSource();
    s.buffer = a.noiseBuf; s.loop = true;
    const f = a.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = a.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(a.master);
    s.start(t); s.stop(t + dur + 0.02);
  };
  a.shot = (kind, distant = false) => {
    if (!a.ctx) return;
    const v = distant ? 0.10 : 0.5;
    if (kind === 'p9') { a.noise(0.09, 2400, v); a.tone(320, 90, 0.08, 'square', v * 0.5); }
    else if (kind === 'kestrel') { a.noise(0.13, 1700, v); a.tone(210, 55, 0.12, 'sawtooth', v * 0.6); }
    else if (kind === 'jackal') { a.noise(0.08, 2900, v * 0.8); a.tone(360, 110, 0.06, 'square', v * 0.4); }
    else if (kind === 'longbow') { a.noise(0.28, 900, v * 1.1); a.tone(140, 38, 0.26, 'sawtooth', v * 0.8); }
    else if (kind === 'mauler') { a.noise(0.22, 650, v * 1.25); a.tone(130, 34, 0.22, 'sawtooth', v * 0.9); a.noise(0.09, 3200, v * 0.5, 1, 0, 'highpass'); }
  };
  a.dry = () => a.tone(1400, 900, 0.03, 'square', 0.12); // empty click
  a.reload = () => { a.tone(900, 500, 0.05, 'square', 0.14); a.tone(700, 420, 0.05, 'square', 0.14, 0.16); a.tone(1100, 700, 0.06, 'square', 0.18, 0.34); };
  a.hit = () => a.tone(950, 700, 0.06, 'sine', 0.22);
  a.headshot = () => { a.tone(1500, 1500, 0.05, 'sine', 0.25); a.tone(2100, 2100, 0.07, 'sine', 0.22, 0.05); };
  a.hurt = () => a.noise(0.12, 500, 0.25);
  a.footstep = (run) => a.noise(0.06, run ? 700 : 420, run ? 0.10 : 0.06, 1);
  a.beep = (hi) => a.tone(hi ? 1250 : 880, hi ? 1250 : 880, 0.09, 'sine', 0.2);
  a.plantDone = () => { a.beep(true); a.beep(true); };
  a.explosion = () => {
    a.noise(1.1, 320, 0.9, 0.7);
    a.tone(90, 28, 0.9, 'sine', 0.8);
    a.noise(0.4, 2400, 0.3, 1, 0, 'highpass');
  };
  a.flashbang = () => { a.tone(2600, 2400, 0.7, 'sine', 0.16); a.noise(0.25, 5000, 0.4, 1, 0, 'highpass'); };
  a.sting = (win) => {
    if (win) { a.tone(523, 523, 0.16, 'triangle', 0.25); a.tone(659, 659, 0.16, 'triangle', 0.25, 0.14); a.tone(784, 784, 0.34, 'triangle', 0.3, 0.28); }
    else { a.tone(392, 392, 0.2, 'triangle', 0.25); a.tone(330, 330, 0.2, 'triangle', 0.25, 0.18); a.tone(262, 247, 0.5, 'triangle', 0.28, 0.36); }
  };
  a.roundStart = () => { a.tone(660, 660, 0.1, 'triangle', 0.2); a.tone(880, 880, 0.18, 'triangle', 0.22, 0.1); };
  a.click = () => a.tone(1200, 800, 0.04, 'square', 0.12);
  a.buy = () => { a.tone(990, 990, 0.06, 'sine', 0.2); a.tone(1320, 1320, 0.1, 'sine', 0.2, 0.06); };
  // Ambient music bed: a quiet synth pad that glides through Am–F–C–G.
  // Three detuned triangle oscillators + a sub sine, through a breathing lowpass.
  // Runs under the SFX on the same master gain, so M mutes everything.
  a.startMusic = () => {
    if (!a.ctx || a.music) return;
    const chords = [
      [110.00, 130.81, 164.81], // Am
      [87.31, 110.00, 130.81],  // F
      [130.81, 164.81, 196.00], // C
      [98.00, 123.47, 146.83],  // G
    ];
    const gain = a.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(a.master);
    const filt = a.ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 520; filt.Q.value = 0.6;
    filt.connect(gain);
    const oscs = chords[0].map((f) => {
      const o = a.ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = f;
      o.connect(filt); o.start();
      return o;
    });
    const sub = a.ctx.createOscillator();
    sub.type = 'sine'; sub.frequency.value = chords[0][0] / 2;
    const subGain = a.ctx.createGain(); subGain.gain.value = 0.6;
    sub.connect(subGain); subGain.connect(filt); sub.start();
    const lfo = a.ctx.createOscillator(); lfo.frequency.value = 0.06;
    const lfoGain = a.ctx.createGain(); lfoGain.gain.value = 180;
    lfo.connect(lfoGain); lfoGain.connect(filt.frequency); lfo.start();
    gain.gain.linearRampToValueAtTime(0.055, a.ctx.currentTime + 3);
    let ci = 0;
    a.musicTimer = setInterval(() => {
      if (!a.ctx) return;
      ci = (ci + 1) % chords.length;
      const t = a.ctx.currentTime;
      chords[ci].forEach((f, i) => oscs[i].frequency.linearRampToValueAtTime(f, t + 2.5));
      sub.frequency.linearRampToValueAtTime(chords[ci][0] / 2, t + 2.5);
    }, 4500);
    a.music = { oscs, sub, gain, filt, lfo };
  };
  return a;
}
