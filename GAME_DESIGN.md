# NEON RIFT — Game Design / Promo Structure

## Pitch

A 2–4 minute browser-native 2D action showcase. The player runs through four short sectors, and each sector deliberately spotlights a different part of the game feel / browser stack before a multi-phase boss.

## Player verbs

- Run with acceleration and air control
- Buffered jump + coyote time
- Double jump
- Wall slide / wall jump
- Air/ground dash with invulnerability frames
- Three-step melee combo
- Timed parry
- Overdrive earned through successful combat

## Showcase flow

1. **Flow Lab** — movement readability, parallax, responsive input, wall geometry.
2. **Combat Grid** — cancel-friendly three-hit combo, hit-stop, knockback, combo score.
3. **Reflex Tunnel** — ranged threats, parry window, time dilation, damage numbers.
4. **Core Chamber** — boss phase changes, denser projectiles, overdrive payoff.

## Presentation systems

- Fixed 60 Hz simulation
- Canvas 2D procedural rendering
- Camera smoothing and impact shake
- Particles, trails, flashes, floating combat text
- Reactive HUD and feature callout feed
- Procedural Web Audio SFX + beat pulse
- Local best score
- Reduced-motion support
- Keyboard, touch, and gamepad input
- iPhone landscape layout with safe-area handling
- PWA manifest + service worker cache
- GitHub Pages deployment workflow

## Promo principle

The player should not read a feature list first. Each feature should be demonstrated by an interaction, then named briefly in the bottom “tech feed” as it happens.
