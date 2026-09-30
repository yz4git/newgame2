import * as THREE from 'three';

export const STUD = 0.8;
export const BODY_H = 0.48;
export const STUD_H = 0.14;
export const STUD_R = 0.245;

export type PartKind = 'brick' | 'slope' | 'hinge' | 'wheel' | 'window' | 'roof';

export interface BrickSpec {
  kind: PartKind;
  w: number;
  d: number;
  color: number;
  rotation: 0 | 1;
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
    flap.rotation.x = -Math.PI * .19;
    flap.position.set(0, BODY_H * .83, f.d * STUD * .12);
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
    const wheelGeo = new THREE.TorusGeometry(.36, .14, 12, 24);
    for (const side of [-1, 1]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.y = Math.PI / 2;
      wheel.position.set(side * f.w * STUD * .56, BODY_H * .55, 0);
      wheel.castShadow = true;
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
  }

  return group;
}

export function cloneSpec(spec: BrickSpec): BrickSpec {
  return { kind: spec.kind, w: spec.w, d: spec.d, color: spec.color, rotation: spec.rotation };
}
