# RIFT//STUDIO — Design Brief

## Goal

Make the game itself the product demo. The player should experience each capability before the HUD names it.

## Design pillars

### 1. Feel first
Movement uses acceleration, air control, jump buffering and coyote time. Combat adds hit-stop, camera shake, knockback and high-contrast impact effects.

### 2. Browser-native
Keyboard, gamepad and multi-touch are first-class. The layout respects iPhone safe areas and prevents page zoom/scroll interference.

### 3. Systems are visible
The bottom tech feed calls out important implementation ideas during play: physics, state serialization, combat cancel chains, parry time dilation and boss phases.

### 4. Architecture stays editable
Phaser scenes, input, audio, UI, persistent state and procedural art generation are separated so each can be iterated independently.

## Promo route

- **Sector 01: Flow Lab** teaches movement and platform traversal.
- **Sector 02: Combat Grid** introduces multiple enemy behaviors.
- **Sector 03: Reflex Tunnel** pushes ranged attacks and parry timing.
- **Sector 04: Core Chamber** combines the systems in a multi-phase boss fight.

## Feature matrix

| Area | Demonstrated capability |
| --- | --- |
| Framework | Phaser 3 + TypeScript + Vite |
| Physics | Arcade Physics, static geometry, hazards, projectiles |
| Movement | Coyote time, jump buffer, wall jump, dash |
| Combat | 3-step chain, knockback, hit-stop, invulnerability |
| Defense | Parry window, stun, time dilation |
| AI | Runner, guard, drone, sniper, 3-phase boss |
| Rendering | Parallax tile layers, camera follow, tint/flash, procedural textures |
| FX | Runtime particles, trails, floating damage text |
| Audio | Procedural Web Audio SFX and music pulse |
| UI | DOM HUD, pause/result/title panels |
| Input | Keyboard, touch, gamepad |
| State | Local checkpoint serialization and best score |
| Web | Responsive scaling, safe-area support, PWA, service worker |
| Deploy | Automated GitHub Pages build |
