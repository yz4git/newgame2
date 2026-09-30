import Phaser from 'phaser';
import { gameBus, emit, type HudPayload, type ResultPayload } from '../events';
import { InputSystem, type Action } from '../input/InputSystem';
import { AudioSynth } from '../audio/AudioSynth';
import { clearRun, freshRun, getBest, loadRun, saveRun, setBest, type RunSave } from '../model/RunState';

type EnemyType = 'runner' | 'guard' | 'drone' | 'sniper' | 'boss';

type Enemy = {
  sprite: Phaser.Physics.Arcade.Sprite;
  type: EnemyType;
  hp: number;
  maxHp: number;
  cooldown: number;
  stunnedUntil: number;
  lastSwing: number;
  phase: number;
  windupUntil: number;
};

type SceneStart = {
  autoStart?: boolean;
  resume?: boolean;
};

type LaserGate = {
  beam: Phaser.GameObjects.Rectangle;
  x: number;
  phase: number;
  active: boolean;
};

const WIDTH = 1280;
const HEIGHT = 720;
const FLOOR = 620;
const WORLD_WIDTH = 7600;

const ZONES = [
  { x: 0, name: '01 // FLOW LAB', tech: 'PHYSICS // COYOTE TIME + JUMP BUFFER' },
  { x: 2100, name: '02 // COMBAT GRID', tech: 'COMBAT // CANCEL CHAIN + HIT STOP' },
  { x: 4300, name: '03 // REFLEX TUNNEL', tech: 'DEFENSE // PARRY + TIME DILATION' },
  { x: 6000, name: '04 // CORE CHAMBER', tech: 'BOSS // MULTI-PHASE BEHAVIOR' }
];

const CHECKPOINTS = [120, 2160, 4380, 6080];

export class GameScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private platforms!: Phaser.Physics.Arcade.StaticGroup;
  private hazards!: Phaser.Physics.Arcade.StaticGroup;
  private jumpPads!: Phaser.Physics.Arcade.StaticGroup;
  private projectiles!: Phaser.Physics.Arcade.Group;
  private shards!: Phaser.Physics.Arcade.Group;
  private laserGates: LaserGate[] = [];
  private enemies: Enemy[] = [];
  private inputSystem!: InputSystem;
  private audio = new AudioSynth();
  private run: RunSave = freshRun();
  private runActive = false;
  private paused = false;
  private startTime = 0;
  private currentZone = -1;
  private tech = 'READY // PHASER ARCADE PHYSICS';
  private lastHud = 0;
  private lastGrounded = 0;
  private jumpQueued = 0;
  private dashUntil = 0;
  private dashReadyAt = 0;
  private parryUntil = 0;
  private parryReadyAt = 0;
  private attackUntil = 0;
  private attackQueuedUntil = 0;
  private comboStep = 0;
  private comboExpires = 0;
  private swingSerial = 1;
  private comboCount = 0;
  private comboDecayAt = 0;
  private invulnerableUntil = 0;
  private contactGraceUntil = 0;
  private overdriveUntil = 0;
  private bossPattern = 0;
  private bgGrid!: Phaser.GameObjects.TileSprite;
  private bgCity!: Phaser.GameObjects.TileSprite;
  private bgFar!: Phaser.GameObjects.TileSprite;
  private bgClouds!: Phaser.GameObjects.TileSprite;
  private commandHandler!: EventListener;
  private virtualHandler!: EventListener;

  constructor() {
    super('Game');
  }

  create(data: SceneStart = {}): void {
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, HEIGHT + 500);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, HEIGHT);
    this.cameras.main.setBackgroundColor('#050712');
    this.buildBackground();
    this.buildLevel();
    this.buildPlayer();
    this.buildEnemies();
    this.buildCollectibles();
    this.inputSystem = new InputSystem(this);

    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.enemies.map(e => e.sprite), this.platforms);
    this.physics.add.overlap(this.player, this.hazards, () => this.hurtPlayer(18, 0));
    this.physics.add.overlap(this.player, this.jumpPads, () => {
      const body = this.player.body as Phaser.Physics.Arcade.Body;
      if (body.velocity.y >= -80) {
        this.player.setVelocityY(-760);
        this.jumpQueued = 0;
        this.tech = 'GIMMICK // IMPULSE PAD + PRESERVED HORIZONTAL MOMENTUM';
        this.jumpBurst(0xffd35a);
        this.audio.sfx('jump');
      }
    });
    this.physics.add.overlap(this.player, this.projectiles, (_p, projectile) => {
      const shot = projectile as Phaser.Physics.Arcade.Sprite;
      if (!shot.active) return;
      shot.destroy();
      if (this.time.now <= this.parryUntil) this.perfectParry();
      else this.hurtPlayer(12, (shot.body as Phaser.Physics.Arcade.Body).velocity.x * 0.55);
    });
    this.physics.add.overlap(this.player, this.shards, (_p, shard) => this.collectShard(shard as Phaser.Physics.Arcade.Sprite));

    this.cameras.main.startFollow(this.player, true, 0.10, 0.12, -WIDTH * 0.16, 40);
    this.cameras.main.setDeadzone(260, 120);

    this.virtualHandler = ((event: CustomEvent<{ action: Action; down: boolean }>) => {
      this.inputSystem?.setVirtual(event.detail.action, event.detail.down);
    }) as EventListener;

    this.commandHandler = ((event: CustomEvent<string>) => {
      const command = event.detail;
      if (command === 'start' || command === 'resume') {
        this.audio.unlock();
        this.scene.restart({ autoStart: true, resume: command === 'resume' });
      } else if (command === 'restart') {
        this.audio.unlock();
        clearRun();
        this.scene.restart({ autoStart: true, resume: false });
      } else if (command === 'pause') {
        this.togglePause();
      }
    }) as EventListener;

    gameBus.addEventListener('virtual', this.virtualHandler);
    gameBus.addEventListener('command', this.commandHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      gameBus.removeEventListener('virtual', this.virtualHandler);
      gameBus.removeEventListener('command', this.commandHandler);
    });

    if (data.autoStart) this.beginRun(Boolean(data.resume));
    else {
      this.player.setVisible(false);
      this.physics.world.pause();
      emit('ready', { hasSave: Boolean(loadRun()), best: getBest() });
    }
  }

  private beginRun(resume: boolean): void {
    this.run = resume ? (loadRun() || freshRun()) : freshRun();
    if (!resume) clearRun();
    this.runActive = true;
    this.paused = false;
    this.startTime = performance.now();
    this.currentZone = -1;
    this.comboCount = 0;
    this.player.setVisible(true);
    this.player.setPosition(CHECKPOINTS[this.run.checkpoint] ?? CHECKPOINTS[0], FLOOR - 60);
    this.player.setVelocity(0, 0);
    this.physics.world.resume();
    this.tech = resume ? 'STATE // CHECKPOINT RESTORED FROM LOCAL SAVE' : 'READY // FIXED PHYSICS + SERIALIZABLE STATE';
    emit('playing', undefined);
    this.updateZone(true);
    this.emitHud(true);
  }

  private buildBackground(): void {
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x050712).setScrollFactor(0).setDepth(-30);
    this.bgClouds = this.add.tileSprite(0, 55, WIDTH, 150, 'cloud-band').setOrigin(0).setScrollFactor(0).setDepth(-27).setAlpha(.75);
    this.bgFar = this.add.tileSprite(0, 100, WIDTH, HEIGHT - 100, 'far-city').setOrigin(0).setScrollFactor(0).setDepth(-24).setAlpha(.72);
    this.bgCity = this.add.tileSprite(0, 100, WIDTH, HEIGHT - 100, 'mid-city').setOrigin(0).setScrollFactor(0).setDepth(-20).setAlpha(.78);
    this.bgGrid = this.add.tileSprite(0, 180, WIDTH, HEIGHT - 180, 'grid').setOrigin(0).setScrollFactor(0).setDepth(-17).setAlpha(.52);

    for (let x = 600; x < WORLD_WIDTH; x += 720) {
      const accent = x % 1440 === 0 ? 0xff3bd4 : 0x4ef7ff;
      this.add.rectangle(x, 240 + (x % 3) * 36, 150, 310, 0x0b1327, .58).setDepth(-14);
      this.add.rectangle(x + 52, 185 + (x % 5) * 15, 8, 180, accent, .18).setDepth(-13);
      this.add.rectangle(x - 48, 300, 70, 4, accent, .20).setDepth(-13);
    }

    this.add.rectangle(3300, 380, 350, 260, 0x4ef7ff, .025).setStrokeStyle(2, 0x4ef7ff, .16).setDepth(-8);
    this.add.text(3180, 275, 'VECTOR FLOW', { fontFamily: 'ui-monospace, monospace', fontSize: '16px', color: '#4ef7ff' }).setAlpha(.24).setDepth(-7);
    this.add.rectangle(WIDTH / 2, HEIGHT - 58, WIDTH, 116, 0x04060d, .72).setScrollFactor(0).setDepth(-11);
  }

  private makePlatform(x: number, y: number, w: number, h = 26): void {
    const platform = this.platforms.create(x + w / 2, y + h / 2, 'platform') as Phaser.Physics.Arcade.Sprite;
    platform.setDisplaySize(w, h);
    platform.refreshBody();
  }

  private makeHazard(x: number, y: number, w = 80): void {
    const count = Math.max(1, Math.ceil(w / 40));
    for (let i = 0; i < count; i++) {
      const spike = this.hazards.create(x + i * 40 + 20, y - 14, 'hazard') as Phaser.Physics.Arcade.Sprite;
      spike.refreshBody();
    }
  }

  private buildLevel(): void {
    this.platforms = this.physics.add.staticGroup();
    this.hazards = this.physics.add.staticGroup();
    this.jumpPads = this.physics.add.staticGroup();
    this.projectiles = this.physics.add.group({ allowGravity: false });
    this.shards = this.physics.add.group({ allowGravity: false, immovable: true });

    const floors = [
      [0, FLOOR, 1500], [1580, FLOOR, 950], [2600, FLOOR, 980],
      [3660, FLOOR, 760], [4510, FLOOR, 1040], [5630, FLOOR, 1970]
    ];
    floors.forEach(([x, y, w]) => this.makePlatform(x, y, w, 100));

    [
      [470, 500, 220], [770, 420, 190], [1060, 340, 210],
      [1660, 520, 220], [1970, 440, 230], [2860, 500, 250],
      [3190, 410, 230], [3880, 485, 270], [4690, 500, 250],
      [5050, 420, 300], [5740, 500, 230], [6040, 430, 210]
    ].forEach(([x, y, w]) => this.makePlatform(x, y, w, 24));

    this.makePlatform(1450, 410, 54, 210);
    this.makePlatform(3510, 320, 58, 300);
    this.makePlatform(4440, 390, 58, 230);

    this.makeHazard(1500, FLOOR, 80);
    this.makeHazard(2530, FLOOR, 70);
    this.makeHazard(3580, FLOOR, 80);
    this.makeHazard(4420, FLOOR, 90);
    this.makeHazard(5550, FLOOR, 80);

    [
      [1380, FLOOR - 10],
      [3440, FLOOR - 10],
      [5480, FLOOR - 10]
    ].forEach(([x, y]) => {
      const pad = this.jumpPads.create(x, y, 'jump-pad') as Phaser.Physics.Arcade.Sprite;
      pad.setSize(72, 12).setOffset(4, 4);
      pad.refreshBody();
    });

    [3820, 4140, 4660].forEach((x, index) => {
      this.add.image(x - 18, FLOOR - 58, 'laser-post').setDepth(3);
      this.add.image(x + 18, FLOOR - 58, 'laser-post').setFlipX(true).setDepth(3);
      const beam = this.add.rectangle(x, FLOOR - 105, 12, 190, 0xff4d79, .28).setDepth(4);
      beam.setStrokeStyle(2, 0xff9ab2, .8);
      this.laserGates.push({ beam, x, phase: index * 530, active: true });
    });

    for (let x = 3160; x <= 3460; x += 60) {
      this.add.triangle(x, 530, 0, 12, 24, 0, 24, 24, 0x4ef7ff, .16).setAngle(90).setDepth(2);
    }
  }

  private buildPlayer(): void {
    this.player = this.physics.add.sprite(120, FLOOR - 60, 'hero-idle');
    this.player.setCollideWorldBounds(false);
    this.player.setDepth(10);
    this.player.setSize(28, 54).setOffset(4, 2);
    this.player.setMaxVelocity(820, 940);
  }

  private spawnEnemy(type: EnemyType, x: number, y: number, hp: number): void {
    const sprite = this.physics.add.sprite(x, y, type);
    sprite.setDepth(8);
    sprite.setCollideWorldBounds(false);
    if (type === 'drone') (sprite.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
    if (type === 'boss') sprite.setSize(84, 108);
    const enemy: Enemy = {
      sprite, type, hp, maxHp: hp, cooldown: 0,
      stunnedUntil: 0, lastSwing: 0, phase: 1, windupUntil: 0
    };
    sprite.setData('enemyRef', enemy);
    this.enemies.push(enemy);
  }

  private buildEnemies(): void {
    this.enemies = [];
    this.spawnEnemy('runner', 850, FLOOR - 40, 42);
    this.spawnEnemy('drone', 1240, 300, 34);
    this.spawnEnemy('runner', 1810, FLOOR - 40, 42);
    this.spawnEnemy('guard', 2310, FLOOR - 52, 76);
    this.spawnEnemy('drone', 2960, 380, 36);
    this.spawnEnemy('runner', 3350, FLOOR - 40, 48);
    this.spawnEnemy('sniper', 3970, FLOOR - 45, 52);
    this.spawnEnemy('guard', 4750, FLOOR - 52, 82);
    this.spawnEnemy('drone', 5200, 325, 42);
    this.spawnEnemy('runner', 5700, FLOOR - 40, 54);
    this.spawnEnemy('boss', 6810, FLOOR - 105, 520);
  }

  private buildCollectibles(): void {
    [
      [650, 455], [930, 375], [1180, 295], [1760, 475], [2070, 395],
      [2980, 455], [3310, 365], [4000, 435], [4820, 455], [5180, 375], [5850, 455]
    ].forEach(([x, y]) => {
      const shard = this.shards.create(x, y, 'shard') as Phaser.Physics.Arcade.Sprite;
      shard.setData('value', 9);
      shard.setAngularVelocity(65);
    });
  }

  update(time: number, deltaMs: number): void {
    this.bgClouds.tilePositionX = this.cameras.main.scrollX * .05;
    this.bgFar.tilePositionX = this.cameras.main.scrollX * .11;
    this.bgCity.tilePositionX = this.cameras.main.scrollX * .23;
    this.bgGrid.tilePositionX = this.cameras.main.scrollX * .40;

    if (!this.runActive || this.paused) return;

    const dt = Math.min(deltaMs, 34) / 1000;
    this.inputSystem.update();
    this.audio.tick(time < this.overdriveUntil);
    this.updatePlayer(time, dt);
    this.updateEnemies(time, dt);
    this.updateProjectiles();
    this.updateGimmicks(time);
    this.updateZone(false);

    if (this.comboCount > 0 && time > this.comboDecayAt) this.comboCount = 0;
    if (time - this.lastHud > 80) this.emitHud(false);
    if (this.player.y > HEIGHT + 260) this.respawnFromFall();
  }

  private updatePlayer(time: number, _dt: number): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const grounded = body.blocked.down || body.touching.down;
    if (grounded) this.lastGrounded = time;
    if (this.inputSystem.pressed('jump')) this.jumpQueued = time + 165;

    const overdrive = time < this.overdriveUntil;
    const speed = overdrive ? 455 : 350;
    if (time < this.dashUntil) {
      body.setAllowGravity(false);
      this.player.setVelocityX(this.player.flipX ? -760 : 760);
      this.player.setVelocityY(0);
      this.emitTrail();
    } else {
      body.setAllowGravity(true);
      const axis = (this.inputSystem.down('right') ? 1 : 0) - (this.inputSystem.down('left') ? 1 : 0);
      if (axis !== 0) {
        this.player.setFlipX(axis < 0);
        this.player.setAccelerationX(axis * (grounded ? 1900 : 1250));
        this.player.setDragX(0);
        if (Math.abs(body.velocity.x) > speed) this.player.setVelocityX(axis * speed);
        if (grounded && this.attackUntil < time) this.player.play('hero-run', true);
      } else {
        this.player.setAccelerationX(0);
        this.player.setDragX(grounded ? 1800 : 260);
        if (grounded && this.attackUntil < time) {
          this.player.anims.stop();
          this.player.setTexture('hero-idle');
        }
      }

      const wall = !grounded && (body.blocked.left || body.blocked.right);
      if (wall && body.velocity.y > 180) this.player.setVelocityY(180);

      if (this.jumpQueued > time) {
        if (grounded || time - this.lastGrounded < 145) {
          this.player.setVelocityY(-570);
          this.jumpQueued = 0;
          this.jumpBurst(0x4ef7ff);
          this.audio.sfx('jump');
        } else if (wall) {
          const dir = body.blocked.left ? 1 : -1;
          this.player.setVelocity(dir * 430, -535);
          this.player.setFlipX(dir < 0);
          this.jumpQueued = 0;
          this.tech = 'MOVEMENT // WALL JUMP VECTOR REDIRECT';
          this.jumpBurst(0xff3bd4);
          this.audio.sfx('jump');
        }
      }
    }

    if (this.inputSystem.released('jump') && body.velocity.y < -220) {
      this.player.setVelocityY(body.velocity.y * .52);
    }

    if (this.player.x > 3160 && this.player.x < 3480 && this.player.y < 560) {
      this.player.setVelocityX(Phaser.Math.Clamp(body.velocity.x + 18, -120, 520));
      if (Math.floor(time / 90) % 2 === 0) this.emitWindStreak();
      this.tech = 'GIMMICK // VECTOR FLOW TUNNEL';
    }

    if (this.inputSystem.pressed('dash') && time >= this.dashReadyAt) {
      this.dashUntil = time + 165;
      this.dashReadyAt = time + 500;
      this.invulnerableUntil = time + 190;
      this.player.setVelocityY(0);
      this.tech = 'MOVEMENT // AIR/GROUND DASH + I-FRAMES';
      this.impact(this.player.x, this.player.y + 25, 0x4ef7ff, 10);
      this.audio.sfx('dash');
    }

    if (this.inputSystem.pressed('parry') && time >= this.parryReadyAt) {
      this.parryUntil = time + 185;
      this.parryReadyAt = time + 540;
      this.tech = 'DEFENSE // 185ms ACTIVE PARRY WINDOW';
      this.flashRing(this.player.x, this.player.y + 22, 0xffd35a);
    }

    if (this.inputSystem.pressed('attack')) {
      if (this.attackUntil > time) this.attackQueuedUntil = time + 280;
      else this.beginAttack(time);
    }

    if (this.attackUntil > time) {
      this.player.anims.stop();
      this.player.setTexture(['hero-atk-1', 'hero-atk-2', 'hero-atk-3'][this.comboStep]);
      this.resolveAttack(time);
    } else if (this.attackQueuedUntil > time) {
      this.attackQueuedUntil = 0;
      this.beginAttack(time);
    }

    if (this.inputSystem.pressed('overdrive') && this.run.energy >= 100 && time >= this.overdriveUntil) {
      this.run.energy = 0;
      this.overdriveUntil = time + 5600;
      this.invulnerableUntil = time + 500;
      this.cameras.main.flash(160, 255, 214, 80, false);
      this.cameras.main.shake(220, .012);
      this.tech = 'OVERDRIVE // SPEED + DAMAGE + IMPACT AMPLIFICATION';
      this.impact(this.player.x, this.player.y, 0xffd35a, 34);
      this.audio.sfx('overdrive');
    }

    if (this.parryUntil > time) this.player.setTint(0xffe798);
    else if (overdrive) this.player.setTint(0xfff1a8);
    else this.player.clearTint();
  }

  private beginAttack(time: number): void {
    if (time < this.attackUntil || time < this.dashUntil) return;
    this.comboStep = time <= this.comboExpires ? (this.comboStep + 1) % 3 : 0;
    const overdrive = time < this.overdriveUntil;
    const duration = [190, 215, 315][this.comboStep] * (overdrive ? .72 : 1);
    this.attackUntil = time + duration;
    this.comboExpires = this.attackUntil + 500;
    this.swingSerial++;

    const dir = this.player.flipX ? -1 : 1;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const lunge = [105, 135, 210][this.comboStep];
    if (Math.abs(body.velocity.x) < lunge) this.player.setVelocityX(dir * lunge);

    this.createSlashEffect(this.comboStep, dir);
    this.tech = this.comboStep === 2
      ? 'COMBAT // FINISHER ARC + KNOCKBACK + HIT STOP'
      : 'COMBAT // BUFFERED 3-STEP CANCEL CHAIN';
  }

  private resolveAttack(time: number): void {
    const dir = this.player.flipX ? -1 : 1;
    const reach = [72, 84, 116][this.comboStep];
    const height = [56, 62, 86][this.comboStep];
    const box = new Phaser.Geom.Rectangle(
      dir > 0 ? this.player.x + 8 : this.player.x - reach - 8,
      this.player.y - height / 2,
      reach,
      height
    );

    for (const enemy of this.enemies) {
      if (!enemy.sprite.active || enemy.lastSwing === this.swingSerial) continue;
      if (!Phaser.Geom.Intersects.RectangleToRectangle(box, enemy.sprite.getBounds())) continue;
      enemy.lastSwing = this.swingSerial;
      const base = [14, 19, 34][this.comboStep];
      const damage = Math.round(base * (time < this.overdriveUntil ? 1.6 : 1));
      this.damageEnemy(enemy, damage, dir * [180, 270, 500][this.comboStep]);
    }
  }

  private updateEnemies(time: number, _dt: number): void {
    for (const enemy of this.enemies) {
      const s = enemy.sprite;
      if (!s.active) continue;
      const body = s.body as Phaser.Physics.Arcade.Body;
      const dx = this.player.x - s.x;
      const distance = Math.abs(dx);
      const dir = dx >= 0 ? 1 : -1;
      s.setFlipX(dir < 0);

      if (time < enemy.stunnedUntil) {
        body.setAccelerationX(0);
        body.setDragX(500);
        continue;
      }

      if (time < enemy.windupUntil) {
        s.setVelocityX(0);
        continue;
      }

      if (enemy.type === 'drone') {
        body.setAllowGravity(false);
        s.setVelocityY(Math.sin((time + s.x) * .004) * 52);
        s.setVelocityX(distance < 220 ? -dir * 90 : distance > 430 && distance < 700 ? dir * 65 : 0);
        if (distance < 610 && time >= enemy.cooldown) {
          this.fireProjectile(enemy, 340, -.06);
          this.time.delayedCall(90, () => enemy.sprite.active && this.fireProjectile(enemy, 340, .06));
          enemy.cooldown = time + 1680;
          this.tech = 'AI // DRONE STRAFE + DOUBLE SHOT';
        }
      } else if (enemy.type === 'sniper') {
        s.setVelocityX(0);
        if (distance < 820 && time >= enemy.cooldown) {
          this.queueSniperShot(enemy);
          enemy.cooldown = time + 2200;
        }
      } else if (enemy.type === 'boss') {
        const nextPhase = enemy.hp / enemy.maxHp < .34 ? 3 : enemy.hp / enemy.maxHp < .67 ? 2 : 1;
        if (nextPhase !== enemy.phase) {
          enemy.phase = nextPhase;
          this.bossPhaseShift(enemy);
        }
        if (distance > 155) s.setVelocityX(dir * (enemy.phase === 3 ? 145 : enemy.phase === 2 ? 95 : 68));
        else s.setVelocityX(0);
        if (time >= enemy.cooldown) {
          if (this.inMeleeRange(enemy, 58, 22)) {
            this.queueMeleeAttack(enemy, 24, dir * 360, 58, 22, enemy.phase === 3 ? 220 : 300, enemy.phase === 3 ? 900 : 1280);
          } else if (distance < 820) {
            this.bossPattern++;
            const count = enemy.phase === 1 ? 1 : enemy.phase === 2 ? 3 : 5;
            const spread = enemy.phase === 3 ? .18 : .14;
            for (let i = 0; i < count; i++) {
              this.fireProjectile(enemy, 350 + enemy.phase * 42, (i - (count - 1) / 2) * spread, true);
            }
            if (enemy.phase >= 2 && this.bossPattern % 2 === 0) {
              this.time.delayedCall(260, () => {
                if (!enemy.sprite.active || !this.runActive) return;
                for (let i = -2; i <= 2; i++) this.fireProjectile(enemy, 300, i * .24, true);
              });
            }
            enemy.cooldown = time + (enemy.phase === 3 ? 980 : 1320);
            this.tech = 'BOSS AI // PHASE ' + enemy.phase + ' LAYERED PATTERN';
          }
        }
      } else {
        const isGuard = enemy.type === 'guard';
        const speed = isGuard ? 92 : distance > 180 ? 210 : 250;
        const stop = isGuard ? 82 : 62;
        if (distance > stop && distance < 560) s.setVelocityX(dir * speed);
        else s.setVelocityX(0);
        if (!isGuard && distance > 150 && distance < 260 && body.blocked.down && time >= enemy.cooldown - 220) {
          s.setVelocityY(-250);
        }
        const padding = isGuard ? 30 : 20;
        if (this.inMeleeRange(enemy, padding, 10) && time >= enemy.cooldown) {
          this.queueMeleeAttack(
            enemy,
            enemy.type === 'guard' ? 18 : 12,
            dir * (enemy.type === 'guard' ? 280 : 220),
            padding,
            10,
            enemy.type === 'guard' ? 260 : 170,
            enemy.type === 'guard' ? 1650 : 1180
          );
        }
      }
    }
  }

  private queueMeleeAttack(
    enemy: Enemy,
    damage: number,
    knockback: number,
    paddingX: number,
    paddingY: number,
    windupMs: number,
    cooldownMs: number
  ): void {
    const now = this.time.now;
    if (enemy.windupUntil > now || now < enemy.cooldown || !enemy.sprite.active) return;

    enemy.cooldown = now + cooldownMs;
    enemy.windupUntil = now + windupMs;
    enemy.sprite.setTint(0xff8a70);
    this.flashRing(enemy.sprite.x, enemy.sprite.y, 0xff6f91);
    this.floatText(enemy.sprite.x, enemy.sprite.y - enemy.sprite.displayHeight * .65, '!', '#ff8aa3');
    this.tech = 'COMBAT READABILITY // TELEGRAPH → EVADE / PARRY';

    this.time.delayedCall(windupMs, () => {
      enemy.windupUntil = 0;
      if (!enemy.sprite.active || !this.runActive) return;
      enemy.sprite.clearTint();
      if (this.paused || !this.inMeleeRange(enemy, paddingX, paddingY)) return;

      if (this.time.now <= this.parryUntil) this.perfectParry(enemy);
      else this.hurtPlayer(damage, knockback, enemy);
    });
  }

  private inMeleeRange(enemy: Enemy, paddingX: number, paddingY: number): boolean {
    if (!enemy.sprite.active || !this.player.active) return false;
    const enemyBounds = enemy.sprite.getBounds();
    const attackZone = new Phaser.Geom.Rectangle(
      enemyBounds.x - paddingX,
      enemyBounds.y - paddingY,
      enemyBounds.width + paddingX * 2,
      enemyBounds.height + paddingY * 2
    );
    return Phaser.Geom.Intersects.RectangleToRectangle(this.player.getBounds(), attackZone);
  }

  private separateFromEnemy(enemy: Enemy): void {
    if (!enemy.sprite.active) return;
    const playerBounds = this.player.getBounds();
    const enemyBounds = enemy.sprite.getBounds();
    if (!Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, enemyBounds)) return;

    const away = this.player.x < enemy.sprite.x ? -1 : 1;
    const overlap = Math.min(playerBounds.right, enemyBounds.right) - Math.max(playerBounds.left, enemyBounds.left);
    const shift = Math.max(12, overlap + 8);
    this.player.x += away * shift;
    this.player.setVelocityX(away * Math.max(180, Math.abs((this.player.body as Phaser.Physics.Arcade.Body).velocity.x)));
  }

  private queueSniperShot(enemy: Enemy): void {
    if (!enemy.sprite.active) return;
    const line = this.add.graphics().setDepth(6);
    line.lineStyle(2, 0xffd35a, .55).lineBetween(enemy.sprite.x, enemy.sprite.y, this.player.x, this.player.y);
    this.floatText(enemy.sprite.x, enemy.sprite.y - 42, 'LOCK', '#ffd35a');
    this.tech = 'AI // SNIPER LOCK-ON TELEGRAPH';
    this.tweens.add({ targets: line, alpha: 0, duration: 420, onComplete: () => line.destroy() });
    this.time.delayedCall(360, () => {
      if (enemy.sprite.active && this.runActive && !this.paused) this.fireProjectile(enemy, 585, 0);
    });
  }

  private fireProjectile(enemy: Enemy, speed: number, spread: number, bossShot = false): void {
    const shot = this.projectiles.get(enemy.sprite.x, enemy.sprite.y, bossShot ? 'boss-shot' : 'shot') as Phaser.Physics.Arcade.Sprite;
    if (!shot) return;
    shot.enableBody(true, enemy.sprite.x, enemy.sprite.y, true, true);
    const angle = Phaser.Math.Angle.Between(enemy.sprite.x, enemy.sprite.y, this.player.x, this.player.y) + spread;
    this.physics.velocityFromRotation(angle, speed, (shot.body as Phaser.Physics.Arcade.Body).velocity);
    shot.setData('born', this.time.now);
    shot.setDepth(7);
  }

  private updateProjectiles(): void {
    for (const obj of this.projectiles.getChildren()) {
      const shot = obj as Phaser.Physics.Arcade.Sprite;
      if (!shot.active) continue;
      if (this.time.now - Number(shot.getData('born')) > 4200 || shot.y < -80 || shot.y > HEIGHT + 220) shot.destroy();
    }
  }

  private perfectParry(enemy?: Enemy): void {
    const now = this.time.now;
    this.parryUntil = 0;
    this.parryReadyAt = now + 250;
    this.invulnerableUntil = now + 360;
    this.run.energy = Math.min(100, this.run.energy + 28);
    this.run.score += 180;
    this.comboCount++;
    this.comboDecayAt = now + 1800;
    if (enemy) {
      enemy.stunnedUntil = now + 1150;
      enemy.sprite.setVelocityX((this.player.x < enemy.sprite.x ? 1 : -1) * 190);
    }
    this.cameras.main.shake(180, .014);
    this.cameras.main.flash(100, 255, 222, 85, false);
    this.physics.world.pause();
    window.setTimeout(() => { if (this.runActive && !this.paused) this.physics.world.resume(); }, 65);
    this.physics.world.timeScale = 3.2;
    window.setTimeout(() => { this.physics.world.timeScale = 1; }, 220);
    this.flashRing(this.player.x, this.player.y + 22, 0xffd35a);
    this.impact(this.player.x, this.player.y + 18, 0xffd35a, 24);
    this.tech = 'FRAME FEEL // PARRY → HIT STOP → TIME DILATION';
    this.audio.sfx('parry');
  }

  private damageEnemy(enemy: Enemy, amount: number, knockback: number): void {
    if (enemy.type === 'guard' && this.time.now >= enemy.stunnedUntil) {
      const facingPlayer = (enemy.sprite.flipX && this.player.x < enemy.sprite.x) || (!enemy.sprite.flipX && this.player.x > enemy.sprite.x);
      if (facingPlayer) {
        amount = Math.max(3, Math.round(amount * .38));
        knockback *= .35;
        this.floatText(enemy.sprite.x, enemy.sprite.y - 40, 'GUARD', '#ffd35a');
        this.flashRing(enemy.sprite.x, enemy.sprite.y, 0xffd35a);
        this.tech = 'ENEMY IDENTITY // GUARD BLOCKS FRONTAL ATTACKS';
      }
    }
    enemy.hp -= amount;
    enemy.sprite.setVelocityX(knockback);
    enemy.stunnedUntil = this.time.now + 130;
    enemy.sprite.setTintFill(0xffffff);
    this.time.delayedCall(70, () => enemy.sprite.active && enemy.sprite.clearTint());
    this.run.energy = Math.min(100, this.run.energy + (this.comboStep === 2 ? 10 : 6));
    this.run.score += this.comboStep === 2 ? 95 : 55;
    this.comboCount++;
    this.comboDecayAt = this.time.now + 1700;
    this.impact(enemy.sprite.x, enemy.sprite.y, this.comboStep === 2 ? 0xffd35a : 0x4ef7ff, this.comboStep === 2 ? 18 : 10);
    this.floatText(enemy.sprite.x, enemy.sprite.y - 38, String(amount) + (this.comboStep === 2 ? '!' : ''), this.comboStep === 2 ? '#ffd35a' : '#dffcff');
    this.cameras.main.shake(90, this.comboStep === 2 ? .012 : .006);
    this.physics.world.pause();
    window.setTimeout(() => { if (this.runActive && !this.paused) this.physics.world.resume(); }, this.comboStep === 2 ? 60 : 32);
    this.audio.sfx('hit');

    if (enemy.hp <= 0) this.killEnemy(enemy);
  }

  private killEnemy(enemy: Enemy): void {
    const isBoss = enemy.type === 'boss';
    const x = enemy.sprite.x;
    const y = enemy.sprite.y;
    enemy.sprite.disableBody(true, true);
    this.run.defeated++;
    this.run.score += isBoss ? 2600 : 280;
    this.impact(x, y, isBoss ? 0xff3bd4 : 0x4ef7ff, isBoss ? 60 : 26);
    if (isBoss) {
      clearRun();
      this.cameras.main.flash(350, 255, 70, 220, false);
      this.audio.sfx('win');
      this.time.delayedCall(850, () => this.finish(true));
    }
  }

  private hurtPlayer(amount: number, knockback: number, source?: Enemy): void {
    const now = this.time.now;
    if (!this.runActive || now < this.invulnerableUntil || now < this.contactGraceUntil || now < this.dashUntil || now < this.overdriveUntil) return;
    if (now <= this.parryUntil) {
      this.perfectParry(source);
      return;
    }

    this.run.hp = Math.max(0, this.run.hp - amount);
    this.invulnerableUntil = now + 900;
    this.contactGraceUntil = now + 420;
    this.comboCount = 0;

    if (source) this.separateFromEnemy(source);

    const away = source ? (this.player.x < source.sprite.x ? -1 : 1) : Math.sign(knockback || 1);
    const push = Math.max(170, Math.min(300, Math.abs(knockback)));
    this.player.setVelocity(away * push, -190);

    this.cameras.main.shake(150, .014);
    this.cameras.main.flash(100, 255, 40, 80, false);
    this.impact(this.player.x, this.player.y, 0xff4d79, 16);
    this.tech = 'RECOVERY // CONTACT SEPARATION + INPUT PRESERVED';
    this.audio.sfx('hurt');
    if (this.run.hp <= 0) this.time.delayedCall(300, () => this.finish(false));
  }

  private collectShard(shard: Phaser.Physics.Arcade.Sprite): void {
    if (!shard.active) return;
    const value = Number(shard.getData('value') || 8);
    this.run.energy = Math.min(100, this.run.energy + value);
    this.run.score += 70;
    this.impact(shard.x, shard.y, 0x4ef7ff, 12);
    shard.disableBody(true, true);
    this.tech = 'ASSET PIPELINE // COLLECTIBLE FX + STATE UPDATE';
    this.audio.sfx('pickup');
  }

  private updateGimmicks(time: number): void {
    const pBounds = this.player.getBounds();
    for (const gate of this.laserGates) {
      const cycle = (time + gate.phase) % 1800;
      const active = cycle < 980;
      gate.active = active;
      gate.beam.setVisible(active || cycle < 1220);
      gate.beam.setAlpha(active ? .38 + Math.sin(time * .02) * .10 : .08);
      gate.beam.setFillStyle(active ? 0xff4d79 : 0xffd35a, active ? .34 : .10);
      if (active && Phaser.Geom.Intersects.RectangleToRectangle(pBounds, gate.beam.getBounds())) {
        this.hurtPlayer(14, this.player.x < gate.x ? -180 : 180);
        this.tech = 'GIMMICK // TIMED LASER GATE';
      }
    }
  }

  private bossPhaseShift(enemy: Enemy): void {
    enemy.stunnedUntil = this.time.now + 720;
    enemy.cooldown = this.time.now + 900;
    this.cameras.main.flash(220, enemy.phase === 3 ? 255 : 80, 70, enemy.phase === 2 ? 255 : 120, false);
    this.cameras.main.shake(320, .018);
    this.impact(enemy.sprite.x, enemy.sprite.y, enemy.phase === 3 ? 0xffd35a : 0xff3bd4, 52);
    this.flashRing(enemy.sprite.x, enemy.sprite.y, enemy.phase === 3 ? 0xffd35a : 0xff3bd4);
    this.floatText(enemy.sprite.x, enemy.sprite.y - 90, 'PHASE ' + enemy.phase, '#ffffff');
    this.tech = 'BOSS // PHASE ' + enemy.phase + ' BEHAVIOR SHIFT';
  }

  private createSlashEffect(step: number, dir: number): void {
    const colors = [0x4ef7ff, 0xff3bd4, 0xffd35a];
    const radius = [34, 43, 58][step];
    const slash = this.add.graphics().setDepth(22).setBlendMode(Phaser.BlendModes.ADD);
    const start = dir > 0 ? -1.0 : Math.PI + 1.0;
    const end = dir > 0 ? .9 : Math.PI - .9;
    slash.lineStyle(5 + step * 2, colors[step], .82);
    slash.beginPath();
    slash.arc(this.player.x + dir * 22, this.player.y + 4, radius, start, end, dir < 0);
    slash.strokePath();
    this.tweens.add({
      targets: slash,
      alpha: 0,
      scaleX: 1.25,
      scaleY: 1.25,
      duration: 150 + step * 45,
      onComplete: () => slash.destroy()
    });
  }

  private emitWindStreak(): void {
    const y = this.player.y + Phaser.Math.Between(-60, 60);
    const line = this.add.rectangle(this.player.x - 75, y, 70, 2, 0x4ef7ff, .30).setDepth(1);
    this.tweens.add({ targets: line, x: line.x + 170, alpha: 0, duration: 240, onComplete: () => line.destroy() });
  }

  private updateZone(force: boolean): void {
    let zone = 0;
    for (let i = 0; i < ZONES.length; i++) if (this.player.x >= ZONES[i].x) zone = i;
    if (!force && zone === this.currentZone) return;
    this.currentZone = zone;
    this.tech = ZONES[zone].tech;
    if (this.runActive && zone > this.run.checkpoint) {
      this.run.checkpoint = zone;
      saveRun(this.run);
      this.tech = 'SAVE STATE // CHECKPOINT ' + (zone + 1) + ' SERIALIZED';
    }
    const colors = [0x4ef7ff, 0xff3bd4, 0x5effc8, 0xff7be4];
    this.bgGrid.setTint(colors[zone]);
    this.impact(this.player.x, this.player.y, colors[zone], 16);
  }

  private emitHud(force: boolean): void {
    if (!force && !this.runActive) return;
    this.lastHud = this.time.now;
    const boss = this.enemies.find(e => e.type === 'boss' && e.sprite.active);
    const payload: HudPayload = {
      hp: this.run.hp,
      energy: this.run.energy,
      score: this.run.score,
      combo: this.comboCount,
      zone: ZONES[Math.max(0, this.currentZone)]?.name || ZONES[0].name,
      tech: this.tech,
      bossHp: this.currentZone === 3 && boss ? Math.max(0, boss.hp / boss.maxHp * 100) : undefined,
      bossName: this.currentZone === 3 && boss ? 'RIFT WARDEN // ADAPTIVE CORE' : undefined
    };
    emit('hud', payload);
  }

  private togglePause(): void {
    if (!this.runActive) return;
    this.paused = !this.paused;
    if (this.paused) this.physics.world.pause();
    else this.physics.world.resume();
    emit('paused', { paused: this.paused });
  }

  private respawnFromFall(): void {
    this.player.setPosition(CHECKPOINTS[this.run.checkpoint], FLOOR - 110);
    this.player.setVelocity(0, 0);
    this.hurtPlayer(15, 0);
  }

  private finish(win: boolean): void {
    if (!this.runActive) return;
    this.runActive = false;
    this.physics.world.pause();
    const bonus = win ? 2500 : 0;
    const total = this.run.score + bonus;
    const best = setBest(total);
    if (win) clearRun();
    const result: ResultPayload = {
      win,
      score: total,
      best,
      defeated: this.run.defeated,
      seconds: (performance.now() - this.startTime) / 1000
    };
    emit('result', result);
  }

  private jumpBurst(color: number): void {
    this.impact(this.player.x, this.player.y + 28, color, 7);
  }

  private emitTrail(): void {
    const ghost = this.add.image(this.player.x, this.player.y, 'hero-idle').setFlipX(this.player.flipX).setTint(0x4ef7ff).setAlpha(.24).setDepth(5);
    this.tweens.add({ targets: ghost, alpha: 0, scaleX: 1.25, scaleY: .85, duration: 150, onComplete: () => ghost.destroy() });
  }

  private impact(x: number, y: number, color: number, count: number): void {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const n = reduce ? Math.max(3, Math.ceil(count * .35)) : count;
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 25 + Math.random() * 90;
      const bit = this.add.rectangle(x, y, 3 + Math.random() * 5, 2 + Math.random() * 4, color).setDepth(30).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: bit,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        scaleX: .2,
        scaleY: .2,
        duration: 180 + Math.random() * 260,
        ease: 'Quad.easeOut',
        onComplete: () => bit.destroy()
      });
    }
  }

  private flashRing(x: number, y: number, color: number): void {
    const ring = this.add.circle(x, y, 20, color, 0).setStrokeStyle(4, color, .9).setDepth(28);
    this.tweens.add({ targets: ring, radius: 58, alpha: 0, duration: 220, ease: 'Quad.easeOut', onComplete: () => ring.destroy() });
  }

  private floatText(x: number, y: number, text: string, color: string): void {
    const label = this.add.text(x, y, text, { fontFamily: 'ui-monospace, monospace', fontSize: '18px', fontStyle: 'bold', color }).setOrigin(.5).setDepth(40);
    this.tweens.add({ targets: label, y: y - 42, alpha: 0, duration: 650, ease: 'Cubic.easeOut', onComplete: () => label.destroy() });
  }
}
