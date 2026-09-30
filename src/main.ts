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
    <div class="toolbox-head">
      <strong>BUILD TOOLS</strong>
      <button data-action="tools" aria-label="Hide build tools">‹</button>
    </div>
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
      <label>PROGRAM PRESET</label>
      <div class="program-grid">
        <button data-program="manual">MANUAL</button>
        <button data-program="cruise">CRUISE</button>
        <button data-program="patrol">PATROL</button>
        <button data-program="spin">SPIN</button>
      </div>
    </section>
    <section class="visual-program-section">
      <label>VISUAL PROGRAM</label>
      <div class="command-grid">
        <button data-program-command="motorOn">MOTOR ON</button>
        <button data-program-command="motorOff">MOTOR OFF</button>
        <button data-program-command="forward">FORWARD</button>
        <button data-program-command="reverse">REVERSE</button>
        <button data-program-command="left">LEFT</button>
        <button data-program-command="right">RIGHT</button>
        <button data-program-command="hingeOpen">HINGE OPEN</button>
        <button data-program-command="hingeClose">HINGE CLOSE</button>
        <button data-program-command="wait">WAIT</button>
      </div>
      <div class="program-sequence"></div>
      <div class="program-edit-row">
        <button data-action="program-back">REMOVE LAST</button>
        <button data-action="program-clear">CLEAR</button>
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
  <button class="tools-open-tab" data-action="tools">TOOLS</button>

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
      <button data-action="samples">SAMPLE GALLERY</button>
      <button data-action="clear" class="danger-text">CLEAR</button>
    </div>
  </footer>

  <aside class="sample-panel" aria-hidden="true">
    <div class="sample-head">
      <div>
        <small>INTEGRATED SHOWCASES</small>
        <strong>LARGE SAMPLE GALLERY</strong>
      </div>
      <button data-action="samples-close">×</button>
    </div>
    <div class="sample-section-title">DIORAMA SCALE</div>
    <div class="sample-grid diorama-grid">
      <button class="sample-card diorama" data-sample="skyport">
        <b>SKYPORT CITY</b>
        <span>高架空港・管制塔・サービス街区</span>
        <em>TERMINAL · TOWER · 16+ WHEELS · GEARS · PROGRAM</em>
      </button>
      <button class="sample-card diorama" data-sample="harbor">
        <b>INDUSTRIAL HARBOR</b>
        <span>港湾・倉庫・クレーン・貨物ヤード</span>
        <em>CRANES · CARGO · MOTORS · GEARS · HINGES</em>
      </button>
      <button class="sample-card diorama" data-sample="alpine">
        <b>ALPINE RESCUE BASE</b>
        <span>山岳基地・橋・格納庫・救難車両</span>
        <em>BRIDGE · RESCUE ROVER · SUSPENSION · PROGRAM</em>
      </button>
      <button class="sample-card diorama" data-sample="megaforge">
        <b>MEGAFORGE DISTRICT</b>
        <span>巨大工場街区・ギア壁・搬送ライン</span>
        <em>FACTORY · GEAR WALL · GATES · TEST LANE</em>
      </button>
    </div>
    <div class="sample-section-title">LARGE VEHICLES & STRUCTURES</div>
    <div class="sample-grid">
      <button class="sample-card" data-sample="titan">
        <b>TITAN HAULER</b>
        <span>大型16輪トランスポーター</span>
        <em>WHEELS · MOTOR · GEAR · PROP · PROGRAM · HINGE</em>
      </button>
      <button class="sample-card" data-sample="rescue">
        <b>RESCUE COMMAND</b>
        <span>多関節レスキュー車両</span>
        <em>SUSPENSION · DOORS · GEARS · PROGRAM</em>
      </button>
      <button class="sample-card" data-sample="fortress">
        <b>GEARWORKS FORTRESS</b>
        <span>大型機械要塞 / 崩壊デモ向け</span>
        <em>GEAR TRAIN · HINGES · COLLAPSE · PROP</em>
      </button>
      <button class="sample-card" data-sample="explorer">
        <b>POWER EXPLORER</b>
        <span>高密度プログラム実験車</span>
        <em>MOTOR · GEAR · PROP · VISUAL PROGRAM</em>
      </button>
      <button class="sample-card compact" data-sample="house">
        <b>STARTER HOUSE</b>
        <span>基本建築サンプル</span>
        <em>WINDOW · ROOF · HINGE · SLOPE</em>
      </button>
    </div>
    <p>車両サンプルは DRIVE TEST 対応。ジオラマは編集・SAVE・COLLAPSE向けで、全景をそのまま車両化しません。</p>
  </aside>

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
const programSequence = ui.querySelector('.program-sequence') as HTMLElement;
const toast = ui.querySelector('.toast') as HTMLElement;
const uiRoot = ui as HTMLElement;
const toolsButtons = uiRoot.querySelectorAll<HTMLButtonElement>('[data-action="tools"]');
let toolsOpen = true;

function setToolsOpen(open: boolean): void {
  toolsOpen = open;
  uiRoot.classList.toggle('tools-collapsed', !open);
  toolsButtons.forEach(button => {
    if (button.classList.contains('tools-open-tab')) button.textContent = 'TOOLS';
    else button.setAttribute('aria-label', open ? 'Hide build tools' : 'Show build tools');
  });
}
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
    `${current.suspensionContactCount}/${current.suspensionWheelCount} CONTACT · ${current.motorCount} MOTOR · ${current.meshedGearPairs} GEAR MESH · ${current.propellerCount} PROP · ${current.programSteps.length ? current.programSteps.length + ' CMD' : current.programMode.toUpperCase()}`;
  driveStats.dataset.suspensionDebug = current.suspensionDebug;

  ui.querySelectorAll<HTMLButtonElement>('[data-program]').forEach(button => {
    button.classList.toggle('active', button.dataset.program === current.programMode && current.programSteps.length === 0);
  });

  const commandLabel: Record<string, string> = {
    motorOn: 'MOTOR+',
    motorOff: 'MOTOR−',
    forward: '↑',
    reverse: '↓',
    left: '↶',
    right: '↷',
    wait: 'WAIT',
    hingeOpen: 'HINGE+',
    hingeClose: 'HINGE−'
  };
  programSequence.innerHTML = current.programSteps.length
    ? current.programSteps.map((command, index) =>
        `<span class="${current.programCursor === index ? 'running' : ''}"><b>${index + 1}</b>${commandLabel[command] ?? command}</span>`
      ).join('')
    : '<em>NO COMMANDS — PRESET MODE ACTIVE</em>';

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
    if (studio.setProgramMode(mode)) {
      studio.clearProgramCommands();
      showToast('PRESET // ' + mode.toUpperCase());
    } else {
      showToast('ADD A PROGRAM BLOCK');
    }
  });
});

ui.querySelectorAll<HTMLButtonElement>('[data-program-command]').forEach(button => {
  button.addEventListener('click', () => {
    const command = button.dataset.programCommand as
      | 'motorOn' | 'motorOff'
      | 'forward' | 'reverse'
      | 'left' | 'right' | 'wait'
      | 'hingeOpen' | 'hingeClose';
    showToast(studio.addProgramCommand(command) ? 'COMMAND ADDED' : 'ADD A PROGRAM BLOCK');
  });
});
ui.querySelector('[data-action="program-back"]')?.addEventListener('click', () => {
  showToast(studio.removeLastProgramCommand() ? 'LAST COMMAND REMOVED' : 'PROGRAM IS EMPTY');
});
ui.querySelector('[data-action="program-clear"]')?.addEventListener('click', () => {
  showToast(studio.clearProgramCommands() ? 'PROGRAM CLEARED' : 'PROGRAM IS EMPTY');
});

toolsButtons.forEach(button => {
  button.addEventListener('click', () => setToolsOpen(!toolsOpen));
});

ui.querySelector('[data-action="drive"]')?.addEventListener('click', () => {
  const started = studio.toggleDrive();
  showToast(
    started
      ? (studio.driveActive ? 'PHYSICS DRIVE STARTED' : 'BUILD POSITION RESTORED')
      : studio.driveBlockedReason
  );
});
ui.querySelector('[data-action="physics"]')?.addEventListener('click', () => {
  studio.toggleCollapse();
  if (studio.physicsActive) {
    showToast(
      studio.collapseBodyCount < studio.pieceCount
        ? `PERFORMANCE COLLAPSE // ${studio.collapseBodyCount}/${studio.pieceCount} ACTIVE`
        : 'COLLAPSE STARTED'
    );
  } else {
    showToast('BUILD RESTORED');
  }
});

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

const samplePanel = ui.querySelector('.sample-panel') as HTMLElement;
const setSamplesOpen = (open: boolean): void => {
  ui.classList.toggle('samples-open', open);
  samplePanel.setAttribute('aria-hidden', open ? 'false' : 'true');
};

ui.querySelector('[data-action="samples"]')?.addEventListener('click', () => setSamplesOpen(true));
ui.querySelector('[data-action="samples-close"]')?.addEventListener('click', () => setSamplesOpen(false));
ui.querySelectorAll<HTMLButtonElement>('[data-sample]').forEach(button => {
  button.addEventListener('click', () => {
    const id = button.dataset.sample as
      | 'house' | 'titan' | 'rescue' | 'fortress' | 'explorer'
      | 'skyport' | 'harbor' | 'alpine' | 'megaforge';
    if (studio.loadSample(id)) {
      setSamplesOpen(false);
      setToolsOpen(false);
      showToast(button.querySelector('b')?.textContent + ' LOADED');
    } else {
      showToast('STOP SIMULATION FIRST');
    }
  });
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
