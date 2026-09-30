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
  private projectiles!: Phaser.Physics.Arcade.Group;
  private shards!: Phaser.Physics.Arcade.Group;
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
  private comboStep = 0;
  private comboExpires = 0;
  private swingSerial = 1;
  private comboCount = 0;
  private comboDecayAt = 0;
  private invulnerableUntil = 0;
  private contactGraceUntil = 0;
  private overdriveUntil = 0;
  private bgGrid!: Phaser.GameObjects.TileSprite;
  private bgCity!: Phaser.GameObjects.TileSprite;
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
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x050712).setScrollFactor(0).setDepth(-20);
    this.bgCity = this.add.tileSprite(0, 80, WIDTH, HEIGHT - 80, 'skyline').setOrigin(0).setScrollFactor(0).setDepth(-15).setAlpha(.62);
    this.bgGrid = this.add.tileSprite(0, 170, WIDTH, HEIGHT - 170, 'grid').setOrigin(0).setScrollFactor(0).setDepth(-12).setAlpha(.60);
    this.add.rectangle(WIDTH / 2, HEIGHT - 58, WIDTH, 116, 0x04060d, .7).setScrollFactor(0).setDepth(-11);
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
    this.bgCity.tilePositionX = this.cameras.main.scrollX * .18;
    this.bgGrid.tilePositionX = this.cameras.main.scrollX * .34;

    if (!this.runActive || this.paused) return;

    const dt = Math.min(deltaMs, 34) / 1000;
    this.inputSystem.update();
    this.audio.tick(time < this.overdriveUntil);
    this.updatePlayer(time, dt);
    this.updateEnemies(time, dt);
    this.updateProjectiles();
    this.updateZone(false);

    if (this.comboCount > 0 && time > this.comboDecayAt) this.comboCount = 0;
    if (time - this.lastHud > 80) this.emitHud(false);
    if (this.player.y > HEIGHT + 260) this.respawnFromFall();
  }

  private updatePlayer(time: number, _dt: number): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const grounded = body.blocked.down || body.touching.down;
    if (grounded) this.lastGrounded = time;
    if (this.inputSystem.pressed('jump')) this.jumpQueued = time + 130;

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
        if (grounded || time - this.lastGrounded < 115) {
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

    if (this.inputSystem.pressed('attack')) this.beginAttack(time);

    if (this.attackUntil > time) {
      this.player.anims.stop();
      this.player.setTexture('hero-idle');
      this.resolveAttack(time);
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
    const duration = [220, 245, 350][this.comboStep] * (time < this.overdriveUntil ? .75 : 1);
    this.attackUntil = time + duration;
    this.comboExpires = this.attackUntil + 430;
    this.swingSerial++;
    this.tech = this.comboStep === 2 ? 'COMBAT // FINISHER + KNOCKBACK + HIT STOP' : 'COMBAT // 3-STEP CANCEL CHAIN';
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
      const base = [14, 18, 31][this.comboStep];
      const damage = Math.round(base * (time < this.overdriveUntil ? 1.6 : 1));
      this.damageEnemy(enemy, damage, dir * [170, 240, 460][this.comboStep]);
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
        s.setVelocityY(Math.sin((time + s.x) * .004) * 38);
        if (distance < 560 && time >= enemy.cooldown) {
          this.fireProjectile(enemy, 325, 0);
          enemy.cooldown = time + 1500;
        }
      } else if (enemy.type === 'sniper') {
        s.setVelocityX(0);
        if (distance < 760 && time >= enemy.cooldown) {
          this.fireProjectile(enemy, 530, 0);
          enemy.cooldown = time + 1900;
          this.tech = 'AI // TELEGRAPHED PRECISION PROJECTILE';
        }
      } else if (enemy.type === 'boss') {
        enemy.phase = enemy.hp / enemy.maxHp < .34 ? 3 : enemy.hp / enemy.maxHp < .67 ? 2 : 1;
        if (distance > 155) s.setVelocityX(dir * (enemy.phase === 3 ? 105 : 68));
        else s.setVelocityX(0);
        if (time >= enemy.cooldown) {
          if (this.inMeleeRange(enemy, 58, 22)) {
            this.queueMeleeAttack(enemy, 24, dir * 360, 58, 22, enemy.phase === 3 ? 220 : 300, enemy.phase === 3 ? 900 : 1280);
          } else if (distance < 760) {
            const count = enemy.phase;
            for (let i = 0; i < count; i++) this.fireProjectile(enemy, 340 + enemy.phase * 35, (i - (count - 1) / 2) * .15);
            enemy.cooldown = time + (enemy.phase === 3 ? 900 : 1280);
            this.tech = 'BOSS AI // PHASE ' + enemy.phase + ' PATTERN';
          }
        }
      } else {
        const speed = enemy.type === 'guard' ? 105 : 175;
        const stop = enemy.type === 'guard' ? 78 : 60;
        if (distance > stop && distance < 520) s.setVelocityX(dir * speed);
        else s.setVelocityX(0);
        const padding = enemy.type === 'guard' ? 26 : 18;
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

  private fireProjectile(enemy: Enemy, speed: number, spread: number): void {
    const shot = this.projectiles.get(enemy.sprite.x, enemy.sprite.y, 'shot') as Phaser.Physics.Arcade.Sprite;
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
