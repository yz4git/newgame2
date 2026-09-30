import './style.css';
import { BrickStudio } from './BrickStudio';
import { installFreshPagePolicy } from './pwa/FreshPage';

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
    <div class="brand"><strong>BRICK<span>//</span>LAB</strong><small>3D BLOCK BUILDER</small></div>
    <div class="top-actions">
      <button data-action="undo" title="Undo">↶</button>
      <button data-action="redo" title="Redo">↷</button>
      <button data-action="view" title="Reset view">◎</button>
      <button data-action="save">SAVE</button>
      <button data-action="load">LOAD</button>
    </div>
  </header>

  <aside class="toolbox">
    <section>
      <label>BRICK</label>
      <div class="size-grid"></div>
    </section>
    <section>
      <label>COLOR</label>
      <div class="color-grid"></div>
    </section>
    <div class="tool-row">
      <button data-action="rotate" class="wide">ROTATE 90°</button>
      <button data-mode="remove" class="danger">REMOVE</button>
    </div>
  </aside>

  <footer class="bottombar">
    <div class="status">
      <b class="mode-label">BUILD MODE</b>
      <span class="piece-count">0 PIECES</span>
    </div>
    <div class="footer-actions">
      <button data-action="demo">SAMPLE HOUSE</button>
      <button data-action="clear" class="danger-text">CLEAR</button>
    </div>
  </footer>

  <div class="hint">TAP: place/remove · DRAG: orbit · PINCH: zoom</div>
  <div class="toast" aria-live="polite"></div>
`;

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
const toast = ui.querySelector('.toast') as HTMLElement;
let toastTimer = 0;

function showToast(text: string): void {
  toast.textContent = text;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 1300);
}

const studio = new BrickStudio(viewport, current => {
  pieceCount.textContent = current.pieceCount + (current.pieceCount === 1 ? ' PIECE' : ' PIECES');
  modeLabel.textContent = current.currentMode === 'build' ? 'BUILD MODE' : 'REMOVE MODE';
  ui.classList.toggle('remove-mode', current.currentMode === 'remove');

  const spec = current.currentSpec;
  ui.querySelectorAll<HTMLButtonElement>('.brick-choice').forEach(button => {
    button.classList.toggle('active', Number(button.dataset.w) === spec.w && Number(button.dataset.d) === spec.d);
  });
  ui.querySelectorAll<HTMLButtonElement>('.color-choice').forEach(button => {
    button.classList.toggle('active', Number(button.dataset.color) === spec.color);
  });
});

ui.querySelectorAll<HTMLButtonElement>('.brick-choice').forEach(button => {
  button.addEventListener('click', () => {
    studio.setMode('build');
    studio.setSpec({ w: Number(button.dataset.w), d: Number(button.dataset.d) });
  });
});

ui.querySelectorAll<HTMLButtonElement>('.color-choice').forEach(button => {
  button.addEventListener('click', () => {
    studio.setMode('build');
    studio.setSpec({ color: Number(button.dataset.color) });
  });
});

ui.querySelector('[data-mode="remove"]')?.addEventListener('click', () => {
  studio.setMode(studio.currentMode === 'remove' ? 'build' : 'remove');
});

ui.querySelector('[data-action="rotate"]')?.addEventListener('click', () => studio.rotateSelection());
ui.querySelector('[data-action="undo"]')?.addEventListener('click', () => studio.undo());
ui.querySelector('[data-action="redo"]')?.addEventListener('click', () => studio.redo());
ui.querySelector('[data-action="view"]')?.addEventListener('click', () => studio.resetView());
ui.querySelector('[data-action="save"]')?.addEventListener('click', () => {
  studio.save();
  showToast('BUILD SAVED');
});
ui.querySelector('[data-action="load"]')?.addEventListener('click', () => {
  showToast(studio.load() ? 'BUILD LOADED' : 'NO SAVE DATA');
});
ui.querySelector('[data-action="demo"]')?.addEventListener('click', () => {
  studio.demoHouse();
  showToast('SAMPLE HOUSE BUILT');
});
ui.querySelector('[data-action="clear"]')?.addEventListener('click', () => {
  if (studio.pieceCount === 0) return;
  if (window.confirm('すべてのブロックを消しますか？')) {
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

studio.setSpec({ w: 2, d: 4, color: COLORS[0].value });
void installFreshPagePolicy();
