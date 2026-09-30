import * as THREE from 'three';
import { BODY_H, STUD, cloneSpec, createBrick, footprint, type BrickSpec } from './brickFactory';

export interface BrickRecord extends BrickSpec {
  x: number;
  y: number;
  z: number;
}

type Mode = 'build' | 'remove';

interface PointerInfo {
  x: number;
  y: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
}

const SAVE_KEY = 'brick-lab-build-v1';

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
  private selected: BrickSpec = { w: 2, d: 4, color: 0xe53935, rotation: 0 };
  private mode: Mode = 'build';
  private records: BrickRecord[] = [];
  private undoStack: BrickRecord[][] = [];
  private redoStack: BrickRecord[][] = [];
  private pointers = new Map<number, PointerInfo>();
  private pinchDistance = 0;
  private orbitTarget = new THREE.Vector3(0, 1.2, 0);
  private azimuth = Math.PI * 0.25;
  private polar = 0.92;
  private distance = 13.5;
  private lastTapMoved = false;
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

    this.ghost = createBrick(this.selected, 0.46);
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

  setSpec(next: Partial<BrickSpec>): void {
    this.selected = { ...this.selected, ...next };
    this.rebuildGhost();
    this.onChange?.(this);
  }

  rotateSelection(): void {
    this.selected.rotation = this.selected.rotation ? 0 : 1;
    this.rebuildGhost();
    this.onChange?.(this);
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.ghost.visible = mode === 'build';
    this.onChange?.(this);
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.snapshot());
    this.restore(prev, false);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.restore(next, false);
  }

  save(): void {
    localStorage.setItem(SAVE_KEY, JSON.stringify(this.records));
    this.onChange?.(this);
  }

  load(): boolean {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw) as BrickRecord[];
      if (!Array.isArray(data)) return false;
      this.pushHistory();
      this.restore(data, false);
      return true;
    } catch {
      return false;
    }
  }

  clear(): void {
    if (!this.records.length) return;
    this.pushHistory();
    this.restore([], false);
  }

  resetView(): void {
    this.orbitTarget.set(0, 1.2, 0);
    this.azimuth = Math.PI * 0.25;
    this.polar = 0.92;
    this.distance = 13.5;
    this.updateCamera();
  }

  demoHouse(): void {
    this.pushHistory();
    const red = 0xe53935;
    const blue = 0x1e6bd6;
    const yellow = 0xf5c62b;
    const white = 0xf4f5f7;
    const dark = 0x30343b;
    const list: BrickRecord[] = [];

    const add = (w: number, d: number, x: number, y: number, z: number, color: number, rotation: 0 | 1 = 0) => {
      list.push({ w, d, x, y, z, color, rotation });
    };

    for (let z = -3.2; z <= 3.2; z += 1.6) {
      add(2, 4, -3.6, 0, z, dark, 1);
      add(2, 4, 3.6, 0, z, dark, 1);
    }
    for (let x = -2.4; x <= 2.4; x += 1.6) {
      add(2, 4, x, 0, -3.6, dark, 0);
      add(2, 4, x, 0, 3.6, dark, 0);
    }

    for (let layer = 1; layer <= 4; layer++) {
      const y = layer * BODY_H;
      const c = layer % 2 ? red : white;
      for (let x = -2.4; x <= 2.4; x += 1.6) {
        if (!(layer <= 2 && Math.abs(x) < 0.9)) add(2, 4, x, y, -3.2, c, 0);
        add(2, 4, x, y, 3.2, c, 0);
      }
      for (let z = -1.6; z <= 1.6; z += 1.6) {
        if (!(layer === 2 && z === 0)) add(2, 4, -3.2, y, z, c, 1);
        add(2, 4, 3.2, y, z, c, 1);
      }
    }

    for (let x = -2.4; x <= 2.4; x += 1.6) {
      add(2, 4, x, BODY_H * 5, -2.0, blue, 0);
      add(2, 4, x, BODY_H * 5, 2.0, blue, 0);
      add(2, 4, x, BODY_H * 6, -1.2, yellow, 0);
      add(2, 4, x, BODY_H * 6, 1.2, yellow, 0);
      add(2, 4, x, BODY_H * 7, 0, red, 0);
    }

    this.restore(list, false);
    this.orbitTarget.set(0, 1.4, 0);
    this.distance = 15;
    this.updateCamera();
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

  private buildLighting(): void {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8795aa, 2.4);
    this.scene.add(hemi);

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
    const count = 24 * 24;
    const studs = new THREE.InstancedMesh(studGeo, studMat, count);
    const m = new THREE.Matrix4();
    let i = 0;
    for (let x = 0; x < 24; x++) {
      for (let z = 0; z < 24; z++) {
        m.makeTranslation((x - 11.5) * STUD, 0.027, (z - 11.5) * STUD);
        studs.setMatrixAt(i++, m);
      }
    }
    studs.receiveShadow = true;
    this.scene.add(studs);

    const grid = new THREE.GridHelper(19.2, 24, 0xa6b5c5, 0xbec9d5);
    grid.position.y = 0.061;
    const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
    mats.forEach(mat => { mat.transparent = true; mat.opacity = 0.26; });
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

  private bindPointer(): void {
    this.canvas.style.touchAction = 'none';

    this.canvas.addEventListener('pointerdown', event => {
      this.canvas.setPointerCapture(event.pointerId);
      const info: PointerInfo = {
        x: event.clientX, y: event.clientY,
        startX: event.clientX, startY: event.clientY,
        lastX: event.clientX, lastY: event.clientY
      };
      this.pointers.set(event.pointerId, info);
      this.lastTapMoved = false;

      if (this.pointers.size === 2) {
        const p = [...this.pointers.values()];
        this.pinchDistance = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      }
    });

    this.canvas.addEventListener('pointermove', event => {
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

      if (Math.hypot(event.clientX - info.startX, event.clientY - info.startY) > 7) this.lastTapMoved = true;

      if (this.pointers.size === 1) {
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
      this.pointers.delete(event.pointerId);
      if (this.pointers.size < 2) this.pinchDistance = 0;

      if (wasTap) {
        this.updatePointerNdc(event.clientX, event.clientY);
        if (this.mode === 'remove') this.removeAtPointer();
        else this.placeAtPointer();
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

  private getIntersections(): THREE.Intersection[] {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const targets: THREE.Object3D[] = [this.ground];
    this.brickLayer.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh) targets.push(obj);
    });
    return this.raycaster.intersectObjects(targets, false);
  }

  private brickRootFrom(object: THREE.Object3D): THREE.Group | null {
    const direct = object.userData.brickRoot as THREE.Group | undefined;
    if (direct) return direct;
    let node: THREE.Object3D | null = object;
    while (node) {
      if (node.userData.kind === 'brick') return node as THREE.Group;
      node = node.parent;
    }
    return null;
  }

  private placementFromPointer(): { x: number; y: number; z: number } | null {
    const hit = this.getIntersections()[0];
    if (!hit) return null;

    const root = this.brickRootFrom(hit.object);
    const y = root ? root.position.y + BODY_H : 0;
    const f = footprint(this.selected);
    const x = this.snapCenter(hit.point.x, f.w);
    const z = this.snapCenter(hit.point.z, f.d);

    if (Math.abs(x) > 9 || Math.abs(z) > 9 || y > BODY_H * 20) return null;
    return { x, y, z };
  }

  private snapCenter(value: number, studCount: number): number {
    const offset = ((studCount - 1) * STUD) / 2;
    return Math.round((value - offset) / STUD) * STUD + offset;
  }

  private candidateCollides(pos: { x: number; y: number; z: number }, spec = this.selected): boolean {
    const f = footprint(spec);
    const halfX = f.w * STUD / 2 - 0.035;
    const halfZ = f.d * STUD / 2 - 0.035;

    return this.records.some(record => {
      if (Math.abs(record.y - pos.y) > 0.05) return false;
      const rf = footprint(record);
      const rHalfX = rf.w * STUD / 2 - 0.035;
      const rHalfZ = rf.d * STUD / 2 - 0.035;
      return Math.abs(record.x - pos.x) < halfX + rHalfX &&
             Math.abs(record.z - pos.z) < halfZ + rHalfZ;
    });
  }

  private placeAtPointer(): void {
    const pos = this.placementFromPointer();
    if (!pos || this.candidateCollides(pos)) return;

    this.pushHistory();
    const record: BrickRecord = { ...cloneSpec(this.selected), ...pos };
    this.records.push(record);
    this.addRecordMesh(record);
    this.onChange?.(this);
  }

  private removeAtPointer(): void {
    const hit = this.getIntersections().find(i => this.brickRootFrom(i.object));
    if (!hit) return;
    const root = this.brickRootFrom(hit.object);
    if (!root) return;
    const id = root.userData.recordId as number;
    if (!Number.isInteger(id)) return;

    this.pushHistory();
    this.records.splice(id, 1);
    this.rebuildAll();
    this.onChange?.(this);
  }

  private addRecordMesh(record: BrickRecord): void {
    const group = createBrick(record);
    group.position.set(record.x, record.y, record.z);
    group.userData.recordId = this.brickLayer.children.length;
    group.traverse(obj => {
      obj.userData.brickRoot = group;
    });
    this.brickLayer.add(group);
  }

  private rebuildAll(): void {
    while (this.brickLayer.children.length) this.brickLayer.remove(this.brickLayer.children[0]);
    this.records.forEach(record => this.addRecordMesh(record));
  }

  private snapshot(): BrickRecord[] {
    return this.records.map(r => ({ ...r }));
  }

  private pushHistory(): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  private restore(records: BrickRecord[], notify = true): void {
    this.records = records.map(r => ({
      w: Number(r.w), d: Number(r.d), color: Number(r.color),
      rotation: r.rotation ? 1 : 0,
      x: Number(r.x), y: Number(r.y), z: Number(r.z)
    }));
    this.rebuildAll();
    if (notify) this.onChange?.(this);
    else this.onChange?.(this);
  }

  private rebuildGhost(): void {
    this.scene.remove(this.ghost);
    this.ghost = createBrick(this.selected, 0.46);
    this.scene.add(this.ghost);
    this.updateGhost();
  }

  private setGhostMaterial(invalid: boolean): void {
    this.ghost.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.setHex(invalid ? 0xff3158 : this.selected.color);
      mat.opacity = invalid ? 0.32 : 0.46;
      mat.depthWrite = false;
    });
  }

  private updateGhost(): void {
    if (this.mode !== 'build') {
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
    if (this.pointers.size === 0) this.updateGhost();
    this.renderer.render(this.scene, this.camera);
  };
}
