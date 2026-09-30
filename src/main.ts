import './style.css';
import { BrickStudio, type Mode } from './BrickStudio';
import { installFreshPagePolicy } from './pwa/FreshPage';
import type { PartKind } from './brickFactory';

const COLORS = [
  { name: 'Red', value: 0xe53935 },
  { name: 'Blue', value: 0x1e6bd6 },
  { name: 'Yellow', value: 0xf5c62b },
  { name: 'Green', value: 0x2f9e55 },
  { name: 'Orange', value: 0xf57c21 },
  { name: 'Pink', value: 0xd94b87 },
  { name: 'White', value: 0xf4f5f7 },
  { name: 'Black', value: 0x30343b }
];

const SIZES = [
  [1, 1], [1, 2], [1, 3], [1, 4],
  [2, 2], [2, 3], [2, 4]
] as const;

const PARTS: { kind: PartKind; label: string; mark: string }[] = [
  { kind: 'brick', label: 'BRICK', mark: '▦' },
  { kind: 'slope', label: 'SLOPE', mark: '◢' },
  { kind: 'hinge', label: 'HINGE', mark: '⌁' },
  { kind: 'wheel', label: 'WHEEL', mark: '◉' },
  { kind: 'window', label: 'WINDOW', mark: '▣' },
  { kind: 'roof', label: 'ROOF', mark: '⌃' },
  { kind: 'motor', label: 'MOTOR', mark: '⚙' },
  { kind: 'gear', label: 'GEAR', mark: '✣' },
  { kind: 'propeller', label: 'PROPELLER', mark: '✦' },
  { kind: 'program', label: 'PROGRAM', mark: '▣' }
];

function syncViewport(): void {
  const viewport = window.visualViewport;
  const height = Math.round(viewport?.height ?? window.innerHeight);
  const width = Math.round(viewport?.width ?? window.innerWidth);
  const top = Math.round(viewport?.offsetTop ?? 0);
  const left = Math.round(viewport?.offsetLeft ?? 0);
  const root = document.documentElement;
  root.style.setProperty('--app-height', height + 'px');
  root.style.setProperty('--app-width', width + 'px');
  root.style.setProperty('--app-top', top + 'px');
  root.style.setProperty('--app-left', left + 'px');
}

syncViewport();
window.addEventListener('resize', syncViewport, { passive: true });
window.addEventListener('orientationchange', () => window.setTimeout(syncViewport, 120), { passive: true });
window.visualViewport?.addEventListener('resize', syncViewport, { passive: true });
window.visualViewport?.addEventListener('scroll', syncViewport, { passive: true });

const viewport = document.querySelector('#viewport');
const ui = document.querySelector('#ui');
if (!(viewport instanceof HTMLElement) || !(ui instanceof HTMLElement)) throw new Error('Missing app roots');

ui.innerHTML = `
  <header class="topbar">
    <div class="brand"><strong>BRICK<span>//</span>LAB</strong><small>ADVANCED 3D BLOCK BUILDER</small></div>
    <div class="top-actions">
      <button data-action="undo" title="Undo">↶</button>
      <button data-action="redo" title="Redo">↷</button>
      <button data-action="view" title="Reset view">◎</button>
      <button data-action="drive" class="drive">DRIVE TEST</button>
      <button data-action="physics" class="physics">COLLAPSE</button>
    </div>
  </header>

  <aside class="toolbox">
    <section>
      <label>PART</label>
      <div class="part-grid"></div>
    </section>
    <section>
      <label>BASIC BRICK SIZE</label>
      <div class="size-grid"></div>
    </section>
    <section>
      <label>COLOR</label>
      <div class="color-grid"></div>
    </section>
    <section>
      <label>EDIT MODE</label>
      <div class="mode-grid">
        <button data-mode="build">BUILD</button>
        <button data-mode="select">SELECT</button>
        <button data-mode="move">MOVE</button>
        <button data-mode="remove" class="danger">REMOVE</button>
      </div>
    </section>
    <section class="selection-tools">
      <label>SELECTION</label>
      <div class="edit-grid">
        <button data-action="copy">COPY</button>
        <button data-action="rotate">ROTATE</button>
        <button data-action="up">UP</button>
        <button data-action="down">DOWN</button>
        <button data-action="all">ALL</button>
        <button data-action="deselect">NONE</button>
        <button data-action="hinge-close">HINGE −</button>
        <button data-action="hinge-open">HINGE +</button>
      </div>
    </section>
    <section>
      <label>PROGRAM</label>
      <div class="program-grid">
        <button data-program="manual">MANUAL</button>
        <button data-program="cruise">CRUISE</button>
        <button data-program="patrol">PATROL</button>
        <button data-program="spin">SPIN</button>
      </div>
    </section>
    <section>
      <label>SAVE SLOTS</label>
      <div class="slot-list">
        <div class="slot-row" data-slot="1"><b>S1</b><span></span><button data-save="1">SAVE</button><button data-load="1">LOAD</button></div>
        <div class="slot-row" data-slot="2"><b>S2</b><span></span><button data-save="2">SAVE</button><button data-load="2">LOAD</button></div>
        <div class="slot-row" data-slot="3"><b>S3</b><span></span><button data-save="3">SAVE</button><button data-load="3">LOAD</button></div>
      </div>
    </section>
    <section>
      <label>INSTRUCTIONS</label>
      <div class="instruction-grid">
        <button data-instruction-model="rover">ROVER</button>
        <button data-instruction-model="house">HOUSE</button>
        <button data-instruction-model="tower">TOWER</button>
        <button data-instruction-model="buggy">BUGGY</button>
      </div>
    </section>
  </aside>

  <aside class="instruction-panel">
    <small class="instruction-model-title">STEP BUILD // MINI ROVER</small>
    <strong class="instruction-count">STEP 1/7</strong>
    <p class="instruction-label">Rear wheel module</p>
    <div>
      <button data-action="instruction-prev">BACK</button>
      <button data-action="instruction-next" class="primary">ADD STEP</button>
    </div>
    <div>
      <button data-action="instruction-keep">KEEP MODEL</button>
      <button data-action="instruction-exit">EXIT</button>
    </div>
  </aside>

  <aside class="drive-panel">
    <small>WHEEL DRIVE TEST</small>
    <strong>HOLD TO DRIVE</strong>
    <div class="drive-controls">
      <button data-drive-steer="-1">LEFT</button>
      <button data-drive-throttle="1" class="primary">FWD</button>
      <button data-drive-steer="1">RIGHT</button>
      <button data-drive-throttle="-1">REV</button>
    </div>
    <p class="drive-stats"></p>
    <p>Physics uses model mass + MOTOR/GEAR/PROPELLER power. RETURN restores build position.</p>
  </aside>

  <footer class="bottombar">
    <div class="status">
      <b class="mode-label">BUILD MODE</b>
      <span class="piece-count">0 PIECES</span>
      <span class="selection-count"></span>
    </div>
    <div class="footer-actions">
      <button data-action="demo">SAMPLE HOUSE</button>
      <button data-action="clear" class="danger-text">CLEAR</button>
    </div>
  </footer>

  <div class="hint">BUILD: tap place · SELECT: multi-select · MOVE: drag selected · DRAG empty: orbit · PINCH: zoom</div>
  <div class="toast" aria-live="polite"></div>
`;

const partGrid = ui.querySelector('.part-grid') as HTMLElement;
for (const part of PARTS) {
  const button = document.createElement('button');
  button.className = 'part-choice';
  button.dataset.kind = part.kind;
  button.innerHTML = `<i>${part.mark}</i><span>${part.label}</span>`;
  partGrid.appendChild(button);
}

const sizeGrid = ui.querySelector('.size-grid') as HTMLElement;
for (const [w, d] of SIZES) {
  const button = document.createElement('button');
  button.className = 'brick-choice';
  button.dataset.w = String(w);
  button.dataset.d = String(d);
  button.innerHTML = `<i style="--w:${w};--d:${d}"></i><span>${w}×${d}</span>`;
  sizeGrid.appendChild(button);
}

const colorGrid = ui.querySelector('.color-grid') as HTMLElement;
for (const color of COLORS) {
  const button = document.createElement('button');
  button.className = 'color-choice';
  button.dataset.color = String(color.value);
  button.title = color.name;
  button.style.setProperty('--c', '#' + color.value.toString(16).padStart(6, '0'));
  colorGrid.appendChild(button);
}

const modeLabel = ui.querySelector('.mode-label') as HTMLElement;
const pieceCount = ui.querySelector('.piece-count') as HTMLElement;
const selectionCount = ui.querySelector('.selection-count') as HTMLElement;
const instructionCount = ui.querySelector('.instruction-count') as HTMLElement;
const instructionLabel = ui.querySelector('.instruction-label') as HTMLElement;
const instructionModelTitle = ui.querySelector('.instruction-model-title') as HTMLElement;
const driveStats = ui.querySelector('.drive-stats') as HTMLElement;
const toast = ui.querySelector('.toast') as HTMLElement;
let toastTimer = 0;

function showToast(text: string): void {
  toast.textContent = text;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 1300);
}

function modeName(mode: Mode): string {
  if (mode === 'instruction') return 'INSTRUCTION';
  return mode.toUpperCase() + ' MODE';
}

const studio = new BrickStudio(viewport, current => {
  pieceCount.textContent = current.pieceCount + (current.pieceCount === 1 ? ' PIECE' : ' PIECES');
  modeLabel.textContent = current.physicsActive ? 'PHYSICS RUNNING' : modeName(current.currentMode);
  selectionCount.textContent = current.selectionCount ? `${current.selectionCount} SELECTED` : '';

  ui.dataset.mode = current.currentMode;
  ui.classList.toggle('physics-active', current.physicsActive);
  ui.classList.toggle('drive-active', current.driveActive);

  const spec = current.currentSpec;
  ui.querySelectorAll<HTMLButtonElement>('.part-choice').forEach(button => {
    button.classList.toggle('active', button.dataset.kind === spec.kind);
  });
  ui.querySelectorAll<HTMLButtonElement>('.brick-choice').forEach(button => {
    button.classList.toggle('active',
      spec.kind === 'brick' &&
      Number(button.dataset.w) === spec.w &&
      Number(button.dataset.d) === spec.d
    );
  });
  ui.querySelectorAll<HTMLButtonElement>('.color-choice').forEach(button => {
    button.classList.toggle('active', Number(button.dataset.color) === spec.color);
  });
  ui.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.mode === current.currentMode);
  });

  const physicsButton = ui.querySelector('[data-action="physics"]') as HTMLButtonElement;
  physicsButton.textContent = current.physicsActive ? 'RESTORE' : 'COLLAPSE';
  const driveButton = ui.querySelector('[data-action="drive"]') as HTMLButtonElement;
  driveButton.textContent = current.driveActive ? 'RETURN' : 'DRIVE TEST';
  driveStats.textContent =
    `${current.wheelCount} WHEEL · ${current.motorCount} MOTOR · ${current.gearCount} GEAR · ${current.propellerCount} PROP · ${current.programMode.toUpperCase()}`;

  ui.querySelectorAll<HTMLButtonElement>('[data-program]').forEach(button => {
    button.classList.toggle('active', button.dataset.program === current.programMode);
  });

  for (let slot = 1; slot <= 3; slot++) {
    const row = ui.querySelector(`.slot-row[data-slot="${slot}"] span`);
    if (row) row.textContent = current.slotInfo(slot);
  }

  const instruction = current.instructionStatus;
  instructionCount.textContent = instruction.active
    ? `STEP ${instruction.step}/${instruction.total}`
    : 'STEP 1/7';
  instructionLabel.textContent = instruction.label;
  instructionModelTitle.textContent = 'STEP BUILD // ' + instruction.model;
});

partGrid.querySelectorAll<HTMLButtonElement>('.part-choice').forEach(button => {
  button.addEventListener('click', () => {
    studio.setPartKind(button.dataset.kind as PartKind);
  });
});

sizeGrid.querySelectorAll<HTMLButtonElement>('.brick-choice').forEach(button => {
  button.addEventListener('click', () => {
    studio.setSpec({
      kind: 'brick',
      w: Number(button.dataset.w),
      d: Number(button.dataset.d)
    });
  });
});

colorGrid.querySelectorAll<HTMLButtonElement>('.color-choice').forEach(button => {
  button.addEventListener('click', () => {
    const color = Number(button.dataset.color);
    if ((studio.currentMode === 'select' || studio.currentMode === 'move') && studio.selectionCount > 0) {
      showToast(studio.paintSelection(color) ? 'SELECTION PAINTED' : 'PAINT FAILED');
    } else {
      studio.setSpec({ color });
    }
  });
});

ui.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
  button.addEventListener('click', () => studio.setMode(button.dataset.mode as Mode));
});

ui.querySelector('[data-action="rotate"]')?.addEventListener('click', () => {
  showToast(studio.rotateSelection() ? 'ROTATED' : 'ROTATION BLOCKED');
});
ui.querySelector('[data-action="undo"]')?.addEventListener('click', () => studio.undo());
ui.querySelector('[data-action="redo"]')?.addEventListener('click', () => studio.redo());
ui.querySelector('[data-action="view"]')?.addEventListener('click', () => studio.resetView());
ui.querySelector('[data-action="copy"]')?.addEventListener('click', () => showToast(studio.copySelection() ? 'SELECTION COPIED' : 'SELECT PARTS FIRST'));
ui.querySelector('[data-action="up"]')?.addEventListener('click', () => showToast(studio.liftSelection(1) ? 'SELECTION RAISED' : 'CANNOT MOVE UP'));
ui.querySelector('[data-action="down"]')?.addEventListener('click', () => showToast(studio.liftSelection(-1) ? 'SELECTION LOWERED' : 'CANNOT MOVE DOWN'));
ui.querySelector('[data-action="all"]')?.addEventListener('click', () => studio.selectAll());
ui.querySelector('[data-action="deselect"]')?.addEventListener('click', () => studio.clearSelection());
ui.querySelector('[data-action="hinge-close"]')?.addEventListener('click', () => {
  showToast(studio.adjustSelectedHinges(-15) ? 'HINGE CLOSED' : 'SELECT A HINGE');
});
ui.querySelector('[data-action="hinge-open"]')?.addEventListener('click', () => {
  showToast(studio.adjustSelectedHinges(15) ? 'HINGE OPENED' : 'SELECT A HINGE');
});
ui.querySelectorAll<HTMLButtonElement>('[data-program]').forEach(button => {
  button.addEventListener('click', () => {
    const mode = button.dataset.program as 'manual' | 'cruise' | 'patrol' | 'spin';
    showToast(studio.setProgramMode(mode) ? ('PROGRAM // ' + mode.toUpperCase()) : 'ADD A PROGRAM BLOCK');
  });
});

ui.querySelector('[data-action="drive"]')?.addEventListener('click', () => {
  showToast(
    studio.toggleDrive()
      ? (studio.driveActive ? 'PHYSICS DRIVE STARTED' : 'BUILD POSITION RESTORED')
      : 'ADD 2 WHEELS OR A PROPELLER'
  );
});
ui.querySelector('[data-action="physics"]')?.addEventListener('click', () => studio.toggleCollapse());

ui.querySelectorAll<HTMLButtonElement>('[data-save]').forEach(button => {
  button.addEventListener('click', () => {
    const slot = Number(button.dataset.save);
    showToast(studio.saveSlot(slot) ? `SLOT ${slot} SAVED` : 'SAVE FAILED');
  });
});
ui.querySelectorAll<HTMLButtonElement>('[data-load]').forEach(button => {
  button.addEventListener('click', () => {
    const slot = Number(button.dataset.load);
    showToast(studio.loadSlot(slot) ? `SLOT ${slot} LOADED` : `SLOT ${slot} EMPTY`);
  });
});

ui.querySelectorAll<HTMLButtonElement>('[data-instruction-model]').forEach(button => {
  button.addEventListener('click', () => studio.startInstructions(button.dataset.instructionModel ?? 'rover'));
});
ui.querySelector('[data-action="instruction-prev"]')?.addEventListener('click', () => studio.instructionPrev());
ui.querySelector('[data-action="instruction-next"]')?.addEventListener('click', () => {
  if (!studio.instructionNext()) showToast('INSTRUCTIONS COMPLETE');
});
ui.querySelector('[data-action="instruction-keep"]')?.addEventListener('click', () => {
  studio.keepInstructionModel();
  showToast('GUIDED MODEL KEPT');
});
ui.querySelector('[data-action="instruction-exit"]')?.addEventListener('click', () => studio.stopInstructions(true));

let driveThrottle = 0;
let driveSteer = 0;
const syncDrive = () => studio.setDriveControl(driveThrottle, driveSteer);

ui.querySelectorAll<HTMLButtonElement>('[data-drive-throttle]').forEach(button => {
  const value = Number(button.dataset.driveThrottle);
  const start = (event: PointerEvent) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    driveThrottle = value;
    syncDrive();
  };
  const end = () => {
    driveThrottle = 0;
    syncDrive();
  };
  button.addEventListener('pointerdown', start);
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(name => button.addEventListener(name, end));
});

ui.querySelectorAll<HTMLButtonElement>('[data-drive-steer]').forEach(button => {
  const value = Number(button.dataset.driveSteer);
  const start = (event: PointerEvent) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    driveSteer = value;
    syncDrive();
  };
  const end = () => {
    driveSteer = 0;
    syncDrive();
  };
  button.addEventListener('pointerdown', start);
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(name => button.addEventListener(name, end));
});

ui.querySelector('[data-action="demo"]')?.addEventListener('click', () => {
  studio.demoHouse();
  showToast('SAMPLE HOUSE BUILT');
});
ui.querySelector('[data-action="clear"]')?.addEventListener('click', () => {
  if (studio.pieceCount === 0 || studio.physicsActive) return;
  if (window.confirm('すべてのパーツを消しますか？')) {
    studio.clear();
    showToast('BASEPLATE CLEARED');
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    syncViewport();
    studio.resize();
  }
});
window.addEventListener('resize', () => studio.resize(), { passive: true });
window.visualViewport?.addEventListener('resize', () => studio.resize(), { passive: true });

studio.setSpec({ kind: 'brick', w: 2, d: 4, color: COLORS[0].value });
void installFreshPagePolicy();
