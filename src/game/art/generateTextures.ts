import Phaser from 'phaser';

type Painter = (g: Phaser.GameObjects.Graphics) => void;

function texture(scene: Phaser.Scene, key: string, w: number, h: number, paint: Painter): void {
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics();
  paint(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

function hero(g: Phaser.GameObjects.Graphics, pose: 0 | 1 | 2 | 3 | 4): void {
  const cyan = 0x4ef7ff;
  const mag = 0xff3bd4;
  g.fillStyle(0xe8ffff).fillRoundedRect(13, 2, 18, 17, 5);
  g.fillStyle(0x0a1225).fillRect(16, 9, 13, 4);
  g.fillStyle(cyan).fillRect(25, 9, 4, 4);
  g.fillStyle(0x152343).fillRoundedRect(10, 19, 27, 28, 4);
  g.fillStyle(mag).fillRect(8, 21, 5, 24);
  g.fillStyle(cyan).fillRect(35, 21, 5, 24);
  g.fillStyle(0xcbd9ff);

  if (pose === 1) {
    g.fillRect(4, 45, 17, 7).fillRect(28, 51, 16, 7);
  } else if (pose === 2) {
    g.fillRect(7, 51, 16, 7).fillRect(28, 44, 16, 7);
  } else if (pose === 3) {
    g.fillRect(3, 34, 19, 7).fillRect(24, 48, 17, 7);
    g.fillStyle(cyan).fillTriangle(34, 16, 62, 28, 35, 34);
  } else if (pose === 4) {
    g.fillRect(8, 48, 15, 7).fillRect(25, 43, 16, 7);
    g.fillStyle(mag).fillTriangle(35, 7, 69, 24, 35, 41);
  } else {
    g.fillRect(10, 47, 8, 15).fillRect(29, 47, 8, 15);
  }
}

export function generateTextures(scene: Phaser.Scene): void {
  texture(scene, 'hero-idle', 72, 64, g => hero(g, 0));
  texture(scene, 'hero-run-a', 72, 64, g => hero(g, 1));
  texture(scene, 'hero-run-b', 72, 64, g => hero(g, 2));
  texture(scene, 'hero-atk-1', 72, 64, g => hero(g, 3));
  texture(scene, 'hero-atk-2', 72, 64, g => {
    hero(g, 4);
    g.lineStyle(5, 0x4ef7ff, .7).beginPath().arc(37, 28, 29, -.9, .8).strokePath();
  });
  texture(scene, 'hero-atk-3', 88, 72, g => {
    hero(g, 3);
    g.lineStyle(6, 0xffd35a, .75).beginPath().arc(36, 34, 39, -1.05, .95).strokePath();
    g.fillStyle(0xffd35a, .25).fillCircle(55, 32, 12);
  });

  texture(scene, 'runner', 48, 48, g => {
    g.fillStyle(0x2b1437).fillRoundedRect(4, 8, 40, 34, 8);
    g.fillStyle(0xff3bd4).fillTriangle(0, 37, 13, 20, 13, 46).fillTriangle(48, 37, 35, 20, 35, 46);
    g.fillStyle(0xff8ae6).fillRect(30, 16, 11, 5);
  });
  texture(scene, 'guard', 58, 64, g => {
    g.fillStyle(0x1e2944).fillRoundedRect(8, 5, 42, 54, 7);
    g.lineStyle(4, 0xff3bd4, .9).strokeRoundedRect(5, 2, 48, 60, 9);
    g.fillStyle(0xffd35a).fillRect(35, 15, 12, 6);
    g.fillStyle(0x4ef7ff, .28).fillCircle(18, 34, 10);
  });
  texture(scene, 'drone', 54, 38, g => {
    g.fillStyle(0x442052).fillTriangle(2, 19, 27, 2, 52, 19).fillTriangle(2, 19, 27, 36, 52, 19);
    g.fillStyle(0xff3bd4).fillRect(32, 15, 14, 7);
    g.fillStyle(0x4ef7ff, .75).fillCircle(13, 19, 5);
    g.lineStyle(2, 0x4ef7ff, .32).strokeCircle(13, 19, 10);
  });
  texture(scene, 'sniper', 54, 54, g => {
    g.fillStyle(0x242033).fillRoundedRect(4, 4, 46, 46, 5);
    g.fillStyle(0xffd35a).fillRect(32, 14, 15, 5);
    g.lineStyle(2, 0xffd35a, .55).strokeCircle(27, 27, 20);
    g.lineBetween(6, 27, 48, 27).lineBetween(27, 6, 27, 48);
  });
  texture(scene, 'boss', 112, 128, g => {
    g.fillStyle(0x1f0e2d).fillRoundedRect(16, 8, 80, 110, 10);
    g.lineStyle(5, 0xff3bd4, .95).strokeRoundedRect(8, 4, 96, 118, 12);
    g.fillStyle(0xff3bd4).fillRect(2, 29, 14, 68).fillRect(96, 29, 14, 68);
    g.fillStyle(0xffd35a).fillRect(65, 25, 23, 8);
    g.fillStyle(0x4ef7ff, .25).fillCircle(56, 76, 23);
    g.lineStyle(4, 0x4ef7ff, .7).strokeCircle(56, 76, 18);
    g.fillStyle(0xffffff).fillCircle(56, 76, 5);
  });

  texture(scene, 'platform', 64, 24, g => {
    g.fillStyle(0x09101f).fillRect(0, 0, 64, 24);
    g.fillStyle(0x1b2a47).fillRect(0, 0, 64, 6);
    g.fillStyle(0x4ef7ff, .7).fillRect(0, 0, 64, 2);
    g.fillStyle(0xffffff, .05).fillRect(9, 13, 18, 2).fillRect(38, 13, 13, 2);
  });
  texture(scene, 'hazard', 40, 28, g => {
    g.fillStyle(0xff3b67).fillTriangle(0, 28, 10, 3, 20, 28).fillTriangle(16, 28, 27, 3, 40, 28);
  });
  texture(scene, 'jump-pad', 80, 20, g => {
    g.fillStyle(0x14243e).fillRoundedRect(0, 5, 80, 15, 4);
    g.fillStyle(0x4ef7ff).fillRect(8, 3, 64, 5);
    g.fillStyle(0xffd35a).fillTriangle(30, 13, 40, 5, 50, 13);
  });
  texture(scene, 'laser-post', 22, 76, g => {
    g.fillStyle(0x202b47).fillRoundedRect(2, 0, 18, 76, 4);
    g.fillStyle(0xff4d79).fillRect(7, 8, 8, 18);
    g.fillStyle(0x4ef7ff, .4).fillRect(8, 48, 6, 18);
  });
  texture(scene, 'shot', 18, 18, g => {
    g.fillStyle(0xff3bd4, .25).fillCircle(9, 9, 9);
    g.fillStyle(0xff77e2).fillCircle(9, 9, 5);
    g.fillStyle(0xffffff).fillCircle(9, 9, 2);
  });
  texture(scene, 'boss-shot', 26, 26, g => {
    g.fillStyle(0xffd35a, .18).fillCircle(13, 13, 13);
    g.lineStyle(3, 0xffd35a, .85).strokeCircle(13, 13, 9);
    g.fillStyle(0xff3bd4).fillCircle(13, 13, 4);
  });
  texture(scene, 'shard', 22, 22, g => {
    g.fillStyle(0x4ef7ff, .18).fillCircle(11, 11, 11);
    g.fillStyle(0x4ef7ff).fillTriangle(11, 1, 19, 11, 11, 21).fillTriangle(11, 1, 3, 11, 11, 21);
  });
  texture(scene, 'grid', 128, 128, g => {
    g.lineStyle(1, 0x4ef7ff, .12).strokeRect(0, 0, 128, 128);
    g.lineBetween(64, 0, 64, 128).lineBetween(0, 64, 128, 64);
  });
  texture(scene, 'far-city', 320, 256, g => {
    g.fillStyle(0x0c1830, .68);
    g.fillRect(4, 150, 45, 106).fillRect(55, 105, 54, 151).fillRect(118, 130, 38, 126).fillRect(164, 78, 66, 178).fillRect(240, 120, 73, 136);
    g.fillStyle(0x4ef7ff, .08);
    for (let x = 20; x < 310; x += 31) for (let y = 120; y < 245; y += 28) g.fillRect(x, y, 4, 8);
  });
  texture(scene, 'mid-city', 256, 256, g => {
    g.fillStyle(0x172542, .72);
    g.fillRect(8, 128, 36, 128).fillRect(52, 72, 62, 184).fillRect(126, 143, 35, 113).fillRect(174, 93, 72, 163);
    g.fillStyle(0xff3bd4, .09);
    for (let y = 103; y < 240; y += 24) g.fillRect(188, y, 5, 10);
  });
  texture(scene, 'cloud-band', 384, 96, g => {
    g.fillStyle(0x4ef7ff, .035);
    g.fillEllipse(60, 50, 120, 35).fillEllipse(165, 35, 150, 42).fillEllipse(290, 56, 170, 36);
  });

  scene.anims.create({
    key: 'hero-run',
    frames: [{ key: 'hero-run-a' }, { key: 'hero-run-b' }],
    frameRate: 12,
    repeat: -1
  });
}
