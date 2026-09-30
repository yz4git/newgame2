import Phaser from 'phaser';

export type Action = 'left' | 'right' | 'jump' | 'attack' | 'dash' | 'parry' | 'overdrive';

type ButtonState = Record<Action, boolean>;

const blank = (): ButtonState => ({
  left: false, right: false, jump: false, attack: false,
  dash: false, parry: false, overdrive: false
});

export class InputSystem {
  private keys: Record<string, Phaser.Input.Keyboard.Key>;
  private virtual = blank();
  private now = blank();
  private prev = blank();
  private latchedPress = blank();
  private virtualAxisX = 0;

  constructor(private scene: Phaser.Scene) {
    const kb = scene.input.keyboard;
    if (!kb) throw new Error('Keyboard input unavailable');
    this.keys = kb.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      left2: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right2: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      jump: Phaser.Input.Keyboard.KeyCodes.SPACE,
      jump2: Phaser.Input.Keyboard.KeyCodes.W,
      attack: Phaser.Input.Keyboard.KeyCodes.J,
      dash: Phaser.Input.Keyboard.KeyCodes.K,
      parry: Phaser.Input.Keyboard.KeyCodes.L,
      overdrive: Phaser.Input.Keyboard.KeyCodes.U
    }) as Record<string, Phaser.Input.Keyboard.Key>;
  }

  setVirtual(action: Action, down: boolean): void {
    if (down && !this.virtual[action]) this.latchedPress[action] = true;
    this.virtual[action] = down;
  }

  setVirtualAxis(x: number): void {
    this.virtualAxisX = Phaser.Math.Clamp(x, -1, 1);
  }

  horizontal(): number {
    if (Math.abs(this.virtualAxisX) > 0.08) return this.virtualAxisX;
    if (this.now.left === this.now.right) return 0;
    return this.now.left ? -1 : 1;
  }

  update(): void {
    this.prev = { ...this.now };
    const pads = this.scene.input.gamepad;
    const pad = pads?.total ? pads.getPad(0) : undefined;
    const axisX = pad?.axes?.length ? pad.axes[0].getValue() : 0;

    this.now.left = this.virtual.left || this.keys.left.isDown || this.keys.left2.isDown || this.virtualAxisX < -0.12 || axisX < -0.24 || !!pad?.left;
    this.now.right = this.virtual.right || this.keys.right.isDown || this.keys.right2.isDown || this.virtualAxisX > 0.12 || axisX > 0.24 || !!pad?.right;
    this.now.jump = this.virtual.jump || this.keys.jump.isDown || this.keys.jump2.isDown || !!pad?.A;
    this.now.attack = this.virtual.attack || this.keys.attack.isDown || !!pad?.X;
    this.now.dash = this.virtual.dash || this.keys.dash.isDown || !!pad?.B;
    this.now.parry = this.virtual.parry || this.keys.parry.isDown || !!pad?.Y;
    this.now.overdrive = this.virtual.overdrive || this.keys.overdrive.isDown || !!pad?.R1;
  }

  down(action: Action): boolean {
    return this.now[action];
  }

  pressed(action: Action): boolean {
    const pressed = this.latchedPress[action] || (this.now[action] && !this.prev[action]);
    this.latchedPress[action] = false;
    return pressed;
  }

  released(action: Action): boolean {
    return !this.now[action] && this.prev[action];
  }
}
