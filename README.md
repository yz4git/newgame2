# BRICK//LAB

A browser-based 3D studded block building simulator rebuilt from scratch for `newgame2`.

## Build system

- Basic bricks: 1×1, 1×2, 1×3, 1×4, 2×2, 2×3, 2×4
- Special parts: slope, hinge, wheel module, window, roof, motor, gear, propeller, program controller
- Eight colors
- Grid-snapped placement and vertical stacking
- 90° rotation
- Remove mode

## Advanced editing

- SELECT mode with multi-selection
- MOVE mode: grab and drag selected pieces across the baseplate
- Copy selected pieces
- Raise/lower selected pieces by one brick layer
- Select all / deselect all
- Undo / redo

## Guided building

- Instruction mode with Mini Rover, Micro House, Signal Tower and Power Buggy
- Translucent pulsing next-part preview
- Back / Add Step / Keep Model / Exit controls

## Save system

- Three independent local save slots
- Piece-count status for every slot

## Physics and motion

- Cannon-based collapse simulation
- Per-piece rigid bodies with gravity, friction and rotation
- Hinges form Cannon hinge constraints to nearby support pieces
- Grab and throw pieces while collapse simulation is running
- Physics-based DRIVE TEST uses Cannon RaycastVehicle suspension and arena walls
- Each wheel has independent suspension travel, contact state and visible shock/arm movement
- Drive-test terrain includes low bumps for suspension testing
- MOTOR increases thrust, meshed GEAR pairs rotate in opposite directions and alter performance, PROPELLER adds thrust
- PROGRAM controller supports Manual, Cruise, Patrol and Spin presets
- Visual Program command sequences can loop MOTOR ON/OFF, Forward/Reverse, Left/Right, Wait and Hinge Open/Close
- Active visual-program commands and suspension contact count are shown during DRIVE TEST
- RESTORE/RETURN returns to the editable pre-simulation build

## Mobile

- One-finger camera orbit
- Pinch zoom
- Tap placement / selection / removal
- iPhone Safari visualViewport + safe-area handling

## Web

- PWA support
- Build-ID cache busting for GitHub Pages
- `latest.html` cache/SW reset entry point

## Development

```bash
npm install
npm run dev
npm run build
```

Public path: `/newgame2/`
