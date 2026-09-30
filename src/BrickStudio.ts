import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  BODY_H, STUD, cloneSpec, createPart, footprint, partHeight,
  type BrickSpec, type PartKind, type ProgramMode, type ProgramCommand
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

interface InstructionModel {
  id: string;
  label: string;
  steps: InstructionStep[];
}

interface PhysicsEntry {
  recordIndex: number;
  body: CANNON.Body;
  mesh: THREE.Group;
  height: number;
}

interface PhysicsGrab {
  pointerId: number;
  entry: PhysicsEntry;
  distance: number;
  lastPoint: THREE.Vector3;
  lastAt: number;
  throwVelocity: THREE.Vector3;
}

interface DriveWheelVisual {
  wheelIndex: number;
  recordIndex: number;
  mesh: THREE.Object3D;
  baseY: number;
  steering: boolean;
}

interface ProgramRuntime {
  index: number;
  elapsed: number;
  motorEnabled: boolean;
  hingeTarget: number | null;
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
  private driveTerrain = new THREE.Group();
  private ghost: THREE.Group;
  private ghostValid = true;
  private ghostPointerReady = false;
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

  private instructionModels: Record<string, InstructionModel> = {};
  private instructionModelId = 'rover';
  private instructionSteps: InstructionStep[] = [];
  private instructionStep = 0;
  private instructionGhost?: THREE.Group;
  private instructionBackup?: BrickRecord[];

  private physicsWorld?: CANNON.World;
  private physicsEntries: PhysicsEntry[] = [];
  private physicsSnapshot?: BrickRecord[];
  private physicsGrab?: PhysicsGrab;

  private driveActiveState = false;
  private driveThrottle = 0;
  private driveSteer = 0;
  private driveWheelSpin = 0;
  private driveWorld?: CANNON.World;
  private driveBody?: CANNON.Body;
  private driveVehicle?: CANNON.RaycastVehicle;
  private driveWheelVisuals: DriveWheelVisual[] = [];
  private driveVisualYOffset = 0;
  private driveProgramElapsed = 0;
  private driveTelemetryElapsed = 0;
  private driveProgramRuntime: ProgramRuntime = {
    index: 0,
    elapsed: 0,
    motorEnabled: true,
    hingeTarget: null
  };
  private gearDirections = new Map<number, number>();

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
    this.driveTerrain.visible = false;
    this.scene.add(this.driveTerrain);

    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.002;
    this.ground.userData.kind = 'ground';
    this.scene.add(this.ground);

    this.buildLighting();
    this.buildBaseplate();
    this.buildBackdrop();
    this.buildInstructionModels();

    this.ghost = createPart(this.selected, 0.46);
    this.setGhostMaterial(false);
    this.ghost.visible = false;
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
  get driveActive(): boolean { return this.driveActiveState; }
  get driveBlockedReason(): string {
    if (this.records.length > 120) return 'DIORAMA // DRIVE TEST IS FOR VEHICLE BUILDS';
    if (!this.records.length || (this.wheelCount < 2 && this.propellerCount < 1)) {
      return 'ADD 2 WHEEL MODULES OR A PROPELLER';
    }
    return '';
  }
  get collapseBodyCount(): number { return this.physicsEntries.length; }
  get wheelCount(): number { return this.records.filter(record => record.kind === 'wheel').length; }
  get motorCount(): number { return this.records.filter(record => record.kind === 'motor').length; }
  get gearCount(): number { return this.records.filter(record => record.kind === 'gear').length; }
  get propellerCount(): number { return this.records.filter(record => record.kind === 'propeller').length; }
  get programCount(): number { return this.records.filter(record => record.kind === 'program').length; }
  get programMode(): ProgramMode {
    return this.records.find(record => record.kind === 'program')?.programMode ?? 'manual';
  }
  get programSteps(): ProgramCommand[] {
    const record = this.records.find(item => item.kind === 'program');
    if (record?.programSteps?.length) return [...record.programSteps];
    if (this.selected.kind === 'program' && this.selected.programSteps?.length) return [...this.selected.programSteps];
    return [];
  }
  get programCursor(): number {
    return this.driveActiveState && this.programSteps.length ? this.driveProgramRuntime.index : -1;
  }
  get suspensionContactCount(): number {
    return this.driveVehicle?.wheelInfos.filter(wheel => wheel.isInContact).length ?? 0;
  }
  get suspensionWheelCount(): number {
    return this.driveVehicle?.wheelInfos.length ?? this.wheelCount * 2;
  }
  get suspensionDebug(): string {
    if (!this.driveVehicle) return '';
    return this.driveVehicle.wheelInfos.map((wheel, index) =>
      `${index}:${wheel.isInContact ? 1 : 0}:${wheel.suspensionLength.toFixed(3)}` +
      `@${wheel.chassisConnectionPointWorld.x.toFixed(2)},${wheel.chassisConnectionPointWorld.y.toFixed(2)},${wheel.chassisConnectionPointWorld.z.toFixed(2)}` +
      `d${wheel.directionWorld.x.toFixed(2)},${wheel.directionWorld.y.toFixed(2)},${wheel.directionWorld.z.toFixed(2)}` +
      (wheel.raycastResult.body
        ? `b${wheel.raycastResult.body.position.x.toFixed(1)},${wheel.raycastResult.body.position.y.toFixed(1)},${wheel.raycastResult.body.position.z.toFixed(1)}`
        : 'b-')
    ).join('|');
  }
  get meshedGearPairs(): number {
    let pairs = 0;
    const gears = this.records
      .map((record, index) => ({ record, index }))
      .filter(item => item.record.kind === 'gear');
    for (let i = 0; i < gears.length; i++) {
      for (let j = i + 1; j < gears.length; j++) {
        const a = gears[i].record;
        const b = gears[j].record;
        const distance = Math.hypot(a.x - b.x, a.z - b.z);
        if (Math.abs(a.y - b.y) <= BODY_H * .8 && distance >= STUD * .65 && distance <= STUD * 2.12) pairs++;
      }
    }
    return pairs;
  }
  get instructionChoices(): { id: string; label: string; steps: number }[] {
    return Object.values(this.instructionModels).map(model => ({
      id: model.id,
      label: model.label,
      steps: model.steps.length
    }));
  }
  get instructionStatus(): { active: boolean; step: number; total: number; label: string; model: string } {
    const step = this.instructionSteps[this.instructionStep];
    return {
      active: this.mode === 'instruction',
      step: Math.min(this.instructionStep + 1, this.instructionSteps.length),
      total: this.instructionSteps.length,
      label: step?.label ?? 'COMPLETE',
      model: this.instructionModels[this.instructionModelId]?.label ?? 'GUIDED BUILD'
    };
  }

  setSpec(next: Partial<BrickSpec>): void {
    if (this.physicsActive || this.driveActive) return;
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
      roof: { w: 2, d: 4 },
      motor: { w: 2, d: 2 },
      gear: { w: 2, d: 2 },
      propeller: { w: 2, d: 2 },
      program: { w: 2, d: 2 }
    };
    this.setSpec({
      kind,
      ...defaults[kind],
      programMode: kind === 'program' ? 'manual' : this.selected.programMode
    });
  }

  rotateSelection(): boolean {
    if (this.physicsActive) return false;
    if (this.selectedIds.size && (this.mode === 'select' || this.mode === 'move')) {
      const candidate = this.records.map(record => ({ ...record }));
      for (const id of this.selectedIds) {
        const record = candidate[id];
        if (record) record.rotation = record.rotation ? 0 : 1;
      }
      const moving = [...this.selectedIds].map(id => candidate[id]).filter(Boolean);
      const fixed = candidate.filter((_, index) => !this.selectedIds.has(index));
      if (!this.recordsCanCoexist(moving, fixed)) return false;

      this.pushHistory();
      this.records = candidate;
      this.rebuildAll();
      this.notify();
      return true;
    }

    this.selected.rotation = this.selected.rotation ? 0 : 1;
    this.rebuildGhost();
    this.notify();
    return true;
  }

  paintSelection(color: number): boolean {
    if (this.physicsActive || this.driveActive || !this.selectedIds.size) return false;
    this.pushHistory();
    for (const id of this.selectedIds) {
      const record = this.records[id];
      if (record) record.color = color;
    }
    this.rebuildAll();
    this.notify();
    return true;
  }

  setProgramMode(mode: ProgramMode): boolean {
    if (this.physicsActive || this.driveActive) return false;
    const ids = this.records
      .map((record, index) => record.kind === 'program' ? index : -1)
      .filter(index => index >= 0);
    if (!ids.length) {
      if (this.selected.kind === 'program') {
        this.selected.programMode = mode;
        this.rebuildGhost();
        this.notify();
        return true;
      }
      return false;
    }
    this.pushHistory();
    for (const id of ids) this.records[id].programMode = mode;
    this.selected.programMode = mode;
    this.rebuildAll();
    this.notify();
    return true;
  }

  addProgramCommand(command: ProgramCommand): boolean {
    if (this.physicsActive || this.driveActive) return false;
    const ids = this.records
      .map((record, index) => record.kind === 'program' ? index : -1)
      .filter(index => index >= 0);
    if (!ids.length && this.selected.kind !== 'program') return false;

    this.pushHistory();
    if (ids.length) {
      for (const id of ids) {
        const steps = this.records[id].programSteps ?? [];
        this.records[id].programSteps = [...steps, command].slice(-16);
      }
    } else {
      this.selected.programSteps = [...(this.selected.programSteps ?? []), command].slice(-16);
    }
    this.rebuildAll();
    this.rebuildGhost();
    this.notify();
    return true;
  }

  removeLastProgramCommand(): boolean {
    if (this.physicsActive || this.driveActive) return false;
    const ids = this.records
      .map((record, index) => record.kind === 'program' ? index : -1)
      .filter(index => index >= 0);
    const current = ids.length ? this.records[ids[0]].programSteps ?? [] : this.selected.programSteps ?? [];
    if (!current.length) return false;

    this.pushHistory();
    if (ids.length) {
      for (const id of ids) this.records[id].programSteps = (this.records[id].programSteps ?? []).slice(0, -1);
    } else if (this.selected.kind === 'program') {
      this.selected.programSteps = current.slice(0, -1);
    }
    this.rebuildAll();
    this.rebuildGhost();
    this.notify();
    return true;
  }

  clearProgramCommands(): boolean {
    if (this.physicsActive || this.driveActive) return false;
    const ids = this.records
      .map((record, index) => record.kind === 'program' ? index : -1)
      .filter(index => index >= 0);
    const has = ids.some(id => (this.records[id].programSteps?.length ?? 0) > 0) ||
      (this.selected.kind === 'program' && (this.selected.programSteps?.length ?? 0) > 0);
    if (!has) return false;

    this.pushHistory();
    for (const id of ids) this.records[id].programSteps = [];
    if (this.selected.kind === 'program') this.selected.programSteps = [];
    this.rebuildAll();
    this.rebuildGhost();
    this.notify();
    return true;
  }

  adjustSelectedHinges(deltaDegrees: number): boolean {
    if (this.physicsActive || this.driveActive || !this.selectedIds.size) return false;
    const hingeIds = [...this.selectedIds].filter(id => this.records[id]?.kind === 'hinge');
    if (!hingeIds.length) return false;
    this.pushHistory();
    for (const id of hingeIds) {
      const record = this.records[id];
      record.hingeAngle = THREE.MathUtils.clamp((record.hingeAngle ?? 35) + deltaDegrees, 0, 110);
    }
    this.rebuildAll();
    this.notify();
    return true;
  }

  toggleDrive(): boolean {
    if (this.physicsActive || this.mode === 'instruction') return false;
    if (this.driveActiveState) {
      this.stopDrive(true);
      return true;
    }
    if (this.driveBlockedReason) return false;

    this.selectedIds.clear();
    this.refreshSelectionVisual();
    this.ghost.visible = false;
    this.driveActiveState = true;
    this.driveThrottle = 0;
    this.driveSteer = 0;
    this.driveWheelSpin = 0;
    this.driveProgramElapsed = 0;
    this.driveTelemetryElapsed = 0;
    this.driveProgramRuntime = { index: 0, elapsed: 0, motorEnabled: true, hingeTarget: null };
    this.gearDirections = this.computeGearDirections();

    this.brickLayer.position.set(0, 0, 0);
    this.brickLayer.rotation.set(0, 0, 0);
    this.brickLayer.quaternion.identity();

    const bounds = new THREE.Box3().setFromObject(this.brickLayer);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());

    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    world.allowSleep = false;
    world.defaultContactMaterial.friction = .84;
    world.defaultContactMaterial.restitution = .025;

    const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    ground.position.y = -.025;
    ground.aabbNeedsUpdate = true;
    ground.updateAABB();
    world.addBody(ground);

    const mass = Math.max(1.1, this.records.length * .18 + this.motorCount * .30);
    const body = new CANNON.Body({
      mass,
      linearDamping: .16,
      angularDamping: .72,
      allowSleep: false
    });
    // Keep steering/yaw free, but damp excessive pitch/roll that lifts whole axles
    // off the ground on short, multi-axle brick vehicles.
    body.angularFactor.set(.18, 1, .18);
    body.addShape(
      new CANNON.Box(new CANNON.Vec3(
        Math.max(.32, size.x * .46),
        Math.max(.18, Math.min(.28, size.y * .10)),
        Math.max(.32, size.z * .46)
      )),
      new CANNON.Vec3(center.x, .30, center.z)
    );
    body.position.set(0, .45, 0);
    this.driveVisualYOffset = body.position.y;

    const vehicle = new CANNON.RaycastVehicle({
      chassisBody: body,
      indexRightAxis: 0,
      indexUpAxis: 1,
      indexForwardAxis: 2
    });

    const wheelRecords = this.records
      .map((record, index) => ({ record, index }))
      .filter(item => item.record.kind === 'wheel');
    const frontZ = wheelRecords.length ? Math.min(...wheelRecords.map(item => item.record.z)) : 0;

    this.driveWheelVisuals = [];
    for (const item of wheelRecords) {
      const record = item.record;
      const f = footprint(record);
      const group = this.brickLayer.children[item.index];
      const visuals: THREE.Object3D[] = [];
      group?.traverse(object => {
        if (object.userData.partRole === 'wheel') visuals.push(object);
      });

      for (const visual of visuals) {
        const side = Number(visual.userData.wheelSide ?? 1) || 1;
        const localX = record.x + side * f.w * STUD * .56;
        const localZ = record.z;
        const wheelIndex = vehicle.addWheel({
          radius: .50,
          directionLocal: new CANNON.Vec3(0, -1, 0),
          suspensionStiffness: 34,
          suspensionRestLength: .44,
          frictionSlip: 5.2,
          dampingRelaxation: 2.8,
          dampingCompression: 4.5,
          maxSuspensionForce: 7600,
          rollInfluence: .045,
          axleLocal: new CANNON.Vec3(-1, 0, 0),
          chassisConnectionPointLocal: new CANNON.Vec3(
            localX,
            record.y + BODY_H * .38 + .12,
            localZ
          ),
          maxSuspensionTravel: .34,
          customSlidingRotationalSpeed: -24,
          useCustomSlidingRotationalSpeed: true
        });
        this.driveWheelVisuals.push({
          wheelIndex,
          recordIndex: item.index,
          mesh: visual,
          baseY: visual.position.y,
          steering: record.z <= frontZ + STUD * .45
        });
      }
    }

    vehicle.addToWorld(world);
    this.buildDriveTerrain(world);

    const wallHeight = 2.4;
    const wallThickness = .35;
    const wallLength = 30;
    const addWall = (x: number, z: number, sx: number, sz: number): void => {
      const wall = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(sx / 2, wallHeight / 2, sz / 2))
      });
      wall.position.set(x, wallHeight / 2, z);
      wall.aabbNeedsUpdate = true;
      wall.updateAABB();
      world.addBody(wall);
    };
    addWall(14.5, 0, wallThickness, wallLength);
    addWall(-14.5, 0, wallThickness, wallLength);
    addWall(0, 14.5, wallLength, wallThickness);
    addWall(0, -14.5, wallLength, wallThickness);

    this.driveWorld = world;
    this.driveBody = body;
    this.driveVehicle = vehicle;
    this.notify();
    return true;
  }

  setDriveControl(throttle: number, steer: number): void {
    if (!this.driveActiveState) return;
    this.driveThrottle = THREE.MathUtils.clamp(throttle, -1, 1);
    this.driveSteer = THREE.MathUtils.clamp(steer, -1, 1);
  }

  stopDrive(reset = true): void {
    if (!this.driveActiveState) return;
    this.driveActiveState = false;
    this.driveThrottle = 0;
    this.driveSteer = 0;
    if (this.driveVehicle && this.driveWorld) this.driveVehicle.removeFromWorld(this.driveWorld);
    this.driveWorld = undefined;
    this.driveBody = undefined;
    this.driveVehicle = undefined;
    this.driveWheelVisuals = [];
    this.driveVisualYOffset = 0;
    this.driveProgramElapsed = 0;
    this.driveTelemetryElapsed = 0;
    this.driveProgramRuntime = { index: 0, elapsed: 0, motorEnabled: true, hingeTarget: null };
    this.driveTerrain.clear();
    this.driveTerrain.visible = false;

    if (reset) {
      this.brickLayer.position.set(0, 0, 0);
      this.brickLayer.rotation.set(0, 0, 0);
      this.brickLayer.quaternion.identity();
      this.driveWheelSpin = 0;
      this.orbitTarget.set(0, 1.2, 0);
      this.rebuildAll();
      this.updateCamera();
    }

    this.ghost.visible = this.mode === 'build';
    this.notify();
  }

  setMode(mode: Mode): void {
    if (this.physicsActive || this.driveActive) return;
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
    if (this.physicsActive || this.driveActive || this.mode === 'instruction') return;
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.snapshot());
    this.restore(prev);
  }

  redo(): void {
    if (this.physicsActive || this.driveActive || this.mode === 'instruction') return;
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.restore(next);
  }

  saveSlot(slot: number): boolean {
    if (this.physicsActive || this.driveActive) return false;
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
    if (this.physicsActive || this.driveActive) return false;
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
    if (this.physicsActive || this.driveActive || !this.records.length) return;
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
    if (this.physicsActive || this.driveActive) return;
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
    if (this.physicsActive || this.driveActive || !this.selectedIds.size) return false;
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
    if (this.physicsActive || this.driveActive || !this.selectedIds.size) return false;
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

  loadSample(sampleId:
    | 'house' | 'titan' | 'rescue' | 'fortress' | 'explorer'
    | 'skyport' | 'harbor' | 'alpine' | 'megaforge'
  ): boolean {
    if (this.physicsActive || this.driveActive) return false;
    this.pushHistory();

    const C = {
      red: 0xe53935,
      blue: 0x1e6bd6,
      yellow: 0xf5c62b,
      green: 0x2f9e55,
      orange: 0xf57c21,
      white: 0xf4f5f7,
      black: 0x30343b,
      gray: 0x7b8797,
      cyan: 0x32b9d8
    };

    const list: BrickRecord[] = [];
    const add = (
      kind: PartKind, w: number, d: number,
      x: number, y: number, z: number, color: number,
      rotation: 0 | 1 = 0,
      extras: Partial<BrickSpec> = {}
    ): void => {
      list.push({ kind, w, d, x, y, z, color, rotation, ...extras });
    };

    const brickLineX = (z: number, y: number, color: number, from = -4.8, to = 4.8): void => {
      for (let x = from; x <= to + .01; x += 1.6) add('brick', 2, 4, x, y, z, color);
    };
    const brickLineZ = (x: number, y: number, color: number, from = -4.8, to = 4.8): void => {
      for (let z = from; z <= to + .01; z += 1.6) add('brick', 2, 4, x, y, z, color, 1);
    };

    if (sampleId === 'house') {
      brickLineX(-2.4, 0, C.black, -2.4, 2.4);
      brickLineX(2.4, 0, C.black, -2.4, 2.4);
      brickLineX(-2.4, BODY_H, C.red, -2.4, 2.4);
      brickLineX(2.4, BODY_H, C.red, -2.4, 2.4);
      for (const x of [-2.4, 2.4]) {
        for (const z of [-.8, .8]) add('brick', 2, 4, x, BODY_H, z, C.red, 1);
      }
      add('window', 2, 1, -2.4, BODY_H * 2, 0, C.white, 1);
      add('window', 2, 1, 2.4, BODY_H * 2, 0, C.white, 1);
      add('hinge', 2, 2, 0, BODY_H * 2, 2.4, C.blue, 0, { hingeAngle: 55 });
      add('slope', 2, 2, -1.2, BODY_H * 2, -2.4, C.blue);
      add('slope', 2, 2, 1.2, BODY_H * 2, -2.4, C.blue, 1);
      add('roof', 2, 4, -1.6, BODY_H * 3.4, 0, C.blue);
      add('roof', 2, 4, 1.6, BODY_H * 3.4, 0, C.blue);
    }

    if (sampleId === 'titan') {
      // TITAN HAULER: long heavy vehicle, 8 wheel modules / 16 visual wheels.
      for (const z of [-4.8, -3.2, -1.6, 0, 1.6, 3.2, 4.8]) {
        for (const x of [-2.4, -.8, .8, 2.4]) add('brick', 2, 4, x, BODY_H * .7, z, C.black);
      }
      for (const z of [-5.6, -4.0, -2.4, -.8, .8, 2.4, 4.0, 5.6]) {
        add('wheel', 2, 2, 0, 0, z, C.black);
      }
      for (const x of [-1.6, 1.6]) {
        add('motor', 2, 2, x, BODY_H * 1.7, 2.4, C.red);
        add('motor', 2, 2, x, BODY_H * 1.7, -2.4, C.red);
      }
      for (const x of [-2.4, -.8, .8, 2.4]) {
        add('gear', 2, 2, x, BODY_H * 2.9, 1.6, C.yellow);
      }
      brickLineX(-3.8, BODY_H * 2.9, C.blue, -3.2, 3.2);
      brickLineX(3.8, BODY_H * 2.9, C.blue, -3.2, 3.2);
      for (const x of [-3.2, 3.2]) {
        add('window', 2, 1, x, BODY_H * 4.0, -2.2, C.white, 1);
        add('window', 2, 1, x, BODY_H * 4.0, 2.2, C.white, 1);
      }
      add('slope', 2, 4, 0, BODY_H * 3.0, -5.0, C.orange);
      add('slope', 2, 4, -1.6, BODY_H * 3.0, -5.0, C.orange);
      add('slope', 2, 4, 1.6, BODY_H * 3.0, -5.0, C.orange);
      add('hinge', 2, 2, -2.4, BODY_H * 4.0, 4.8, C.orange, 0, { hingeAngle: 70 });
      add('hinge', 2, 2, 2.4, BODY_H * 4.0, 4.8, C.orange, 0, { hingeAngle: 70 });
      add('propeller', 2, 2, -2.4, BODY_H * 5.2, 4.6, C.cyan);
      add('propeller', 2, 2, 2.4, BODY_H * 5.2, 4.6, C.cyan);
      add('program', 2, 2, 0, BODY_H * 4.1, -1.0, C.white, 0, {
        programMode: 'manual',
        programSteps: [
          'motorOn','forward','forward','left','forward',
          'right','hingeOpen','wait','hingeClose','forward'
        ]
      });
      for (const x of [-2.4, 0, 2.4]) add('roof', 2, 4, x, BODY_H * 5.8, -.8, C.blue);
    }

    if (sampleId === 'rescue') {
      // RESCUE COMMAND: articulated rescue truck with multiple programmable doors.
      for (const z of [-4.0, -2.4, -.8, .8, 2.4, 4.0]) {
        for (const x of [-1.6, 0, 1.6]) add('brick', 2, 4, x, BODY_H * .7, z, C.gray);
      }
      for (const z of [-3.6, -.4, 2.8]) add('wheel', 2, 2, 0, 0, z, C.black);
      add('motor', 2, 2, -1.2, BODY_H * 1.7, 1.6, C.red);
      add('motor', 2, 2, 1.2, BODY_H * 1.7, 1.6, C.red);
      for (const x of [-1.6, 0, 1.6]) {
        add('gear', 2, 2, x, BODY_H * 2.8, 2.4, C.yellow);
      }
      for (const z of [-3.2, -1.6, 0, 1.6]) {
        add('window', 2, 1, -2.4, BODY_H * 3.0, z, C.cyan, 1);
        add('window', 2, 1, 2.4, BODY_H * 3.0, z, C.cyan, 1);
      }
      for (const z of [-2.4, 0, 2.4]) {
        add('hinge', 2, 2, -2.4, BODY_H * 4.4, z, C.orange, 1, { hingeAngle: 30 });
        add('hinge', 2, 2, 2.4, BODY_H * 4.4, z, C.orange, 1, { hingeAngle: 30 });
      }
      add('slope', 2, 4, -1.2, BODY_H * 2.9, -4.8, C.white);
      add('slope', 2, 4, 1.2, BODY_H * 2.9, -4.8, C.white);
      add('propeller', 2, 2, 0, BODY_H * 5.4, 4.4, C.red);
      add('program', 2, 2, 0, BODY_H * 4.0, -1.2, C.white, 0, {
        programSteps: [
          'motorOn','forward','left','wait','hingeOpen',
          'wait','hingeClose','right','forward'
        ]
      });
      for (const x of [-1.6, 0, 1.6]) add('roof', 2, 4, x, BODY_H * 6.0, .4, C.red);
    }

    if (sampleId === 'fortress') {
      // GEARWORKS FORTRESS: dense structure designed for gear animation + collapse.
      for (const yLayer of [0, 1, 2]) {
        const y = BODY_H * yLayer;
        brickLineX(-5.6, y, yLayer % 2 ? C.gray : C.black, -5.6, 5.6);
        brickLineX(5.6, y, yLayer % 2 ? C.gray : C.black, -5.6, 5.6);
        brickLineZ(-5.6, y, yLayer % 2 ? C.gray : C.black, -4.0, 4.0);
        brickLineZ(5.6, y, yLayer % 2 ? C.gray : C.black, -4.0, 4.0);
      }
      for (const x of [-4.8, -3.2, -1.6, 0, 1.6, 3.2, 4.8]) {
        add('gear', 2, 2, x, BODY_H * 3.2, 0, C.yellow);
      }
      add('motor', 2, 2, -4.8, BODY_H * 4.4, 0, C.red);
      add('motor', 2, 2, 4.8, BODY_H * 4.4, 0, C.red);
      for (const x of [-4.8, -2.4, 0, 2.4, 4.8]) {
        add('window', 2, 1, x, BODY_H * 4.4, -5.2, C.cyan);
        add('window', 2, 1, x, BODY_H * 4.4, 5.2, C.cyan);
      }
      for (const x of [-4.8, 4.8]) {
        for (const z of [-4.8, 0, 4.8]) {
          add('hinge', 2, 2, x, BODY_H * 5.6, z, C.orange, 1, { hingeAngle: 75 });
        }
      }
      for (const x of [-4.0, 0, 4.0]) {
        add('propeller', 2, 2, x, BODY_H * 6.7, 0, C.red);
        add('roof', 2, 4, x, BODY_H * 7.5, 0, C.blue);
      }
      add('program', 2, 2, 0, BODY_H * 5.6, -2.4, C.white, 0, {
        programSteps: ['motorOn','hingeOpen','wait','hingeClose','wait']
      });
      add('wheel', 2, 2, 0, 0, -4.8, C.black);
      add('wheel', 2, 2, 0, 0, 4.8, C.black);
    }

    if (sampleId === 'explorer') {
      // POWER EXPLORER: compact but dense programmable testbed.
      for (const z of [-3.2, -1.6, 0, 1.6, 3.2]) {
        for (const x of [-2.4, -.8, .8, 2.4]) add('brick', 2, 4, x, BODY_H * .7, z, C.blue);
      }
      for (const z of [-3.0, 0, 3.0]) add('wheel', 2, 2, 0, 0, z, C.black);
      for (const x of [-1.6, 1.6]) {
        add('motor', 2, 2, x, BODY_H * 1.7, 1.6, C.red);
        add('propeller', 2, 2, x, BODY_H * 3.1, 3.0, C.cyan);
      }
      for (const x of [-2.4, -.8, .8, 2.4]) add('gear', 2, 2, x, BODY_H * 2.9, 0, C.yellow);
      add('window', 2, 1, -1.2, BODY_H * 3.0, -2.4, C.white);
      add('window', 2, 1, 1.2, BODY_H * 3.0, -2.4, C.white);
      add('hinge', 2, 2, -2.4, BODY_H * 4.2, 1.6, C.orange, 1, { hingeAngle: 40 });
      add('hinge', 2, 2, 2.4, BODY_H * 4.2, 1.6, C.orange, 1, { hingeAngle: 40 });
      add('slope', 2, 4, 0, BODY_H * 3.0, -3.6, C.orange);
      add('program', 2, 2, 0, BODY_H * 4.0, -.4, C.white, 0, {
        programSteps: [
          'motorOn','forward','left','forward','right',
          'hingeOpen','wait','reverse','hingeClose','forward'
        ]
      });
      for (const x of [-1.6, 1.6]) add('roof', 2, 4, x, BODY_H * 5.2, 0, C.white);
    }


    if (sampleId === 'skyport') {
      // SKYPORT CITY: elevated terminal, control tower, service convoy and turbine gates.
      for (const z of [-6.4,-4.8,-3.2,-1.6,0,1.6,3.2,4.8,6.4]) {
        for (const x of [-6.4,-4.8,-3.2,-1.6,0,1.6,3.2,4.8,6.4]) {
          if (Math.abs(x) <= 1.6 || Math.abs(z) >= 4.8 || (Math.abs(x) >= 4.8 && Math.abs(z) <= 3.2)) {
            add('brick', 2, 4, x, BODY_H * .35, z, C.gray);
          }
        }
      }

      for (const yLayer of [1.5, 2.5, 3.5]) {
        const y = BODY_H * yLayer;
        brickLineX(-4.8, y, C.white, -5.6, 5.6);
        brickLineX(4.8, y, C.white, -5.6, 5.6);
        brickLineZ(-5.6, y, C.blue, -3.2, 3.2);
        brickLineZ(5.6, y, C.blue, -3.2, 3.2);
      }

      for (const x of [-4.8,-3.2,-1.6,0,1.6,3.2,4.8]) {
        add('window', 2, 1, x, BODY_H * 4.6, -4.8, C.cyan);
        add('window', 2, 1, x, BODY_H * 4.6, 4.8, C.cyan);
      }

      for (const z of [-2.4,0,2.4]) {
        add('hinge', 2, 2, -5.6, BODY_H * 4.8, z, C.orange, 1, { hingeAngle: 72 });
        add('hinge', 2, 2, 5.6, BODY_H * 4.8, z, C.orange, 1, { hingeAngle: 72 });
      }

      for (const yLayer of [1,2,3,4,5,6,7,8]) {
        add('brick', 2, 2, 0, BODY_H * yLayer, 0, yLayer % 2 ? C.black : C.blue);
      }
      for (const x of [-1.6,0,1.6]) {
        add('window', 2, 1, x, BODY_H * 9.2, 0, C.cyan);
      }
      add('roof', 2, 4, 0, BODY_H * 11.4, 0, C.white);
      add('propeller', 2, 2, -1.6, BODY_H * 10.4, 1.6, C.red);
      add('propeller', 2, 2, 1.6, BODY_H * 10.4, 1.6, C.red);

      for (const x of [-4.0,-2.4,-.8,.8,2.4,4.0]) {
        add('gear', 2, 2, x, BODY_H * 2.0, -1.6, C.yellow);
      }
      add('motor', 2, 2, -4.0, BODY_H * 3.2, -1.6, C.red);
      add('motor', 2, 2, 4.0, BODY_H * 3.2, -1.6, C.red);

      for (const z of [-5.6,-2.4,.8,4.0]) add('wheel', 2, 2, -3.2, 0, z, C.black);
      for (const z of [-5.6,-2.4,.8,4.0]) add('wheel', 2, 2, 3.2, 0, z, C.black);

      add('program', 2, 2, 0, BODY_H * 5.2, -3.2, C.white, 0, {
        programSteps: [
          'motorOn','forward','left','forward','right',
          'hingeOpen','wait','hingeClose','forward','wait'
        ]
      });

      for (const x of [-4.8,-1.6,1.6,4.8]) {
        add('roof', 2, 4, x, BODY_H * 6.2, -4.0, C.blue);
        add('roof', 2, 4, x, BODY_H * 6.2, 4.0, C.blue);
      }
    }

    if (sampleId === 'harbor') {
      // INDUSTRIAL HARBOR: docks, warehouses, crane towers and powered machinery.
      for (const z of [-6.4,-4.8,-3.2,-1.6,0,1.6,3.2,4.8,6.4]) {
        for (const x of [-6.4,-4.8,-3.2,-1.6,0,1.6,3.2,4.8,6.4]) {
          if (z >= 0 || x <= -3.2) add('brick', 2, 4, x, BODY_H * .3, z, z < 0 ? C.gray : C.black);
        }
      }

      for (const yLayer of [1.4,2.4,3.4,4.4]) {
        const y = BODY_H * yLayer;
        brickLineX(4.8, y, C.orange, -5.6, -1.6);
        brickLineX(1.6, y, C.orange, -5.6, -1.6);
        brickLineZ(-5.6, y, C.orange, 2.4, 4.8);
        brickLineZ(-1.6, y, C.orange, 2.4, 4.8);
      }

      for (const x of [-4.8,-3.2,-1.6,0,1.6,3.2]) {
        add('window', 2, 1, x, BODY_H * 4.8, 1.6, C.cyan);
        add('roof', 2, 4, x, BODY_H * 6.0, 3.2, C.gray);
      }

      for (const craneX of [2.4,5.6]) {
        for (const yLayer of [1,2,3,4,5,6,7,8]) {
          add('brick', 2, 2, craneX, BODY_H * yLayer, -3.2, C.yellow);
        }
        for (const x of [craneX-1.6,craneX,craneX+1.6]) {
          add('brick', 2, 4, x, BODY_H * 9.1, -3.2, C.yellow);
        }
        add('hinge', 2, 2, craneX+1.6, BODY_H * 10.2, -3.2, C.orange, 1, { hingeAngle: 88 });
        add('gear', 2, 2, craneX, BODY_H * 7.6, -2.0, C.yellow);
        add('gear', 2, 2, craneX+1.2, BODY_H * 7.6, -2.0, C.yellow);
        add('motor', 2, 2, craneX-1.2, BODY_H * 7.6, -2.0, C.red);
      }

      for (const z of [1.6,3.2,4.8,6.4]) {
        for (const x of [1.6,3.2,4.8,6.4]) {
          add('brick', 2, 4, x, BODY_H * 1.4, z, (Math.round((x+z)*10) % 3 === 0) ? C.red : C.blue);
          if ((x + z) % 3.2 < .2) add('brick', 2, 4, x, BODY_H * 2.4, z, C.orange);
        }
      }

      for (const z of [-5.6,-3.2,-.8]) add('wheel', 2, 2, -4.0, 0, z, C.black);
      add('motor', 2, 2, -4.0, BODY_H * 1.6, -2.4, C.red);
      add('program', 2, 2, -4.0, BODY_H * 2.8, -1.0, C.white, 0, {
        programSteps: ['motorOn','forward','left','forward','wait','right','forward']
      });

      for (const x of [-5.6,-4.0,-2.4]) {
        add('slope', 2, 4, x, BODY_H * 1.2, -6.0, C.gray);
      }
    }

    if (sampleId === 'alpine') {
      // ALPINE RESCUE BASE: mountain station, bridge, hangar and rescue convoy.
      for (const z of [-6.4,-4.8,-3.2,-1.6,0,1.6,3.2,4.8,6.4]) {
        for (const x of [-6.4,-4.8,-3.2,-1.6,0,1.6,3.2,4.8,6.4]) {
          const ridge = Math.abs(x) + Math.abs(z) > 7.2;
          const y = ridge ? BODY_H * 1.1 : BODY_H * .25;
          add('brick', 2, 4, x, y, z, ridge ? C.gray : C.white);
          if (ridge && (Math.abs(x) + Math.abs(z) > 9.5)) {
            add('slope', 2, 2, x, y + BODY_H, z, C.white, (x+z>0?1:0));
          }
        }
      }

      for (const yLayer of [2,3,4,5]) {
        const y = BODY_H * yLayer;
        brickLineX(-2.4, y, C.red, -4.8, 0);
        brickLineX(2.4, y, C.red, -4.8, 0);
        brickLineZ(-4.8, y, C.red, -1.6, 1.6);
        brickLineZ(0, y, C.red, -1.6, 1.6);
      }
      for (const z of [-1.6,0,1.6]) {
        add('window', 2, 1, -4.8, BODY_H * 6.0, z, C.cyan, 1);
        add('window', 2, 1, 0, BODY_H * 6.0, z, C.cyan, 1);
      }
      for (const x of [-4.0,-2.4,-.8]) add('roof', 2, 4, x, BODY_H * 7.2, 0, C.blue);

      for (const x of [1.6,3.2,4.8,6.4]) {
        add('brick', 2, 4, x, BODY_H * 2.4, -1.6, C.gray);
        add('brick', 2, 4, x, BODY_H * 2.4, 1.6, C.gray);
      }
      add('hinge', 2, 2, 1.6, BODY_H * 3.5, -1.6, C.orange, 0, { hingeAngle: 18 });
      add('hinge', 2, 2, 6.4, BODY_H * 3.5, 1.6, C.orange, 0, { hingeAngle: 18 });

      for (const z of [3.2,4.8,6.4]) add('wheel', 2, 2, 3.2, 0, z, C.black);
      add('motor', 2, 2, 3.2, BODY_H * 1.6, 4.8, C.red);
      add('gear', 2, 2, 2.4, BODY_H * 2.8, 4.8, C.yellow);
      add('gear', 2, 2, 4.0, BODY_H * 2.8, 4.8, C.yellow);
      add('propeller', 2, 2, 3.2, BODY_H * 4.0, 6.4, C.red);
      add('program', 2, 2, 3.2, BODY_H * 4.0, 3.2, C.white, 0, {
        programSteps: ['motorOn','forward','left','wait','hingeOpen','hingeClose','right','forward']
      });

      for (const x of [2.4,4.0]) {
        for (const z of [-5.6,-4.0]) add('roof', 2, 4, x, BODY_H * 3.6, z, C.red);
      }
    }

    if (sampleId === 'megaforge') {
      // MEGAFORGE DISTRICT: factory blocks, gear walls, gates and powered test lane.
      for (const z of [-6.4,-4.8,-3.2,-1.6,0,1.6,3.2,4.8,6.4]) {
        for (const x of [-6.4,-4.8,-3.2,-1.6,0,1.6,3.2,4.8,6.4]) {
          if (!(Math.abs(x) < 1.0 && z < 4.8)) add('brick', 2, 4, x, BODY_H * .28, z, C.black);
        }
      }

      for (const bx of [-5.0, 3.0]) {
        for (const yLayer of [1.3,2.3,3.3,4.3,5.3]) {
          const y = BODY_H * yLayer;
          brickLineX(-4.0, y, C.gray, bx-1.6, bx+1.6);
          brickLineX(1.6, y, C.gray, bx-1.6, bx+1.6);
          brickLineZ(bx-1.6, y, C.gray, -2.4, .8);
          brickLineZ(bx+1.6, y, C.gray, -2.4, .8);
        }
        for (const z of [-2.4,-.8,.8]) {
          add('window', 2, 1, bx-1.6, BODY_H * 6.2, z, C.orange, 1);
          add('window', 2, 1, bx+1.6, BODY_H * 6.2, z, C.orange, 1);
        }
      }

      for (const z of [-5.6,-4.0,-2.4,-.8,.8,2.4]) {
        for (const x of [-.8,.8]) add('gear', 2, 2, x, BODY_H * 2.2, z, C.yellow);
      }
      add('motor', 2, 2, -2.4, BODY_H * 2.2, -5.6, C.red);
      add('motor', 2, 2, 2.4, BODY_H * 2.2, 2.4, C.red);

      for (const z of [-4.8,-1.6,1.6,4.8]) {
        add('hinge', 2, 2, -2.4, BODY_H * 3.4, z, C.orange, 1, { hingeAngle: 85 });
        add('hinge', 2, 2, 2.4, BODY_H * 3.4, z, C.orange, 1, { hingeAngle: 85 });
      }

      for (const x of [-5.6,-2.4,.8,4.0]) {
        add('propeller', 2, 2, x, BODY_H * 7.0, 4.8, C.cyan);
        add('roof', 2, 4, x, BODY_H * 8.0, 4.8, C.red);
      }

      for (const z of [-5.6,-2.4,.8,4.0]) add('wheel', 2, 2, 5.6, 0, z, C.black);
      add('motor', 2, 2, 5.6, BODY_H * 1.6, -1.6, C.red);
      add('program', 2, 2, 5.6, BODY_H * 2.8, 1.6, C.white, 0, {
        programSteps: [
          'motorOn','forward','hingeOpen','wait',
          'forward','hingeClose','left','forward','right'
        ]
      });

      for (const x of [-5.6,-4.0,-2.4]) {
        add('slope', 2, 4, x, BODY_H * 1.5, 5.6, C.orange);
      }
    }

    this.restore(list);
    const diorama = ['skyport','harbor','alpine','megaforge'].includes(sampleId);
    this.orbitTarget.set(0, sampleId === 'fortress' ? 2.1 : diorama ? 2.8 : 1.5, 0);
    this.distance =
      sampleId === 'fortress' ? 18.5 :
      diorama ? 22.5 :
      sampleId === 'titan' ? 17.0 : 15.5;
    this.updateCamera();
    this.ghostPointerReady = false;
    this.ghost.visible = false;
    return true;
  }

  demoHouse(): void {
    this.loadSample('house');
  }

  startInstructions(modelId = this.instructionModelId): void {
    if (this.physicsActive || this.driveActive) return;
    const model = this.instructionModels[modelId] ?? this.instructionModels.rover;
    if (!model) return;
    if (this.mode !== 'instruction') this.instructionBackup = this.snapshot();
    this.instructionModelId = model.id;
    this.instructionSteps = model.steps.map(step => ({
      label: step.label,
      record: { ...step.record }
    }));
    this.records = [];
    this.selectedIds.clear();
    this.rebuildAll();
    this.mode = 'instruction';
    this.instructionStep = 0;
    this.orbitTarget.set(0, 1.0, 0);
    this.azimuth = Math.PI * .28;
    this.polar = .92;
    this.distance = 9.5;
    this.updateCamera();
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
    const previous = this.instructionBackup?.map(record => ({ ...record })) ?? [];
    this.removeInstructionGhost();
    this.instructionBackup = undefined;
    this.mode = 'select';
    this.selectedIds.clear();
    this.pushHistorySnapshot(previous);
    this.orbitTarget.set(0, 1.05, 0);
    this.distance = 10.5;
    this.updateCamera();
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

  private buildInstructionModels(): void {
    const black = 0x30343b;
    const blue = 0x1e6bd6;
    const yellow = 0xf5c62b;
    const white = 0xf4f5f7;
    const orange = 0xf57c21;
    const red = 0xe53935;
    const green = 0x2f9e55;

    const make = (
      label: string, kind: PartKind, w: number, d: number,
      x: number, y: number, z: number, color: number,
      rotation: 0 | 1 = 0, hingeAngle?: number,
      extras: Partial<BrickSpec> = {}
    ): InstructionStep => ({
      label,
      record: { kind, w, d, x, y, z, color, rotation, hingeAngle, ...extras }
    });

    this.instructionModels = {
      rover: {
        id: 'rover',
        label: 'MINI ROVER',
        steps: [
          make('Rear wheel module', 'wheel', 2, 2, 0, 0, 1.2, black),
          make('Front wheel module', 'wheel', 2, 2, 0, 0, -1.2, black),
          make('Main chassis', 'brick', 2, 4, 0, BODY_H * .65, 0, blue),
          make('Front slope', 'slope', 2, 2, 0, BODY_H * 1.65, -1.0, yellow),
          make('Cabin window', 'window', 2, 1, 0, BODY_H * 1.65, .65, white),
          make('Opening rear hinge', 'hinge', 2, 2, 0, BODY_H * 1.65, 1.55, orange, 0, 62),
          make('Cabin roof', 'roof', 2, 2, 0, BODY_H * 4.15, .65, red)
        ]
      },
      house: {
        id: 'house',
        label: 'MICRO HOUSE',
        steps: [
          make('Foundation left', 'brick', 2, 4, -1.2, 0, 0, black),
          make('Foundation right', 'brick', 2, 4, 1.2, 0, 0, black),
          make('Front wall', 'brick', 2, 4, 0, BODY_H, -1.6, white),
          make('Rear wall', 'brick', 2, 4, 0, BODY_H, 1.6, white),
          make('Picture window', 'window', 2, 1, 0, BODY_H * 2, -1.6, blue),
          make('Opening awning', 'hinge', 2, 2, 0, BODY_H * 2, 1.6, green, 0, 48),
          make('Roof left', 'roof', 2, 4, -1.0, BODY_H * 3.3, 0, red),
          make('Roof right', 'roof', 2, 4, 1.0, BODY_H * 3.3, 0, red)
        ]
      },
      tower: {
        id: 'tower',
        label: 'SIGNAL TOWER',
        steps: [
          make('Base', 'brick', 2, 4, 0, 0, 0, black),
          make('Lower column', 'brick', 2, 2, 0, BODY_H, 0, blue),
          make('Upper column', 'brick', 2, 2, 0, BODY_H * 2, 0, blue),
          make('Observation window', 'window', 2, 1, 0, BODY_H * 3, 0, white),
          make('Signal slope', 'slope', 2, 2, 0, BODY_H * 5.8, 0, yellow),
          make('Service hinge', 'hinge', 2, 2, 0, BODY_H * 4.2, .8, orange, 0, 82),
          make('Signal roof', 'roof', 2, 2, 0, BODY_H * 7.4, 0, red)
        ]
      },
      buggy: {
        id: 'buggy',
        label: 'POWER BUGGY',
        steps: [
          make('Rear wheel module', 'wheel', 2, 2, 0, 0, 1.6, black),
          make('Front wheel module', 'wheel', 2, 2, 0, 0, -1.6, black),
          make('Long chassis', 'brick', 2, 4, 0, BODY_H * .7, 0, blue),
          make('Drive motor', 'motor', 2, 2, 0, BODY_H * 1.7, .8, red),
          make('Torque gear', 'gear', 2, 2, 0, BODY_H * 2.9, .8, yellow),
          make(
            'Program controller', 'program', 2, 2, 0, BODY_H * 1.7, -.8, white, 0, undefined,
            {
              programMode: 'manual',
              programSteps: [
                'motorOn', 'forward', 'left', 'forward',
                'right', 'hingeOpen', 'wait', 'hingeClose'
              ]
            }
          ),
          make('Front aero slope', 'slope', 2, 2, 0, BODY_H * 2.9, -1.2, orange),
          make('Rear propeller', 'propeller', 2, 2, 0, BODY_H * 4.0, 1.55, green),
          make('Driver roof', 'roof', 2, 2, 0, BODY_H * 4.1, -.3, red)
        ]
      }
    };

    const initial = this.instructionModels[this.instructionModelId] ?? this.instructionModels.rover;
    this.instructionSteps = initial.steps.map(step => ({
      label: step.label,
      record: { ...step.record }
    }));
  }

  private bindPointer(): void {
    this.canvas.style.touchAction = 'none';

    this.canvas.addEventListener('pointerdown', event => {
      if (this.mode === 'instruction' || this.driveActive) return;
      this.canvas.setPointerCapture(event.pointerId);
      this.updatePointerNdc(event.clientX, event.clientY);
      if (this.mode === 'build' && !this.physicsActive) {
        this.ghostPointerReady = true;
        this.updateGhost();
      }

      if (this.physicsActive) {
        const id = this.partIdAtPointer();
        if (id !== null) this.beginPhysicsGrab(id, event.pointerId);
        return;
      }

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
      if (this.mode === 'instruction' || this.driveActive) return;

      if (this.physicsActive) {
        if (this.physicsGrab?.pointerId === event.pointerId) {
          this.updatePointerNdc(event.clientX, event.clientY);
          this.updatePhysicsGrab();
        }
        return;
      }

      const info = this.pointers.get(event.pointerId);
      if (!info) {
        this.updatePointerNdc(event.clientX, event.clientY);
        this.ghostPointerReady = true;
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
      if (this.physicsActive) {
        if (this.physicsGrab?.pointerId === event.pointerId) this.endPhysicsGrab();
        return;
      }

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

      if (wasTap) {
        this.updatePointerNdc(event.clientX, event.clientY);
        if (this.mode === 'remove') this.removeAtPointer();
        else if (this.mode === 'select') this.toggleSelectionAtPointer();
        else if (this.mode === 'build') this.placeAtPointer();
      }
      if (event.pointerType === 'touch') {
        this.ghostPointerReady = false;
        this.ghost.visible = false;
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

  private beginPhysicsGrab(index: number, pointerId: number): void {
    const entry = this.physicsEntries.find(item => item.recordIndex === index);
    if (!entry) return;
    const worldPos = entry.mesh.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, entry.height / 2, 0));
    entry.body.type = CANNON.Body.KINEMATIC;
    entry.body.velocity.set(0, 0, 0);
    entry.body.angularVelocity.set(0, 0, 0);
    entry.body.wakeUp();
    this.physicsGrab = {
      pointerId,
      entry,
      distance: THREE.MathUtils.clamp(this.camera.position.distanceTo(worldPos), 2.5, 28),
      lastPoint: worldPos,
      lastAt: performance.now(),
      throwVelocity: new THREE.Vector3()
    };
  }

  private updatePhysicsGrab(): void {
    const grab = this.physicsGrab;
    if (!grab) return;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const target = this.raycaster.ray.origin.clone()
      .add(this.raycaster.ray.direction.clone().multiplyScalar(grab.distance));
    target.y = Math.max(grab.entry.height / 2 + .05, target.y);

    const now = performance.now();
    const dt = Math.max(.008, (now - grab.lastAt) / 1000);
    grab.throwVelocity.copy(target).sub(grab.lastPoint).multiplyScalar(1 / dt);
    if (grab.throwVelocity.length() > 11) grab.throwVelocity.setLength(11);
    grab.lastPoint.copy(target);
    grab.lastAt = now;

    grab.entry.body.position.set(target.x, target.y, target.z);
    grab.entry.body.velocity.set(0, 0, 0);
    grab.entry.body.angularVelocity.set(0, 0, 0);
  }

  private endPhysicsGrab(): void {
    const grab = this.physicsGrab;
    if (!grab) return;
    grab.entry.body.type = CANNON.Body.DYNAMIC;
    grab.entry.body.updateMassProperties();
    grab.entry.body.velocity.set(
      grab.throwVelocity.x * 1.08,
      grab.throwVelocity.y * 1.08,
      grab.throwVelocity.z * 1.08
    );
    grab.entry.body.angularVelocity.set(
      grab.throwVelocity.z * .16,
      grab.throwVelocity.x * .10,
      -grab.throwVelocity.x * .16
    );
    grab.entry.body.wakeUp();
    this.physicsGrab = undefined;
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
      x: Number(r.x), y: Number(r.y), z: Number(r.z),
      hingeAngle: Number.isFinite(Number(r.hingeAngle)) ? Number(r.hingeAngle) : undefined,
      programMode: ['manual', 'cruise', 'patrol', 'spin'].includes(String(r.programMode))
        ? r.programMode as ProgramMode
        : undefined,
      programSteps: Array.isArray(r.programSteps)
        ? r.programSteps.filter((command): command is ProgramCommand =>
            ['motorOn','motorOff','forward','reverse','left','right','wait','hingeOpen','hingeClose'].includes(String(command))
          ).slice(0, 16)
        : undefined
    }));
    this.selectedIds.clear();
    this.ghostPointerReady = false;
    this.ghost.visible = false;
    this.rebuildAll();
    this.updateRenderQuality();
    this.notify();
  }

  private updateRenderQuality(): void {
    const dpr = window.devicePixelRatio || 1;
    const cap = this.records.length > 180 ? 1.25 : this.records.length > 100 ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(dpr, cap));
    this.resize();
  }

  private rebuildGhost(): void {
    this.scene.remove(this.ghost);
    this.ghost = createPart(this.selected, 0.46);
    this.ghost.visible = false;
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
    if (!this.ghostPointerReady || this.mode !== 'build' || this.physicsActive) {
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
    this.instructionGhost = createPart(step.record, .36);
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
    this.instructionGhost.userData.pulseStartedAt = performance.now();
  }

  private removeInstructionGhost(): void {
    if (!this.instructionGhost) return;
    this.scene.remove(this.instructionGhost);
    this.instructionGhost = undefined;
  }

  private startCollapse(): void {
    if (!this.records.length || this.mode === 'instruction' || this.driveActive) return;
    this.physicsSnapshot = this.snapshot();
    this.selectedIds.clear();
    this.refreshSelectionVisual();
    this.ghostPointerReady = false;
    this.ghost.visible = false;

    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    world.allowSleep = true;
    world.defaultContactMaterial.friction = .42;
    world.defaultContactMaterial.restitution = .08;

    const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    groundBody.position.y = -.02;
    groundBody.aabbNeedsUpdate = true;
    groundBody.updateAABB();
    world.addBody(groundBody);

    // Large dioramas can contain hundreds of render pieces. Simulating every
    // piece as a rigid body overwhelms mobile browsers, so keep the structural
    // core static and simulate the most visually important upper/special parts.
    const maxBodies = 96;
    const ranked = this.records.map((record, index) => ({
      index,
      score:
        (record.kind === 'brick' ? 0 : 120) +
        record.y * 24 +
        (((index * 37) % 29) / 29)
    }));
    const activeIndices = new Set(
      (this.records.length <= maxBodies ? ranked : ranked.sort((a, b) => b.score - a.score).slice(0, maxBodies))
        .map(item => item.index)
    );

    this.physicsEntries = [];
    const entryByRecord = new Map<number, PhysicsEntry>();

    this.records.forEach((record, index) => {
      if (!activeIndices.has(index)) return;

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
        linearDamping: record.kind === 'hinge' ? .16 : .08,
        angularDamping: record.kind === 'hinge' ? .22 : .08,
        allowSleep: true
      });
      const outward = Math.hypot(record.x, record.z) || 1;
      const heightBias = 0.2 + Math.min(1.4, record.y * .18);
      body.velocity.set(
        record.x / outward * (.42 + heightBias) + (Math.random() - .5) * .55,
        .35 + Math.random() * .45,
        record.z / outward * (.42 + heightBias) + (Math.random() - .5) * .55
      );
      body.angularVelocity.set(
        (Math.random() - .5) * 1.15,
        (Math.random() - .5) * .7,
        (Math.random() - .5) * 1.15
      );
      world.addBody(body);

      const mesh = this.brickLayer.children[index] as THREE.Group;
      const entry: PhysicsEntry = { recordIndex: index, body, mesh, height: h };
      this.physicsEntries.push(entry);
      entryByRecord.set(index, entry);
    });

    this.records.forEach((record, index) => {
      if (record.kind !== 'hinge') return;
      const hingeEntry = entryByRecord.get(index);
      if (!hingeEntry) return;

      let supportIndex = -1;
      let best = Number.POSITIVE_INFINITY;
      this.records.forEach((other, otherIndex) => {
        if (otherIndex === index || other.y > record.y + .08 || !entryByRecord.has(otherIndex)) return;
        const dx = other.x - record.x;
        const dz = other.z - record.z;
        const dy = Math.max(0, record.y - (other.y + partHeight(other)));
        const score = dx * dx + dz * dz + dy * dy * 3;
        if (score < best && score < 4.2) {
          best = score;
          supportIndex = otherIndex;
        }
      });

      if (supportIndex < 0) return;
      const supportEntry = entryByRecord.get(supportIndex);
      if (!supportEntry) return;

      const f = footprint(record);
      const edge = (record.rotation ? f.w : f.d) * STUD * .32;
      const hingePoint = new CANNON.Vec3(
        hingeEntry.body.position.x,
        record.y + BODY_H * .58,
        hingeEntry.body.position.z - (record.rotation ? 0 : edge)
      );
      if (record.rotation) hingePoint.x -= edge;

      const pivotA = hingePoint.vsub(supportEntry.body.position);
      const pivotB = hingePoint.vsub(hingeEntry.body.position);
      const axis = record.rotation
        ? new CANNON.Vec3(0, 0, 1)
        : new CANNON.Vec3(1, 0, 0);

      world.addConstraint(new CANNON.HingeConstraint(
        supportEntry.body,
        hingeEntry.body,
        {
          pivotA,
          axisA: axis,
          pivotB,
          axisB: axis,
          collideConnected: false
        }
      ));
    });

    this.physicsWorld = world;
    this.notify();
  }

  private restoreCollapse(): void {
    if (this.physicsGrab) this.endPhysicsGrab();
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

  private buildDriveTerrain(world: CANNON.World): void {
    this.driveTerrain.clear();
    this.driveTerrain.visible = true;

    const material = new THREE.MeshStandardMaterial({
      color: 0x9aabc0,
      roughness: .82,
      metalness: .02
    });
    const bumps = [
      { x: -3.0, z: -4.0, sx: 2.8, sy: .18, sz: .75, r: .04 },
      { x:  2.6, z: -1.2, sx: 1.1, sy: .28, sz: 2.4, r: -.05 },
      { x: -1.2, z:  3.4, sx: 3.2, sy: .13, sz: .65, r: .02 },
      { x:  4.3, z:  4.8, sx: 1.5, sy: .22, sz: 1.5, r: 0 }
    ];

    for (const bump of bumps) {
      const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(bump.sx / 2, bump.sy / 2, bump.sz / 2))
      });
      body.position.set(bump.x, bump.sy / 2, bump.z);
      body.quaternion.setFromEuler(0, 0, bump.r);
      body.aabbNeedsUpdate = true;
      body.updateAABB();
      world.addBody(body);

      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(bump.sx, bump.sy, bump.sz),
        material
      );
      mesh.position.set(bump.x, bump.sy / 2, bump.z);
      mesh.rotation.z = bump.r;
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.driveTerrain.add(mesh);
    }
  }

  private computeGearDirections(): Map<number, number> {
    const map = new Map<number, number>();
    const gearIds = this.records
      .map((record, index) => record.kind === 'gear' ? index : -1)
      .filter(index => index >= 0);

    const adjacent = (aId: number, bId: number): boolean => {
      const a = this.records[aId];
      const b = this.records[bId];
      const distance = Math.hypot(a.x - b.x, a.z - b.z);
      return Math.abs(a.y - b.y) <= BODY_H * .8 &&
        distance >= STUD * .65 &&
        distance <= STUD * 2.12;
    };

    for (const root of gearIds) {
      if (map.has(root)) continue;
      map.set(root, 1);
      const queue = [root];
      while (queue.length) {
        const current = queue.shift()!;
        const direction = map.get(current) ?? 1;
        for (const candidate of gearIds) {
          if (candidate === current || !adjacent(current, candidate)) continue;
          if (!map.has(candidate)) {
            map.set(candidate, -direction);
            queue.push(candidate);
          }
        }
      }
    }
    return map;
  }

  private updateProgramSequence(delta: number): {
    throttle: number;
    steer: number;
    motorEnabled: boolean;
    hingeTarget: number | null;
  } {
    const steps = this.programSteps;
    const runtime = this.driveProgramRuntime;
    if (!steps.length) {
      return {
        throttle: this.driveThrottle,
        steer: this.driveSteer,
        motorEnabled: true,
        hingeTarget: null
      };
    }

    const command = steps[runtime.index % steps.length];
    runtime.elapsed += delta;

    let duration = .75;
    let throttle = 0;
    let steer = 0;

    switch (command) {
      case 'motorOn':
        runtime.motorEnabled = true;
        duration = .20;
        break;
      case 'motorOff':
        runtime.motorEnabled = false;
        duration = .20;
        break;
      case 'forward':
        throttle = .78;
        duration = 1.15;
        break;
      case 'reverse':
        throttle = -.62;
        duration = .95;
        break;
      case 'left':
        throttle = .48;
        steer = -.82;
        duration = .82;
        break;
      case 'right':
        throttle = .48;
        steer = .82;
        duration = .82;
        break;
      case 'wait':
        duration = .72;
        break;
      case 'hingeOpen':
        runtime.hingeTarget = 95;
        duration = .55;
        break;
      case 'hingeClose':
        runtime.hingeTarget = 12;
        duration = .55;
        break;
    }

    if (runtime.elapsed >= duration) {
      runtime.elapsed = 0;
      runtime.index = (runtime.index + 1) % steps.length;
      this.notify();
    }

    return {
      throttle,
      steer,
      motorEnabled: runtime.motorEnabled,
      hingeTarget: runtime.hingeTarget
    };
  }

  private updateDrive(delta: number): void {
    const world = this.driveWorld;
    const body = this.driveBody;
    const vehicle = this.driveVehicle;
    if (!this.driveActiveState || !world || !body || !vehicle) return;

    this.driveProgramElapsed += delta;

    let throttle = this.driveThrottle;
    let steer = this.driveSteer;
    let motorEnabled = true;
    let hingeTarget: number | null = null;

    if (this.programSteps.length) {
      const program = this.updateProgramSequence(delta);
      throttle = program.throttle;
      steer = program.steer;
      motorEnabled = program.motorEnabled;
      hingeTarget = program.hingeTarget;
    } else if (this.programCount > 0) {
      switch (this.programMode) {
        case 'cruise':
          throttle = .72;
          steer = Math.sin(this.driveProgramElapsed * .55) * .12;
          break;
        case 'patrol':
          throttle = .62;
          steer = Math.sin(this.driveProgramElapsed * 1.05) * .72;
          break;
        case 'spin':
          throttle = .24;
          steer = 1;
          break;
      }
    }

    const motorBoost = motorEnabled ? 1 + this.motorCount * .42 : .18;
    const propellerBoost = this.propellerCount * .34;
    const gearRatio = 1 + Math.min(4, this.gearCount) * .10 + Math.min(4, this.meshedGearPairs) * .12;
    const engineForce = throttle * 15.5 * (motorBoost + propellerBoost) * gearRatio;

    for (const visual of this.driveWheelVisuals) {
      vehicle.applyEngineForce(-engineForce, visual.wheelIndex);
      vehicle.setSteeringValue(visual.steering ? steer * .48 : 0, visual.wheelIndex);
      vehicle.setBrake(Math.abs(throttle) < .04 ? .42 : 0, visual.wheelIndex);
    }

    if (this.propellerCount > 0) {
      const forward = new CANNON.Vec3(0, 0, -1);
      body.quaternion.vmult(forward, forward);
      const propForce = throttle * this.propellerCount * 4.8 * (motorEnabled ? 1 : .2);
      body.applyForce(
        new CANNON.Vec3(forward.x * propForce, 0, forward.z * propForce),
        body.position
      );
    }

    world.step(1 / 60, Math.min(delta, .05), 5);

    const horizontalSpeed = Math.hypot(body.velocity.x, body.velocity.z);
    const topSpeed = 3.4 + this.motorCount * .52 + this.gearCount * .34 +
      this.meshedGearPairs * .26 + this.propellerCount * .62;
    if (horizontalSpeed > topSpeed) {
      const scale = topSpeed / horizontalSpeed;
      body.velocity.x *= scale;
      body.velocity.z *= scale;
    }

    this.brickLayer.position.set(body.position.x, body.position.y - this.driveVisualYOffset, body.position.z);
    this.brickLayer.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);

    for (const visual of this.driveWheelVisuals) {
      const info = vehicle.wheelInfos[visual.wheelIndex];
      if (!info) continue;
      const travel = info.suspensionLength - .44;
      visual.mesh.position.y = visual.baseY - travel;
      visual.mesh.rotation.y = Math.PI / 2 + (visual.steering ? info.steering : 0);
      visual.mesh.rotation.z = info.rotation;

      const side = Number(visual.mesh.userData.wheelSide ?? 1);
      const group = this.brickLayer.children[visual.recordIndex];
      group?.traverse(object => {
        if (Number(object.userData.wheelSide ?? 0) !== side) return;
        if (object.userData.partRole === 'suspension-shock') {
          object.scale.y = THREE.MathUtils.clamp(1 - travel * 1.75, .66, 1.34);
          object.position.y = BODY_H * .74 - travel * .35;
        } else if (object.userData.partRole === 'suspension-arm') {
          object.rotation.z = side * (-.18 + travel * .65);
        }
      });
    }

    const visualPower = throttle * (motorEnabled ? 1 : .16) *
      (1 + this.motorCount * .28 + this.propellerCount * .38);
    this.driveWheelSpin += visualPower * delta * 10.5;

    this.records.forEach((record, index) => {
      const group = this.brickLayer.children[index];
      if (!group) return;
      group.traverse(object => {
        const role = object.userData.partRole;
        if (record.kind === 'motor' && role === 'motor-rotor') {
          object.rotation.z = this.driveWheelSpin * 1.8;
        } else if (record.kind === 'gear' && role === 'gear-rotor') {
          object.rotation.y = this.driveWheelSpin * 1.35 * (this.gearDirections.get(index) ?? 1);
        } else if (record.kind === 'propeller' && role === 'propeller-rotor') {
          object.rotation.z = this.driveWheelSpin * 2.8;
        } else if (record.kind === 'program' && role === 'program-led') {
          const pulse = .85 + Math.sin(this.driveProgramElapsed * 9) * .15;
          object.scale.setScalar(pulse);
        } else if (record.kind === 'hinge' && role === 'hinge-flap' && hingeTarget !== null) {
          const target = -THREE.MathUtils.degToRad(hingeTarget);
          object.rotation.x = THREE.MathUtils.lerp(object.rotation.x, target, Math.min(1, delta * 5.5));
        }
      });
    });

    this.orbitTarget.x = body.position.x;
    this.orbitTarget.y = Math.max(.9, body.position.y - this.driveVisualYOffset + .85);
    this.orbitTarget.z = body.position.z;
    this.updateCamera();

    this.driveTelemetryElapsed += delta;
    if (this.driveTelemetryElapsed >= .25) {
      this.driveTelemetryElapsed = 0;
      this.notify();
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
    this.updateDrive(delta);
    if (this.instructionGhost) {
      const t = now * .006;
      const pulse = 1 + Math.sin(t) * .045;
      this.instructionGhost.scale.setScalar(pulse);
      this.instructionGhost.rotation.y = Math.sin(t * .35) * .035;
    }
    if (this.pointers.size === 0 && !this.physicsActive) this.updateGhost();
    this.renderer.render(this.scene, this.camera);
  };
}
