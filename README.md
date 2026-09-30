# BRICK//LAB

A browser-based 3D studded block building simulator rebuilt from scratch for `newgame2`.

## Build system

- Basic bricks: 1×1, 1×2, 1×3, 1×4, 2×2, 2×3, 2×4
- Special parts: slope, hinge, wheel module, window, roof
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

- Instruction mode with a step-by-step Mini Rover build
- Translucent next-part preview
- Back / Add Step / Keep Model / Exit controls

## Save system

- Three independent local save slots
- Piece-count status for every slot

## Physics

- Cannon-based collapse simulation
- Per-piece rigid bodies with gravity, friction and rotation
- RESTORE returns to the editable pre-collapse build

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
