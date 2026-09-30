import { gameBus, emit, type HudPayload, type ResultPayload } from '../game/events';
import type { Action } from '../game/input/InputSystem';

const PhaserMathClamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export class Hud {
  private root: HTMLElement;
  private title!: HTMLElement;
  private hud!: HTMLElement;
  private result!: HTMLElement;
  private pause!: HTMLElement;
  private resumeButton!: HTMLButtonElement;
  private hp!: HTMLElement;
  private energy!: HTMLElement;
  private score!: HTMLElement;
  private combo!: HTMLElement;
  private zone!: HTMLElement;
  private tech!: HTMLElement;
  private boss!: HTMLElement;
  private bossBar!: HTMLElement;
  private bossName!: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.render();
    this.bind();
  }

  private render(): void {
    this.root.innerHTML = `
      <section class="title-screen screen visible" data-panel="title">
        <div class="scanlines"></div>
        <div class="title-copy">
          <div class="kicker">GAME STUDIO STYLE // INTERACTIVE BROWSER PROMO</div>
          <h1>RIFT<span>//</span><em>STUDIO</em></h1>
          <p>One playable run. Every system earns its screen time.</p>
          <div class="title-actions">
            <button data-command="start" class="cta">START SHOWCASE</button>
            <button data-command="resume" class="ghost resume">RESUME CHECKPOINT</button>
          </div>
          <div class="feature-strip">
            <b>PHASER</b><b>ARCADE PHYSICS</b><b>DOM HUD</b><b>TOUCH</b><b>GAMEPAD</b><b>WEB AUDIO</b><b>PWA</b>
          </div>
          <small class="controls">A/D move · SPACE jump · J attack · K dash · L parry · U overdrive</small>
        </div>
      </section>

      <section class="game-hud hidden">
        <div class="hud-top">
          <strong>RIFT//STUDIO</strong>
          <span class="zone">01 // FLOW LAB</span>
          <button class="pause-button" data-command="pause">Ⅱ</button>
        </div>
        <div class="meters">
          <div class="meter hp"><i></i><label>SYNC</label></div>
          <div class="meter energy"><i></i><label>OVERDRIVE</label></div>
        </div>
        <div class="score">000000</div>
        <div class="combo"></div>
        <div class="boss hidden"><span></span><div><i></i></div></div>
        <div class="tech-feed">READY // PHASER + TYPESCRIPT</div>
      </section>

      <section class="pause-panel screen">
        <div class="modal">
          <div class="kicker">SYSTEM HOLD</div>
          <h2>PAUSED</h2>
          <button data-command="pause" class="cta">RESUME</button>
          <button data-command="restart" class="ghost">RESTART RUN</button>
        </div>
      </section>

      <section class="result-panel screen">
        <div class="modal wide">
          <div class="kicker result-kicker">RUN COMPLETE</div>
          <h2 class="result-title">RIFT SEALED</h2>
          <p class="result-stats"></p>
          <button data-command="restart" class="cta">RUN AGAIN</button>
        </div>
      </section>

      <section class="touch-controls">
        <div class="virtual-stick" aria-label="Move">
          <div class="virtual-stick-ring"></div>
          <div class="virtual-stick-knob"></div>
        </div>
        <div class="touch-actions">
          <button data-tap="parry" class="mini parry">PARRY</button>
          <button data-tap="overdrive" class="mini overdrive">OD</button>
          <button data-tap="jump" class="jump">JUMP</button>
          <button data-tap="dash" class="dash">DASH</button>
          <button data-tap="attack" class="attack">ATK</button>
        </div>
      </section>
    `;

    this.title = this.root.querySelector('[data-panel="title"]') as HTMLElement;
    this.hud = this.root.querySelector('.game-hud') as HTMLElement;
    this.result = this.root.querySelector('.result-panel') as HTMLElement;
    this.pause = this.root.querySelector('.pause-panel') as HTMLElement;
    this.resumeButton = this.root.querySelector('.resume') as HTMLButtonElement;
    this.hp = this.root.querySelector('.meter.hp i') as HTMLElement;
    this.energy = this.root.querySelector('.meter.energy i') as HTMLElement;
    this.score = this.root.querySelector('.score') as HTMLElement;
    this.combo = this.root.querySelector('.combo') as HTMLElement;
    this.zone = this.root.querySelector('.zone') as HTMLElement;
    this.tech = this.root.querySelector('.tech-feed') as HTMLElement;
    this.boss = this.root.querySelector('.boss') as HTMLElement;
    this.bossBar = this.root.querySelector('.boss i') as HTMLElement;
    this.bossName = this.root.querySelector('.boss span') as HTMLElement;
  }

  private bind(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-command]').forEach(button => {
      button.addEventListener('click', () => emit('command', button.dataset.command || ''));
    });

    const stick = this.root.querySelector('.virtual-stick') as HTMLElement | null;
    const knob = this.root.querySelector('.virtual-stick-knob') as HTMLElement | null;
    if (stick && knob) {
      let activePointer: number | null = null;
      const updateStick = (event: PointerEvent) => {
        const rect = stick.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = event.clientX - cx;
        const dy = event.clientY - cy;
        const max = rect.width * .34;
        const length = Math.hypot(dx, dy) || 1;
        const scale = Math.min(1, max / length);
        const x = dx * scale;
        const y = dy * scale;
        knob.style.transform = `translate(${x}px,${y}px)`;
        emit('virtual-axis', { x: PhaserMathClamp(dx / max, -1, 1) });
      };
      const releaseStick = () => {
        activePointer = null;
        knob.style.transform = 'translate(0px,0px)';
        emit('virtual-axis', { x: 0 });
      };
      stick.addEventListener('pointerdown', event => {
        event.preventDefault();
        activePointer = event.pointerId;
        stick.setPointerCapture(event.pointerId);
        updateStick(event);
      });
      stick.addEventListener('pointermove', event => {
        if (activePointer !== event.pointerId) return;
        event.preventDefault();
        updateStick(event);
      });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(name => stick.addEventListener(name, releaseStick));
    }

    this.root.querySelectorAll<HTMLButtonElement>('[data-tap]').forEach(button => {
      const action = button.dataset.tap as Action;
      const set = (down: boolean) => emit('virtual', { action, down });
      button.addEventListener('pointerdown', event => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        set(true);
      });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(name => button.addEventListener(name, () => set(false)));
    });

    gameBus.addEventListener('ready', ((event: CustomEvent<{ hasSave: boolean; best: number }>) => {
      this.title.classList.add('visible');
      this.hud.classList.add('hidden');
      this.result.classList.remove('visible');
      this.pause.classList.remove('visible');
      this.resumeButton.classList.toggle('hidden', !event.detail.hasSave);
    }) as EventListener);

    gameBus.addEventListener('playing', () => {
      this.title.classList.remove('visible');
      this.result.classList.remove('visible');
      this.pause.classList.remove('visible');
      this.hud.classList.remove('hidden');
    });

    gameBus.addEventListener('hud', ((event: CustomEvent<HudPayload>) => this.updateHud(event.detail)) as EventListener);

    gameBus.addEventListener('paused', ((event: CustomEvent<{ paused: boolean }>) => {
      this.pause.classList.toggle('visible', event.detail.paused);
    }) as EventListener);

    gameBus.addEventListener('result', ((event: CustomEvent<ResultPayload>) => {
      const r = event.detail;
      this.hud.classList.add('hidden');
      this.pause.classList.remove('visible');
      this.result.classList.add('visible');
      (this.result.querySelector('.result-kicker') as HTMLElement).textContent = r.win ? 'RUN COMPLETE' : 'SIGNAL LOST';
      (this.result.querySelector('.result-title') as HTMLElement).textContent = r.win ? 'RIFT SEALED' : 'REBOOT REQUIRED';
      (this.result.querySelector('.result-stats') as HTMLElement).textContent =
        'SCORE ' + String(Math.floor(r.score)).padStart(6, '0') +
        ' · ' + r.defeated + ' TARGETS · ' + r.seconds.toFixed(1) + 's · BEST ' + String(Math.floor(r.best)).padStart(6, '0');
    }) as EventListener);

    window.addEventListener('keydown', event => {
      if (event.code === 'Escape') emit('command', 'pause');
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    }, { passive: false });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !this.hud.classList.contains('hidden')) emit('command', 'pause');
    });
  }

  private updateHud(data: HudPayload): void {
    this.hp.style.width = Math.max(0, data.hp) + '%';
    this.energy.style.width = Math.min(100, data.energy) + '%';
    this.score.textContent = String(Math.floor(data.score)).padStart(6, '0');
    this.combo.textContent = data.combo > 1 ? data.combo + 'x COMBO' : '';
    this.zone.textContent = data.zone;
    this.tech.textContent = data.tech;
    const showBoss = data.bossHp !== undefined;
    this.boss.classList.toggle('hidden', !showBoss);
    if (showBoss) {
      this.bossName.textContent = data.bossName || 'BOSS';
      this.bossBar.style.width = data.bossHp + '%';
    }
  }
}
