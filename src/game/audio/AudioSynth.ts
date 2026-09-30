export class AudioSynth {
  private ctx?: AudioContext;
  private nextBeat = 0;
  private beat = 0;

  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (Ctx) this.ctx = new Ctx();
    }
    void this.ctx?.resume();
  }

  private tone(freq: number, duration: number, type: OscillatorType, gain: number, slide = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(35, freq * slide), ctx.currentTime + duration);
    amp.gain.setValueAtTime(gain, ctx.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  sfx(name: 'jump'|'dash'|'hit'|'parry'|'hurt'|'overdrive'|'win'|'pickup'): void {
    if (name === 'jump') this.tone(280, .09, 'square', .025, 1.8);
    if (name === 'dash') this.tone(110, .12, 'sawtooth', .028, 3);
    if (name === 'hit') { this.tone(92, .07, 'square', .045, .55); this.tone(520, .04, 'triangle', .016, .65); }
    if (name === 'parry') { this.tone(760, .15, 'triangle', .05, 1.7); this.tone(1180, .08, 'sine', .025, 1.1); }
    if (name === 'hurt') this.tone(105, .2, 'sawtooth', .045, .45);
    if (name === 'overdrive') { this.tone(150, .35, 'sawtooth', .045, 5); this.tone(72, .42, 'square', .02, 2); }
    if (name === 'win') { this.tone(330, .18, 'triangle', .03, 1.5); this.tone(495, .28, 'triangle', .03, 1.5); }
    if (name === 'pickup') this.tone(620, .09, 'sine', .025, 1.35);
  }

  tick(overdrive: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.currentTime < this.nextBeat) return;
    const step = 60 / (overdrive ? 150 : 118) / 2;
    this.nextBeat = ctx.currentTime + step;
    this.beat = (this.beat + 1) % 8;
    if (this.beat % 2 === 0) this.tone(55, .08, 'sine', .009, .78);
    if (this.beat === 4) this.tone(110, .04, 'square', .005, .8);
  }
}
