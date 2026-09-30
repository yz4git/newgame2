import * as THREE from 'three';

export const STUD = 0.8;
export const BODY_H = 0.48;
export const STUD_H = 0.14;
export const STUD_R = 0.245;

export type ProgramMode = 'manual' | 'cruise' | 'patrol' | 'spin';
export type ProgramCommand =
  | 'motorOn' | 'motorOff'
  | 'forward' | 'reverse'
  | 'left' | 'right' | 'wait'
  | 'hingeOpen' | 'hingeClose';
export type PartKind = 'brick' | 'slope' | 'hinge' | 'wheel' | 'window' | 'roof' | 'motor' | 'gear' | 'propeller' | 'program';

export interface BrickSpec {
  kind: PartKind;
  w: number;
  d: number;
  color: number;
  rotation: 0 | 1;
  hingeAngle?: number;
  programMode?: ProgramMode;
  programSteps?: ProgramCommand[];
}

const bodyGeometry = new THREE.BoxGeometry(1, BODY_H, 1);
const studGeometry = new THREE.CylinderGeometry(STUD_R, STUD_R, STUD_H, 24);

function material(color: number, opacity = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.36,
    metalness: 0.02,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1
  });
}

function glassMaterial(opacity = 1): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0x7ec9ef,
    roughness: 0.08,
    metalness: 0,
    transmission: opacity >= 1 ? 0.55 : 0,
    transparent: true,
    opacity: Math.min(.58, opacity),
    depthWrite: false
  });
}

function tag(group: THREE.Group, object: THREE.Object3D): void {
  object.userData.brickRoot = group;
}

function addStuds(group: THREE.Group, spec: BrickSpec, mat: THREE.Material, y = BODY_H): void {
  const f = footprint(spec);
  for (let ix = 0; ix < f.w; ix++) {
    for (let iz = 0; iz < f.d; iz++) {
      const stud = new THREE.Mesh(studGeometry, mat);
      stud.position.set(
        (ix - (f.w - 1) / 2) * STUD,
        y + STUD_H / 2 - 0.005,
        (iz - (f.d - 1) / 2) * STUD
      );
      stud.castShadow = true;
      tag(group, stud);
      group.add(stud);
    }
  }
}

function addBody(group: THREE.Group, spec: BrickSpec, mat: THREE.Material, h = BODY_H): THREE.Mesh {
  const f = footprint(spec);
  const body = new THREE.Mesh(bodyGeometry, mat);
  body.scale.set(f.w * STUD - 0.055, h / BODY_H, f.d * STUD - 0.055);
  body.position.y = h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  tag(group, body);
  group.add(body);
  return body;
}

function createSlopeGeometry(width: number, depth: number, height: number): THREE.BufferGeometry {
  const x = width / 2;
  const z = depth / 2;
  const vertices = new Float32Array([
    -x,0,-z,  x,0,-z,  x,0,z,
    -x,0,-z,  x,0,z, -x,0,z,
    -x,0,-z,  x,0,-z,  x,height,z,
    -x,0,-z,  x,height,z, -x,height,z,
    -x,0,-z, -x,0,z, -x,height,z,
     x,0,-z,  x,height,z, x,0,z,
    -x,0,z,   x,0,z,     x,height,z,
    -x,0,z,   x,height,z,-x,height,z
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function footprint(spec: BrickSpec): { w: number; d: number } {
  return spec.rotation ? { w: spec.d, d: spec.w } : { w: spec.w, d: spec.d };
}

export function partHeight(spec: BrickSpec): number {
  switch (spec.kind) {
    case 'slope': return BODY_H * 1.8;
    case 'hinge': return BODY_H * 1.25;
    case 'wheel': return BODY_H * 1.35;
    case 'window': return BODY_H * 2.8;
    case 'roof': return BODY_H * 2.15;
    case 'motor': return BODY_H * 1.35;
    case 'gear': return BODY_H * 1.15;
    case 'propeller': return BODY_H * 1.7;
    case 'program': return BODY_H * 1.55;
    default: return BODY_H;
  }
}

export function createPart(spec: BrickSpec, opacity = 1): THREE.Group {
  const group = new THREE.Group();
  group.userData.kind = 'part';
  group.userData.spec = cloneSpec(spec);

  const f = footprint(spec);
  const mat = material(spec.color, opacity);

  if (spec.kind === 'brick') {
    addBody(group, spec, mat);
    addStuds(group, spec, mat);
  } else if (spec.kind === 'slope') {
    const h = partHeight(spec);
    const geometry = createSlopeGeometry(f.w * STUD - .055, f.d * STUD - .055, h);
    const wedge = new THREE.Mesh(geometry, mat);
    wedge.castShadow = true;
    wedge.receiveShadow = true;
    tag(group, wedge);
    group.add(wedge);
    for (let ix = 0; ix < f.w; ix++) {
      const stud = new THREE.Mesh(studGeometry, mat);
      stud.position.set((ix - (f.w - 1) / 2) * STUD, h + STUD_H / 2 - .005, (f.d - 1) * STUD / 2);
      stud.castShadow = true;
      tag(group, stud);
      group.add(stud);
    }
  } else if (spec.kind === 'hinge') {
    addBody(group, spec, mat, BODY_H * .48);
    const barrelGeo = new THREE.CylinderGeometry(.18, .18, f.w * STUD * .82, 20);
    const barrel = new THREE.Mesh(barrelGeo, mat);
    barrel.rotation.z = Math.PI / 2;
    barrel.position.set(0, BODY_H * .57, -f.d * STUD * .28);
    barrel.castShadow = true;
    tag(group, barrel);
    group.add(barrel);

    const flap = new THREE.Mesh(new THREE.BoxGeometry(f.w * STUD * .9, BODY_H * .22, f.d * STUD * .62), mat);
    const hingeAngle = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(spec.hingeAngle ?? 35, 0, 110));
    flap.rotation.x = -hingeAngle;
    flap.position.set(0, BODY_H * .83, f.d * STUD * .12);
    flap.userData.partRole = 'hinge-flap';
    flap.castShadow = true;
    tag(group, flap);
    group.add(flap);
  } else if (spec.kind === 'wheel') {
    addBody(group, spec, mat, BODY_H * .42);
    const axleMat = material(0x555b63, opacity);
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(.105, .105, f.w * STUD * 1.18, 16), axleMat);
    axle.rotation.z = Math.PI / 2;
    axle.position.y = BODY_H * .55;
    tag(group, axle);
    group.add(axle);

    const wheelMat = material(0x22252a, opacity);
    const shockMat = material(0xc8d2df, opacity);
    const armMat = material(0x596474, opacity);
    const wheelGeo = new THREE.TorusGeometry(.36, .14, 12, 24);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(.46, .09, .13), armMat);
      arm.position.set(side * f.w * STUD * .36, BODY_H * .54, 0);
      arm.rotation.z = side * -.18;
      arm.userData.partRole = 'suspension-arm';
      arm.userData.wheelSide = side;
      tag(group, arm);
      group.add(arm);

      const shock = new THREE.Mesh(new THREE.CylinderGeometry(.055, .055, .42, 12), shockMat);
      shock.position.set(side * f.w * STUD * .35, BODY_H * .74, 0);
      shock.rotation.z = side * .22;
      shock.userData.partRole = 'suspension-shock';
      shock.userData.wheelSide = side;
      tag(group, shock);
      group.add(shock);

      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.y = Math.PI / 2;
      wheel.position.set(side * f.w * STUD * .56, BODY_H * .55, 0);
      wheel.castShadow = true;
      wheel.userData.partRole = 'wheel';
      wheel.userData.wheelSide = side;
      tag(group, wheel);
      group.add(wheel);
    }
  } else if (spec.kind === 'window') {
    addBody(group, spec, mat, BODY_H * .42);
    const h = partHeight(spec);
    const frameT = .13;
    const width = f.w * STUD * .88;
    const depth = f.d * STUD * .42;
    const frameGeo = new THREE.BoxGeometry(frameT, h - BODY_H * .55, depth);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(frameGeo, mat);
      post.position.set(side * (width / 2 - frameT / 2), BODY_H * .45 + (h - BODY_H * .55) / 2, 0);
      post.castShadow = true;
      tag(group, post);
      group.add(post);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(width, frameT, depth), mat);
    top.position.set(0, h - frameT / 2, 0);
    tag(group, top);
    group.add(top);

    const glass = new THREE.Mesh(new THREE.BoxGeometry(width - frameT * 2, h - BODY_H * .8, .055), glassMaterial(opacity));
    glass.position.set(0, BODY_H * .56 + (h - BODY_H * .8) / 2, 0);
    tag(group, glass);
    group.add(glass);
  } else if (spec.kind === 'roof') {
    addBody(group, spec, mat, BODY_H * .34);
    const roofMat = material(spec.color, opacity);
    const width = f.w * STUD * .96;
    const depth = f.d * STUD * .72;
    const panelGeo = new THREE.BoxGeometry(width, .12, depth);
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(panelGeo, roofMat);
      panel.rotation.x = side * Math.PI * .22;
      panel.position.set(0, BODY_H * .82, side * depth * .31);
      panel.castShadow = true;
      tag(group, panel);
      group.add(panel);
    }
    const ridge = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, width, 12), roofMat);
    ridge.rotation.z = Math.PI / 2;
    ridge.position.y = partHeight(spec) - .12;
    tag(group, ridge);
    group.add(ridge);
  } else if (spec.kind === 'motor') {
    addBody(group, spec, mat, BODY_H * .44);
    const motorMat = material(0x3d4654, opacity);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(.29, .29, f.d * STUD * .72, 24), motorMat);
    motor.rotation.x = Math.PI / 2;
    motor.position.y = BODY_H * .82;
    motor.castShadow = true;
    motor.userData.partRole = 'motor-rotor';
    tag(group, motor);
    group.add(motor);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(.15, .15, .28, 18), material(0xf1c232, opacity));
    cap.rotation.z = Math.PI / 2;
    cap.position.set(f.w * STUD * .34, BODY_H * .82, 0);
    cap.userData.partRole = 'motor-rotor';
    tag(group, cap);
    group.add(cap);
  } else if (spec.kind === 'gear') {
    addBody(group, spec, mat, BODY_H * .34);
    const gearMat = material(0xd8a925, opacity);
    const gear = new THREE.Mesh(new THREE.TorusGeometry(.38, .12, 10, 24), gearMat);
    gear.rotation.x = Math.PI / 2;
    gear.position.y = BODY_H * .70;
    gear.castShadow = true;
    gear.userData.partRole = 'gear';
    tag(group, gear);
    group.add(gear);
    for (let i = 0; i < 10; i++) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(.13, .12, .20), gearMat);
      const a = i / 10 * Math.PI * 2;
      tooth.position.set(Math.cos(a) * .48, BODY_H * .70, Math.sin(a) * .48);
      tooth.rotation.y = -a;
      tooth.userData.partRole = 'gear';
      tag(group, tooth);
      group.add(tooth);
    }
  } else if (spec.kind === 'propeller') {
    addBody(group, spec, mat, BODY_H * .32);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, .28, 18), material(0x555b63, opacity));
    hub.rotation.x = Math.PI / 2;
    hub.position.y = BODY_H * .74;
    hub.userData.partRole = 'propeller';
    tag(group, hub);
    group.add(hub);

    const rotor = new THREE.Group();
    rotor.position.set(0, BODY_H * .74, f.d * STUD * .32);
    rotor.userData.partRole = 'propeller-rotor';
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(.13, .72, .055), material(spec.color, opacity));
      blade.position.y = .34;
      blade.rotation.z = i * Math.PI * 2 / 3;
      blade.castShadow = true;
      tag(group, blade);
      rotor.add(blade);
    }
    tag(group, rotor);
    group.add(rotor);
  } else if (spec.kind === 'program') {
    addBody(group, spec, material(0x2e3745, opacity), BODY_H * 1.05);
    const screen = new THREE.Mesh(
      new THREE.BoxGeometry(f.w * STUD * .62, BODY_H * .42, .045),
      new THREE.MeshStandardMaterial({
        color: 0x6ee7ff,
        emissive: 0x1f9db7,
        emissiveIntensity: opacity >= 1 ? .7 : .25,
        roughness: .28,
        transparent: opacity < 1,
        opacity
      })
    );
    screen.position.set(0, BODY_H * .76, f.d * STUD * .5 - .015);
    screen.userData.partRole = 'program-screen';
    tag(group, screen);
    group.add(screen);

    const led = new THREE.Mesh(new THREE.SphereGeometry(.07, 12, 8), material(0x5cff86, opacity));
    led.position.set(f.w * STUD * .28, BODY_H * 1.07, f.d * STUD * .5 - .01);
    led.userData.partRole = 'program-led';
    tag(group, led);
    group.add(led);
  }

  return group;
}

export function cloneSpec(spec: BrickSpec): BrickSpec {
  return {
    kind: spec.kind,
    w: spec.w,
    d: spec.d,
    color: spec.color,
    rotation: spec.rotation,
    hingeAngle: spec.hingeAngle,
    programMode: spec.programMode,
    programSteps: spec.programSteps ? [...spec.programSteps] : undefined
  };
}
