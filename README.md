# RIFT//STUDIO

A browser-native 2D action game rebuilt from scratch as a compact Game Studio-style showcase.

## Stack

- Vite + TypeScript
- Phaser 3 / Arcade Physics
- DOM-based HUD and touch controls
- Procedural runtime sprite pipeline
- Web Audio synthesis
- Serializable checkpoint state
- PWA / offline cache
- GitHub Pages deployment

## Play

Keyboard:
- A / D or arrow keys: move
- Space / W: jump
- J: attack
- K: dash
- L: parry
- U: overdrive
- Esc: pause

Gamepad:
- Left stick / D-pad: move
- A: jump
- X: attack
- B: dash
- Y: parry
- RB: overdrive

Touch controls appear automatically on coarse-pointer devices.

## Showcase structure

1. **Flow Lab** — movement, coyote time, jump buffering, wall movement, hazards.
2. **Combat Grid** — enemy archetypes, combo chain, knockback, hit stop.
3. **Reflex Tunnel** — projectiles, timed parry, slow-motion feedback.
4. **Core Chamber** — multi-phase boss and overdrive payoff.

The lower HUD acts as a live “tech feed,” naming the system currently being demonstrated.

## Development

```bash
npm install
npm run dev
npm run build
```

GitHub Pages is built from `dist/` by `.github/workflows/pages.yml`.
