import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  BODY_H, STUD, cloneSpec, createPart, footprint, partHeight,
  type BrickSpec, type PartKind
} from './brickFactory';

export interface BrickRecord extends BrickSpec {
  x: number;
  y: number;
  z: number;
}

export type Mode = 'build' | 'remove' | 'select' | 'move' | 'instruction';

interface PointerInfo {
  x: number;
  y: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
}

interface DragSelection {
  indices: number[];
  startWorld: THREE.Vector3;
  before: BrickRecord[];
  origins: Map<number, { x: number; z: number }>;
  moved: boolean;
}

interface InstructionStep {
  label: string;
  record: BrickRecord;
}

interface PhysicsEntry {
  body: CANNON.Body;
  mesh: THREE.Group;
  height: number;
}

const slotKey = (slot: number): string => `brick-lab-slot-${slot}-v2`;

export class BrickStudio {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 180);
  readonly canvas: HTMLCanvasElement;

  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
  );
  private brickLayer = new THREE.Group();
  private ghost: THREE.Group;
  private ghostValid = true;
  private selected: BrickSpec = { kind: 'brick', w: 2, d: 4, color: 0xe53935, rotation: 0 };
  private mode: Mode = 'build';
  private records: BrickRecord[] = [];
  private undoStack: BrickRecord[][] = [];
  private redoStack: BrickRecord[][] = [];
  private selectedIds = new Set<number>();
  private selectionHelpers: THREE.Box3Helper[] = [];

  private pointers = new Map<number, PointerInfo>();
  private pinchDistance = 0;
  private orbitTarget = new THREE.Vector3(0, 1.2, 0);
  private azimuth = Math.PI * 0.25;
  private polar = 0.92;
  private distance = 13.5;
  private lastTapMoved = false;
  private dragSelection: DragSelection | null = null;

  private instructionSteps: InstructionStep[] = [];
  private instructionStep = 0;
  private instructionGhost?: THREE.Group;
  private instructionBackup?: BrickRecord[];

  private physicsWorld?: CANNON.World;
  private physicsEntries: PhysicsEntry[] = [];
  private physicsSnapshot?: BrickRecord[];
  private lastFrame = performance.now();

  private onChange?: (studio: BrickStudio) => void;

  constructor(container: HTMLElement, onChange?: (studio: BrickStudio) => void) {
    this.onChange = onChange;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0xe8edf5, 1);
    this.canvas = this.renderer.domElement;
    container.appendChild(this.canvas);

    this.scene.fog = new THREE.Fog(0xe8edf5, 23, 54);
    this.scene.add(this.brickLayer);

    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.002;
    this.ground.userData.kind = 'ground';
    this.scene.add(this.ground);

    this.buildLighting();
    this.buildBaseplate();
    this.buildBackdrop();
    this.buildInstructionSteps();

    this.ghost = createPart(this.selected, 0.46);
    this.setGhostMaterial(false);
    this.scene.add(this.ghost);

    this.updateCamera();
    this.bindPointer();
    this.resize();
    this.animate();
  }

  get pieceCount(): number { return this.records.length; }
  get currentMode(): Mode { return this.mode; }
  get currentSpec(): BrickSpec { return cloneSpec(this.selected); }
  get selectionCount(): number { return this.selectedIds.size; }
  get physicsActive(): boolean { return Boolean(this.physicsWorld); }
  get instructionStatus(): { active: boolean; step: number; total: number; label: string } {
    const step = this.instructionSteps[this.instructionStep];
    return {
      active: this.mode === 'instruction',
      step: Math.min(this.instructionStep + 1, this.instructionSteps.length),
      total: this.instructionSteps.length,
      label: step?.label ?? 'COMPLETE'
    };
  }

  setSpec(next: Partial<BrickSpec>): void {
    if (this.physicsActive) return;
    this.selected = { ...this.selected, ...next };
    this.mode = 'build';
    this.selectedIds.clear();
    this.refreshSelectionVisual();
    this.rebuildGhost();
    this.notify();
  }

  setPartKind(kind: PartKind): void {
    const defaults: Record<PartKind, { w: number; d: number }> = {
      brick: { w: 2, d: 4 },
      slope: { w: 2, d: 2 },
      hinge: { w: 2, d: 2 },
      wheel: { w: 2, d: 2 },
      window: { w: 2, d: 1 },
      roof: { w: 2, d: 4 }
    };
    this.setSpec({ kind, ...defaults[kind] });
  }

  rotateSelection(): void {
    if (this.physicsActive) return;
    if (this.selectedIds.size && (this.mode === 'select' || this.mode === 'move')) {
      this.pushHistory();
      for (const id of this.selectedIds) {
        const record = this.records[id];
        if (record) record.rotation = record.rotation ? 0 : 1;
      }
      this.rebuildAll();
      this.notify();
      return;
    }

    this.selected.rotation = this.selected.rotation ? 0 : 1;
    this.rebuildGhost();
    this.notify();
  }

  setMode(mode: Mode): void {
    if (this.physicsActive) return;
    if (this.mode === 'instruction' && mode !== 'instruction') this.stopInstructions(true);
    this.mode = mode;
    if (mode !== 'select' && mode !== 'move') {
      this.selectedIds.clear();
      this.refreshSelectionVisual();
    }
    this.ghost.visible = mode === 'build';
    this.notify();
  }

  undo(): void {
    if (this.physicsActive || this.mode === 'instruction') return;
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.snapshot());
    this.restore(prev);
  }

  redo(): void {
    if (this.physicsActive || this.mode === 'instruction') return;
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.restore(next);
  }

  saveSlot(slot: number): boolean {
    if (this.physicsActive) return false;
    try {
      localStorage.setItem(slotKey(slot), JSON.stringify({
        version: 2,
        savedAt: new Date().toISOString(),
        records: this.records
      }));
      this.notify();
      return true;
    } catch {
      return false;
    }
  }

  loadSlot(slot: number): boolean {
    if (this.physicsActive) return false;
    try {
      const raw = localStorage.getItem(slotKey(slot));
      if (!raw) return false;
      const payload = JSON.parse(raw) as { records?: BrickRecord[] };
      if (!Array.isArray(payload.records)) return false;
      this.pushHistory();
      this.restore(payload.records);
      return true;
    } catch {
      return false;
    }
  }

  slotInfo(slot: number): string {
    try {
      const raw = localStorage.getItem(slotKey(slot));
      if (!raw) return 'EMPTY';
      const payload = JSON.parse(raw) as { records?: BrickRecord[]; savedAt?: string };
      const count = Array.isArray(payload.records) ? payload.records.length : 0;
      return `${count} PCS`;
    } catch {
      return 'ERROR';
    }
  }

  clear(): void {
    if (this.physicsActive || !this.records.length) return;
    this.pushHistory();
    this.restore([]);
  }

  resetView(): void {
    this.orbitTarget.set(0, 1.2, 0);
    this.azimuth = Math.PI * 0.25;
    this.polar = 0.92;
    this.distance = 13.5;
    this.updateCamera();
  }

  selectAll(): void {
    if (this.physicsActive) return;
    this.mode = 'select';
    this.selectedIds = new Set(this.records.map((_, i) => i));
    this.refreshSelectionVisual();
    this.notify();
  }

  clearSelection(): void {
    this.selectedIds.clear();
    this.refreshSelectionVisual();
    this.notify();
  }

  copySelection(): boolean {
    if (this.physicsActive || !this.selectedIds.size) return false;
    const source = [...this.selectedIds].map(id => this.records[id]).filter(Boolean);
    if (!source.length) return false;

    for (let attempt = 1; attempt <= 8; attempt++) {
      const dx = STUD * attempt;
      const dz = STUD * attempt;
      const copies = source.map(record => ({ ...record, x: record.x + dx, z: record.z + dz }));
      if (copies.some(record => Math.abs(record.x) > 9 || Math.abs(record.z) > 9)) continue;
      if (!this.recordsCanCoexist(copies, this.records)) continue;

      this.pushHistory();
      const start = this.records.length;
      this.records.push(...copies);
      this.selectedIds = new Set(copies.map((_, index) => start + index));
      this.rebuildAll();
      this.mode = 'move';
      this.notify();
      return true;
    }
    return false;
  }

  liftSelection(layers: number): boolean {
    if (this.physicsActive || !this.selectedIds.size) return false;
    const dy = BODY_H * layers;
    const copies = this.records.map(r => ({ ...r }));
    for (const id of this.selectedIds) {
      if (copies[id]) copies[id].y = Math.max(0, copies[id].y + dy);
    }
    const moving = [...this.selectedIds].map(id => copies[id]).filter(Boolean);
    const fixed = copies.filter((_, index) => !this.selectedIds.has(index));
    if (!this.recordsCanCoexist(moving, fixed)) return false;

    this.pushHistory();
    this.records = copies;
    this.rebuildAll();
    this.notify();
    return true;
  }

  demoHouse(): void {
    if (this.physicsActive) return;
    this.pushHistory();
    const red = 0xe53935;
    const blue = 0x1e6bd6;
    const white = 0xf4f5f7;
    const dark = 0x30343b;
    const list: BrickRecord[] = [];

    const add = (
      kind: PartKind, w: number, d: number, x: number, y: number, z: number,
      color: number, rotation: 0 | 1 = 0
    ) => list.push({ kind, w, d, x, y, z, color, rotation });

    for (let x = -2.4; x <= 2.4; x += 1.6) {
      add('brick', 2, 4, x, 0, -2.4, dark);
      add('brick', 2, 4, x, 0, 2.4, dark);
      add('brick', 2, 4, x, BODY_H, -2.4, red);
      add('brick', 2, 4, x, BODY_H, 2.4, red);
    }
    for (const x of [-2.4, 2.4]) {
      for (const z of [-.8, .8]) {
        add('brick', 2, 4, x, BODY_H, z, red, 1);
      }
    }
    add('window', 2, 1, -2.4, BODY_H * 2, 0, white, 1);
    add('window', 2, 1, 2.4, BODY_H * 2, 0, white, 1);
    add('hinge', 2, 2, 0, BODY_H * 2, 2.4, blue);
    add('slope', 2, 2, -1.2, BODY_H * 2, -2.4, blue);
    add('slope', 2, 2, 1.2, BODY_H * 2, -2.4, blue, 1);
    add('roof', 2, 4, -1.6, BODY_H * 3.4, 0, blue);
    add('roof', 2, 4, 1.6, BODY_H * 3.4, 0, blue);

    this.restore(list);
    this.orbitTarget.set(0, 1.4, 0);
    this.distance = 15;
    this.updateCamera();
  }

  startInstructions(): void {
    if (this.physicsActive) return;
    if (this.mode !== 'instruction') this.instructionBackup = this.snapshot();
    this.records = [];
    this.selectedIds.clear();
    this.rebuildAll();
    this.mode = 'instruction';
    this.instructionStep = 0;
    this.updateInstructionGhost();
    this.notify();
  }

  instructionNext(): boolean {
    if (this.mode !== 'instruction') return false;
    const step = this.instructionSteps[this.instructionStep];
    if (!step) return false;
    this.records.push({ ...step.record });
    this.rebuildAll();
    this.instructionStep++;
    this.updateInstructionGhost();
    this.notify();
    return true;
  }

  instructionPrev(): boolean {
    if (this.mode !== 'instruction' || this.instructionStep <= 0) return false;
    this.instructionStep--;
    this.records.pop();
    this.rebuildAll();
    this.updateInstructionGhost();
    this.notify();
    return true;
  }

  keepInstructionModel(): void {
    if (this.mode !== 'instruction') return;
    this.removeInstructionGhost();
    this.instructionBackup = undefined;
    this.mode = 'select';
    this.selectedIds.clear();
    this.pushHistorySnapshot([]);
    this.notify();
  }

  stopInstructions(restoreOriginal = true): void {
    if (this.mode !== 'instruction') return;
    this.removeInstructionGhost();
    if (restoreOriginal && this.instructionBackup) {
      this.records = this.instructionBackup.map(r => ({ ...r }));
      this.rebuildAll();
    }
    this.instructionBackup = undefined;
    this.instructionStep = 0;
    this.mode = 'build';
    this.rebuildGhost();
    this.notify();
  }

  toggleCollapse(): void {
    if (this.physicsActive) this.restoreCollapse();
    else this.startCollapse();
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(rect.width, rect.height, false);
  }

  private notify(): void {
    this.onChange?.(this);
  }

  private buildLighting(): void {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8795aa, 2.4));

    const sun = new THREE.DirectionalLight(0xffffff, 3.2);
    sun.position.set(8, 14, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0x8eb7ff, 1.1);
    fill.position.set(-8, 5, -5);
    this.scene.add(fill);
  }

  private buildBaseplate(): void {
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(19.2, 0.18, 19.2),
      new THREE.MeshStandardMaterial({ color: 0xcfd8e3, roughness: 0.62 })
    );
    plate.position.y = -0.1;
    plate.receiveShadow = true;
    this.scene.add(plate);

    const studGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.055, 16);
    const studMat = new THREE.MeshStandardMaterial({ color: 0xd9e1ea, roughness: 0.58 });
    const studs = new THREE.InstancedMesh(studGeo, studMat, 24 * 24);
    const matrix = new THREE.Matrix4();
    let index = 0;
    for (let x = 0; x < 24; x++) {
      for (let z = 0; z < 24; z++) {
        matrix.makeTranslation((x - 11.5) * STUD, 0.027, (z - 11.5) * STUD);
        studs.setMatrixAt(index++, matrix);
      }
    }
    studs.receiveShadow = true;
    this.scene.add(studs);

    const grid = new THREE.GridHelper(19.2, 24, 0xa6b5c5, 0xbec9d5);
    grid.position.y = 0.061;
    const materials = Array.isArray(grid.material) ? grid.material : [grid.material];
    materials.forEach(mat => { mat.transparent = true; mat.opacity = 0.26; });
    this.scene.add(grid);
  }

  private buildBackdrop(): void {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(38, 64),
      new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.9 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.205;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(16, 0.025, 8, 128),
      new THREE.MeshBasicMaterial({ color: 0x9fb2c9, transparent: true, opacity: 0.4 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    this.scene.add(ring);
  }

  private buildInstructionSteps(): void {
    const black = 0x30343b;
    const blue = 0x1e6bd6;
    const yellow = 0xf5c62b;
    const white = 0xf4f5f7;
    const orange = 0xf57c21;
    const red = 0xe53935;

    const make = (
      label: string, kind: PartKind, w: number, d: number,
      x: number, y: number, z: number, color: number, rotation: 0 | 1 = 0
    ): InstructionStep => ({ label, record: { kind, w, d, x, y, z, color, rotation } });

    this.instructionSteps = [
      make('Rear wheel module', 'wheel', 2, 2, 0, 0, 1.2, black),
      make('Front wheel module', 'wheel', 2, 2, 0, 0, -1.2, black),
      make('Main chassis', 'brick', 2, 4, 0, BODY_H * .65, 0, blue),
      make('Front slope', 'slope', 2, 2, 0, BODY_H * 1.65, -1.0, yellow),
      make('Cabin window', 'window', 2, 1, 0, BODY_H * 1.65, .65, white),
      make('Opening rear hinge', 'hinge', 2, 2, 0, BODY_H * 1.65, 1.55, orange),
      make('Cabin roof', 'roof', 2, 2, 0, BODY_H * 4.15, .65, red)
    ];
  }

  private bindPointer(): void {
    this.canvas.style.touchAction = 'none';

    this.canvas.addEventListener('pointerdown', event => {
      if (this.physicsActive || this.mode === 'instruction') return;
      this.canvas.setPointerCapture(event.pointerId);
      this.updatePointerNdc(event.clientX, event.clientY);

      const info: PointerInfo = {
        x: event.clientX, y: event.clientY,
        startX: event.clientX, startY: event.clientY,
        lastX: event.clientX, lastY: event.clientY
      };
      this.pointers.set(event.pointerId, info);
      this.lastTapMoved = false;

      if (this.mode === 'move' && this.pointers.size === 1) {
        const id = this.partIdAtPointer();
        if (id !== null) {
          if (!this.selectedIds.has(id)) {
            this.selectedIds = new Set([id]);
            this.refreshSelectionVisual();
            this.notify();
          }
          const startWorld = this.pointerOnPlane(0);
          if (startWorld) {
            const origins = new Map<number, { x: number; z: number }>();
            for (const selectedId of this.selectedIds) {
              const record = this.records[selectedId];
              if (record) origins.set(selectedId, { x: record.x, z: record.z });
            }
            this.dragSelection = {
              indices: [...this.selectedIds],
              startWorld,
              before: this.snapshot(),
              origins,
              moved: false
            };
          }
        }
      }

      if (this.pointers.size === 2) {
        this.dragSelection = null;
        const p = [...this.pointers.values()];
        this.pinchDistance = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      }
    });

    this.canvas.addEventListener('pointermove', event => {
      if (this.physicsActive || this.mode === 'instruction') return;
      const info = this.pointers.get(event.pointerId);
      if (!info) {
        this.updatePointerNdc(event.clientX, event.clientY);
        this.updateGhost();
        return;
      }

      const dx = event.clientX - info.lastX;
      const dy = event.clientY - info.lastY;
      info.x = event.clientX;
      info.y = event.clientY;
      info.lastX = event.clientX;
      info.lastY = event.clientY;

      const travel = Math.hypot(event.clientX - info.startX, event.clientY - info.startY);
      if (travel > 7) this.lastTapMoved = true;

      if (this.pointers.size === 1 && this.dragSelection) {
        this.updatePointerNdc(event.clientX, event.clientY);
        const point = this.pointerOnPlane(0);
        if (point) this.moveDraggedSelection(point);
      } else if (this.pointers.size === 1) {
        this.azimuth -= dx * 0.007;
        this.polar = THREE.MathUtils.clamp(this.polar + dy * 0.006, 0.32, 1.42);
        this.updateCamera();
      } else if (this.pointers.size === 2) {
        const p = [...this.pointers.values()];
        const dist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        if (this.pinchDistance > 1) {
          this.distance = THREE.MathUtils.clamp(this.distance * (this.pinchDistance / Math.max(1, dist)), 5.8, 31);
          this.updateCamera();
        }
        this.pinchDistance = dist;
      }
    });

    const release = (event: PointerEvent) => {
      const info = this.pointers.get(event.pointerId);
      if (!info) return;
      const wasTap = !this.lastTapMoved && Math.hypot(event.clientX - info.startX, event.clientY - info.startY) < 8;

      if (this.dragSelection) {
        if (this.dragSelection.moved) {
          this.pushHistorySnapshot(this.dragSelection.before);
          this.notify();
        }
        this.dragSelection = null;
      }

      this.pointers.delete(event.pointerId);
      if (this.pointers.size < 2) this.pinchDistance = 0;

      if (wasTap && !this.physicsActive) {
        this.updatePointerNdc(event.clientX, event.clientY);
        if (this.mode === 'remove') this.removeAtPointer();
        else if (this.mode === 'select') this.toggleSelectionAtPointer();
        else if (this.mode === 'build') this.placeAtPointer();
      }
    };

    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', release);

    this.canvas.addEventListener('wheel', event => {
      event.preventDefault();
      this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(event.deltaY * 0.001), 5.8, 31);
      this.updateCamera();
    }, { passive: false });
  }

  private updatePointerNdc(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  private pointerOnPlane(y: number): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    return this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  }

  private getIntersections(): THREE.Intersection[] {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const targets: THREE.Object3D[] = [this.ground];
    this.brickLayer.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh) targets.push(obj);
    });
    return this.raycaster.intersectObjects(targets, false);
  }

  private partRootFrom(object: THREE.Object3D): THREE.Group | null {
    const direct = object.userData.brickRoot as THREE.Group | undefined;
    if (direct) return direct;
    let node: THREE.Object3D | null = object;
    while (node) {
      if (node.userData.kind === 'part') return node as THREE.Group;
      node = node.parent;
    }
    return null;
  }

  private partIdAtPointer(): number | null {
    const hit = this.getIntersections().find(i => this.partRootFrom(i.object));
    if (!hit) return null;
    const root = this.partRootFrom(hit.object);
    if (!root) return null;
    const id = Number(root.userData.recordId);
    return Number.isInteger(id) ? id : null;
  }

  private placementFromPointer(): { x: number; y: number; z: number } | null {
    const hit = this.getIntersections()[0];
    if (!hit) return null;

    const root = this.partRootFrom(hit.object);
    const rootSpec = root?.userData.spec as BrickSpec | undefined;
    const y = root && rootSpec ? root.position.y + partHeight(rootSpec) : 0;
    const f = footprint(this.selected);
    const x = this.snapCenter(hit.point.x, f.w);
    const z = this.snapCenter(hit.point.z, f.d);

    if (Math.abs(x) > 9 || Math.abs(z) > 9 || y > BODY_H * 22) return null;
    return { x, y, z };
  }

  private snapCenter(value: number, studCount: number): number {
    const offset = ((studCount - 1) * STUD) / 2;
    return Math.round((value - offset) / STUD) * STUD + offset;
  }

  private recordCollides(a: BrickRecord, b: BrickRecord): boolean {
    const af = footprint(a);
    const bf = footprint(b);
    const aHalfX = af.w * STUD / 2 - .035;
    const aHalfZ = af.d * STUD / 2 - .035;
    const bHalfX = bf.w * STUD / 2 - .035;
    const bHalfZ = bf.d * STUD / 2 - .035;
    const horizontal = Math.abs(a.x - b.x) < aHalfX + bHalfX &&
      Math.abs(a.z - b.z) < aHalfZ + bHalfZ;
    if (!horizontal) return false;
    const aTop = a.y + partHeight(a);
    const bTop = b.y + partHeight(b);
    return a.y < bTop - .04 && aTop > b.y + .04;
  }

  private recordsCanCoexist(moving: BrickRecord[], fixed: BrickRecord[]): boolean {
    for (let i = 0; i < moving.length; i++) {
      const record = moving[i];
      if (Math.abs(record.x) > 9 || Math.abs(record.z) > 9 || record.y < 0) return false;
      if (fixed.some(other => this.recordCollides(record, other))) return false;
      for (let j = 0; j < i; j++) {
        if (this.recordCollides(record, moving[j])) return false;
      }
    }
    return true;
  }

  private candidateCollides(pos: { x: number; y: number; z: number }, spec = this.selected): boolean {
    const candidate: BrickRecord = { ...cloneSpec(spec), ...pos };
    return this.records.some(record => this.recordCollides(candidate, record));
  }

  private placeAtPointer(): void {
    const pos = this.placementFromPointer();
    if (!pos || this.candidateCollides(pos)) return;

    this.pushHistory();
    const record: BrickRecord = { ...cloneSpec(this.selected), ...pos };
    this.records.push(record);
    this.addRecordMesh(record, this.records.length - 1);
    this.notify();
  }

  private removeAtPointer(): void {
    const id = this.partIdAtPointer();
    if (id === null) return;
    this.pushHistory();
    this.records.splice(id, 1);
    this.selectedIds.clear();
    this.rebuildAll();
    this.notify();
  }

  private toggleSelectionAtPointer(): void {
    const id = this.partIdAtPointer();
    if (id === null) return;
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
    this.refreshSelectionVisual();
    this.notify();
  }

  private moveDraggedSelection(point: THREE.Vector3): void {
    const drag = this.dragSelection;
    if (!drag) return;
    const dx = Math.round((point.x - drag.startWorld.x) / STUD) * STUD;
    const dz = Math.round((point.z - drag.startWorld.z) / STUD) * STUD;
    if (Math.abs(dx) < .001 && Math.abs(dz) < .001) return;

    const candidateRecords = drag.indices.map(id => {
      const record = this.records[id];
      const origin = drag.origins.get(id);
      return record && origin ? { ...record, x: origin.x + dx, z: origin.z + dz } : null;
    }).filter((record): record is BrickRecord => Boolean(record));
    const fixed = this.records.filter((_, index) => !drag.indices.includes(index));
    if (!this.recordsCanCoexist(candidateRecords, fixed)) return;

    for (let i = 0; i < drag.indices.length; i++) {
      const id = drag.indices[i];
      const next = candidateRecords[i];
      if (!next || !this.records[id]) continue;
      this.records[id].x = next.x;
      this.records[id].z = next.z;
      const group = this.brickLayer.children[id] as THREE.Group | undefined;
      if (group) group.position.set(next.x, next.y, next.z);
    }
    drag.moved = true;
    this.refreshSelectionVisual();
  }

  private addRecordMesh(record: BrickRecord, index: number): void {
    const group = createPart(record);
    group.position.set(record.x, record.y, record.z);
    group.userData.recordId = index;
    group.userData.spec = cloneSpec(record);
    group.traverse(obj => { obj.userData.brickRoot = group; });
    this.brickLayer.add(group);
  }

  private rebuildAll(): void {
    while (this.brickLayer.children.length) this.brickLayer.remove(this.brickLayer.children[0]);
    this.records.forEach((record, index) => this.addRecordMesh(record, index));
    this.selectedIds = new Set([...this.selectedIds].filter(id => id < this.records.length));
    this.refreshSelectionVisual();
  }

  private snapshot(): BrickRecord[] {
    return this.records.map(r => ({ ...r }));
  }

  private pushHistory(): void {
    this.pushHistorySnapshot(this.snapshot());
  }

  private pushHistorySnapshot(snapshot: BrickRecord[]): void {
    this.undoStack.push(snapshot.map(r => ({ ...r })));
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  private restore(records: BrickRecord[]): void {
    this.records = records.map(r => ({
      kind: (r.kind || 'brick') as PartKind,
      w: Number(r.w), d: Number(r.d), color: Number(r.color),
      rotation: r.rotation ? 1 : 0,
      x: Number(r.x), y: Number(r.y), z: Number(r.z)
    }));
    this.selectedIds.clear();
    this.rebuildAll();
    this.notify();
  }

  private rebuildGhost(): void {
    this.scene.remove(this.ghost);
    this.ghost = createPart(this.selected, 0.46);
    this.scene.add(this.ghost);
    this.updateGhost();
  }

  private setGhostMaterial(invalid: boolean): void {
    this.ghost.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const raw of materials) {
        const mat = raw as THREE.MeshStandardMaterial;
        if ('color' in mat) mat.color.setHex(invalid ? 0xff3158 : this.selected.color);
        if ('opacity' in mat) mat.opacity = invalid ? .28 : .46;
        if ('depthWrite' in mat) mat.depthWrite = false;
      }
    });
  }

  private updateGhost(): void {
    if (this.mode !== 'build' || this.physicsActive) {
      this.ghost.visible = false;
      return;
    }
    const pos = this.placementFromPointer();
    if (!pos) {
      this.ghost.visible = false;
      return;
    }

    this.ghost.visible = true;
    this.ghost.position.set(pos.x, pos.y, pos.z);
    const invalid = this.candidateCollides(pos);
    if (invalid !== !this.ghostValid) {
      this.ghostValid = !invalid;
      this.setGhostMaterial(invalid);
    }
  }

  private refreshSelectionVisual(): void {
    for (const helper of this.selectionHelpers) this.scene.remove(helper);
    this.selectionHelpers = [];
    if (this.physicsActive) return;

    for (const id of this.selectedIds) {
      const group = this.brickLayer.children[id];
      if (!group) continue;
      const helper = new THREE.Box3Helper(new THREE.Box3().setFromObject(group), 0x1967d2);
      helper.renderOrder = 20;
      this.scene.add(helper);
      this.selectionHelpers.push(helper);
    }
  }

  private updateInstructionGhost(): void {
    this.removeInstructionGhost();
    const step = this.instructionSteps[this.instructionStep];
    if (!step || this.mode !== 'instruction') return;
    this.instructionGhost = createPart(step.record, .32);
    this.instructionGhost.position.set(step.record.x, step.record.y, step.record.z);
    this.instructionGhost.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if ('emissive' in material) {
          const standard = material as THREE.MeshStandardMaterial;
          standard.emissive.setHex(0x45b7ff);
          standard.emissiveIntensity = .5;
        }
      }
    });
    this.scene.add(this.instructionGhost);
  }

  private removeInstructionGhost(): void {
    if (!this.instructionGhost) return;
    this.scene.remove(this.instructionGhost);
    this.instructionGhost = undefined;
  }

  private startCollapse(): void {
    if (!this.records.length || this.mode === 'instruction') return;
    this.physicsSnapshot = this.snapshot();
    this.selectedIds.clear();
    this.refreshSelectionVisual();
    this.ghost.visible = false;

    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    world.allowSleep = true;
    world.defaultContactMaterial.friction = .42;
    world.defaultContactMaterial.restitution = .08;

    const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    groundBody.position.y = -.02;
    world.addBody(groundBody);

    this.physicsEntries = [];
    this.records.forEach((record, index) => {
      const f = footprint(record);
      const h = partHeight(record);
      const body = new CANNON.Body({
        mass: Math.max(.22, f.w * f.d * .13),
        shape: new CANNON.Box(new CANNON.Vec3(
          f.w * STUD / 2 - .035,
          Math.max(.12, h / 2),
          f.d * STUD / 2 - .035
        )),
        position: new CANNON.Vec3(record.x, record.y + h / 2, record.z),
        linearDamping: .08,
        angularDamping: .08,
        allowSleep: true
      });
      const outward = Math.hypot(record.x, record.z) || 1;
      body.velocity.set(record.x / outward * .22 + (Math.random() - .5) * .28, .15, record.z / outward * .22 + (Math.random() - .5) * .28);
      body.angularVelocity.set((Math.random() - .5) * .5, (Math.random() - .5) * .3, (Math.random() - .5) * .5);
      world.addBody(body);

      const mesh = this.brickLayer.children[index] as THREE.Group;
      this.physicsEntries.push({ body, mesh, height: h });
    });

    this.physicsWorld = world;
    this.notify();
  }

  private restoreCollapse(): void {
    this.physicsWorld = undefined;
    this.physicsEntries = [];
    if (this.physicsSnapshot) {
      this.records = this.physicsSnapshot.map(r => ({ ...r }));
      this.rebuildAll();
    }
    this.physicsSnapshot = undefined;
    this.ghost.visible = this.mode === 'build';
    this.notify();
  }

  private updatePhysics(delta: number): void {
    const world = this.physicsWorld;
    if (!world) return;
    world.step(1 / 60, Math.min(delta, .05), 3);
    for (const entry of this.physicsEntries) {
      entry.mesh.position.set(
        entry.body.position.x,
        entry.body.position.y - entry.height / 2,
        entry.body.position.z
      );
      entry.mesh.quaternion.set(
        entry.body.quaternion.x,
        entry.body.quaternion.y,
        entry.body.quaternion.z,
        entry.body.quaternion.w
      );
    }
  }

  private updateCamera(): void {
    const sin = Math.sin(this.polar);
    this.camera.position.set(
      this.orbitTarget.x + Math.cos(this.azimuth) * sin * this.distance,
      this.orbitTarget.y + Math.cos(this.polar) * this.distance,
      this.orbitTarget.z + Math.sin(this.azimuth) * sin * this.distance
    );
    this.camera.lookAt(this.orbitTarget);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const now = performance.now();
    const delta = (now - this.lastFrame) / 1000;
    this.lastFrame = now;

    this.updatePhysics(delta);
    if (this.pointers.size === 0 && !this.physicsActive) this.updateGhost();
    this.renderer.render(this.scene, this.camera);
  };
}
