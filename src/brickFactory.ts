import * as THREE from 'three';

export const STUD = 0.8;
export const BODY_H = 0.48;
export const STUD_H = 0.14;
export const STUD_R = 0.245;

export interface BrickSpec {
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
    roughness: 0.38,
    metalness: 0.02,
    transparent: opacity < 1,
    opacity
  });
}

export function footprint(spec: BrickSpec): { w: number; d: number } {
  return spec.rotation ? { w: spec.d, d: spec.w } : { w: spec.w, d: spec.d };
}

export function createBrick(spec: BrickSpec, opacity = 1): THREE.Group {
  const group = new THREE.Group();
  group.userData.kind = 'brick';
  group.userData.spec = { ...spec };

  const f = footprint(spec);
  const mat = material(spec.color, opacity);

  const body = new THREE.Mesh(bodyGeometry, mat);
  body.scale.set(f.w * STUD - 0.055, 1, f.d * STUD - 0.055);
  body.position.y = BODY_H / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  body.userData.brickRoot = group;
  group.add(body);

  for (let ix = 0; ix < f.w; ix++) {
    for (let iz = 0; iz < f.d; iz++) {
      const stud = new THREE.Mesh(studGeometry, mat);
      stud.position.set(
        (ix - (f.w - 1) / 2) * STUD,
        BODY_H + STUD_H / 2 - 0.005,
        (iz - (f.d - 1) / 2) * STUD
      );
      stud.castShadow = true;
      stud.userData.brickRoot = group;
      group.add(stud);
    }
  }

  return group;
}

export function cloneSpec(spec: BrickSpec): BrickSpec {
  return { w: spec.w, d: spec.d, color: spec.color, rotation: spec.rotation };
}
