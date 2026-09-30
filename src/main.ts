import Phaser from 'phaser';
import './style.css';
import { BootScene } from './game/scenes/BootScene';
import { GameScene } from './game/scenes/GameScene';
import { Hud } from './ui/Hud';
import { installFreshPagePolicy } from './pwa/FreshPage';

function syncViewportHeight(): void {
  const viewport = window.visualViewport;
  const height = Math.round(viewport?.height ?? window.innerHeight);
  const width = Math.round(viewport?.width ?? window.innerWidth);
  const top = Math.round(viewport?.offsetTop ?? 0);
  const left = Math.round(viewport?.offsetLeft ?? 0);
  document.documentElement.style.setProperty('--app-height', height + 'px');
  document.documentElement.style.setProperty('--app-width', width + 'px');
  document.documentElement.style.setProperty('--app-top', top + 'px');
  document.documentElement.style.setProperty('--app-left', left + 'px');
}

syncViewportHeight();
window.addEventListener('resize', syncViewportHeight, { passive: true });
window.addEventListener('orientationchange', () => window.setTimeout(syncViewportHeight, 120), { passive: true });
window.visualViewport?.addEventListener('resize', syncViewportHeight, { passive: true });
window.visualViewport?.addEventListener('scroll', syncViewportHeight, { passive: true });

const uiRoot = document.querySelector('#ui-root');
if (!(uiRoot instanceof HTMLElement)) throw new Error('Missing UI root');

new Hud(uiRoot);

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-root',
  width: 1280,
  height: 720,
  backgroundColor: '#050712',
  pixelArt: false,
  roundPixels: false,
  antialias: true,
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 1950 },
      debug: false,
      fps: 60,
      fixedStep: true
    }
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720
  },
  input: {
    gamepad: true,
    touch: true
  },
  scene: [BootScene, GameScene]
};

new Phaser.Game(config);


void installFreshPagePolicy();
