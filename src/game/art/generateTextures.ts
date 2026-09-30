import Phaser from 'phaser';

type Painter = (g: Phaser.GameObjects.Graphics) => void;

function texture(scene: Phaser.Scene, key: string, w: number, h: number, paint: Painter): void {
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics();
  paint(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

export function generateTextures(scene: Phaser.Scene): void {
  texture(scene, 'hero-idle', 36, 58, g => {
    g.fillStyle(0xdffcff).fillRect(10, 2, 16, 16);
    g.fillStyle(0x101a34).fillRect(7, 18, 22, 25);
    g.fillStyle(0xff3bd4).fillRect(5, 20, 5, 22);
    g.fillStyle(0x4ef7ff).fillRect(26, 20, 5, 22);
    g.fillStyle(0xc6d5ff).fillRect(8, 43, 7, 15).fillRect(21, 43, 7, 15);
    g.fillStyle(0x07111c).fillRect(13, 8, 10, 4);
    g.fillStyle(0x4ef7ff).fillRect(20, 8, 3, 4);
  });
  texture(scene, 'hero-run-a', 40, 58, g => {
    g.fillStyle(0xe8ffff).fillRect(11, 2, 16, 16);
    g.fillStyle(0x111b36).fillRect(8, 18, 22, 24);
    g.fillStyle(0xff3bd4).fillRect(6, 20, 5, 20);
    g.fillStyle(0x4ef7ff).fillRect(27, 20, 5, 20);
    g.fillStyle(0xc6d5ff).fillRect(4, 43, 12, 7).fillRect(24, 49, 12, 7);
    g.fillStyle(0x4ef7ff).fillRect(18, 8, 6, 4);
  });
  texture(scene, 'hero-run-b', 40, 58, g => {
    g.fillStyle(0xe8ffff).fillRect(11, 2, 16, 16);
    g.fillStyle(0x111b36).fillRect(8, 18, 22, 24);
    g.fillStyle(0xff3bd4).fillRect(6, 20, 5, 20);
    g.fillStyle(0x4ef7ff).fillRect(27, 20, 5, 20);
    g.fillStyle(0xc6d5ff).fillRect(6, 49, 12, 7).fillRect(24, 43, 12, 7);
    g.fillStyle(0x4ef7ff).fillRect(18, 8, 6, 4);
  });
  texture(scene, 'runner', 42, 44, g => {
    g.fillStyle(0x341738).fillRect(2, 4, 38, 36);
    g.fillStyle(0xff3bd4).fillRect(29, 12, 9, 5);
    g.fillStyle(0x7d2f80).fillTriangle(4, 40, 16, 40, 5, 44).fillTriangle(26, 40, 38, 40, 37, 44);
  });
  texture(scene, 'guard', 50, 58, g => {
    g.fillStyle(0x23304e).fillRect(5, 4, 40, 50);
    g.lineStyle(4, 0xff3bd4, .85).strokeRect(2, 1, 46, 56);
    g.fillStyle(0xffd35a).fillRect(31, 13, 11, 6);
  });
  texture(scene, 'drone', 46, 32, g => {
    g.fillStyle(0x51225c).fillTriangle(2, 16, 23, 2, 44, 16).fillTriangle(2, 16, 23, 30, 44, 16);
    g.fillStyle(0xff3bd4).fillRect(27, 13, 12, 6);
    g.fillStyle(0x4ef7ff, .7).fillCircle(10, 16, 4);
  });
  texture(scene, 'sniper', 48, 48, g => {
    g.fillStyle(0x282039).fillRect(3, 3, 42, 42);
    g.fillStyle(0xffd35a).fillRect(29, 12, 13, 5);
    g.lineStyle(2, 0xffd35a, .4).strokeCircle(24, 24, 18);
  });
  texture(scene, 'boss', 98, 116, g => {
    g.fillStyle(0x24102f).fillRect(12, 8, 74, 100);
    g.lineStyle(4, 0xff3bd4, .9).strokeRect(5, 4, 88, 108);
    g.fillStyle(0xff3bd4).fillRect(2, 25, 10, 63).fillRect(86, 25, 10, 63);
    g.fillStyle(0xffd35a).fillRect(58, 25, 21, 7);
    g.fillStyle(0x4ef7ff, .55).fillCircle(49, 70, 14);
  });
  texture(scene, 'platform', 64, 24, g => {
    g.fillStyle(0x0a1120).fillRect(0, 0, 64, 24);
    g.fillStyle(0x1b2a47).fillRect(0, 0, 64, 5);
    g.fillStyle(0x4ef7ff, .6).fillRect(0, 0, 64, 2);
    g.fillStyle(0xffffff, .05).fillRect(10, 13, 18, 2).fillRect(38, 13, 12, 2);
  });
  texture(scene, 'hazard', 40, 28, g => {
    g.fillStyle(0xff3b67).fillTriangle(0, 28, 10, 3, 20, 28).fillTriangle(16, 28, 27, 3, 40, 28);
  });
  texture(scene, 'shot', 18, 18, g => {
    g.fillStyle(0xff3bd4, .25).fillCircle(9, 9, 9);
    g.fillStyle(0xff77e2).fillCircle(9, 9, 5);
    g.fillStyle(0xffffff).fillCircle(9, 9, 2);
  });
  texture(scene, 'shard', 22, 22, g => {
    g.fillStyle(0x4ef7ff, .18).fillCircle(11, 11, 11);
    g.fillStyle(0x4ef7ff).fillTriangle(11, 1, 19, 11, 11, 21).fillTriangle(11, 1, 3, 11, 11, 21);
  });
  texture(scene, 'grid', 128, 128, g => {
    g.lineStyle(1, 0x4ef7ff, .12);
    g.strokeRect(0, 0, 128, 128);
    g.lineBetween(64, 0, 64, 128);
    g.lineBetween(0, 64, 128, 64);
  });
  texture(scene, 'skyline', 256, 256, g => {
    g.fillStyle(0x12213a, .6);
    g.fillRect(10, 120, 42, 136).fillRect(61, 72, 58, 184).fillRect(131, 142, 36, 114).fillRect(178, 92, 68, 164);
    g.fillStyle(0x4ef7ff, .10);
    for (let y = 92; y < 246; y += 24) {
      g.fillRect(73, y, 4, 8);
      g.fillRect(90, y, 4, 8);
      g.fillRect(198, y, 4, 8);
    }
  });

  scene.anims.create({
    key: 'hero-run',
    frames: [{ key: 'hero-run-a' }, { key: 'hero-run-b' }],
    frameRate: 10,
    repeat: -1
  });
}
