const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const scoreValue = document.getElementById("scoreValue");
const bestScoreValue = document.getElementById("bestScoreValue");
const stageKillsValue = document.getElementById("stageKillsValue");
const totalKillsValue = document.getElementById("totalKillsValue");

const WIDTH = 480;
const HEIGHT = 480;
const GRID = 24;
const TANK_SIZE = 24;
const BULLET_SIZE = 6;
const PLAYER_SPEED = 120;
const BULLET_SPEED = 250;
const COMBO_WINDOW = 3;
const COMBO_DISPLAY_TIME = 2;
const FLOAT_TEXT_TIME = 1;
const PLAYER_SPAWN = { x: GRID * 9, y: GRID * 17 };
const BASE_POSITION = { x: GRID * 9, y: GRID * 18 };
const HIGH_SCORE_KEY = "tank-battle-high-score";
const ENEMY_SPAWNS = [
  { x: GRID * 1, y: 0 },
  { x: GRID * 9, y: 0 },
  { x: GRID * 17, y: 0 },
];

const DIRS = {
  up: { x: 0, y: -1, angle: -Math.PI / 2 },
  down: { x: 0, y: 1, angle: Math.PI / 2 },
  left: { x: -1, y: 0, angle: Math.PI },
  right: { x: 1, y: 0, angle: 0 },
};

const ENEMY_TYPES = {
  normal: {
    color: "#8f98a3",
    speed: 72,
    fireCooldown: 2,
    hp: 2,
    score: 100,
  },
  fast: {
    color: "#f0c94f",
    speed: 108,
    fireCooldown: 0.5,
    hp: 1,
    score: 150,
  },
  heavy: {
    color: "#d24a43",
    speed: 52,
    fireCooldown: 2,
    hp: 4,
    score: 300,
  },
};

const STAGES = [
  Array(5).fill("normal"),
  [...Array(3).fill("normal"), ...Array(2).fill("fast")],
  [...Array(3).fill("normal"), ...Array(2).fill("fast"), ...Array(2).fill("heavy")],
];

const keys = new Set();

document.addEventListener("keydown", (event) => {
  const code = event.code;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Enter"].includes(code)) {
    event.preventDefault();
  }
  keys.add(code);
});

document.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});

function loadHighScore() {
  try {
    const stored = Number.parseInt(localStorage.getItem(HIGH_SCORE_KEY) ?? "0", 10);
    return Number.isFinite(stored) ? stored : 0;
  } catch {
    return 0;
  }
}

function saveHighScore() {
  try {
    localStorage.setItem(HIGH_SCORE_KEY, String(game.highScore));
  } catch {
    // Ignore localStorage failures in restricted environments.
  }
}

function refreshScorePanel() {
  scoreValue.textContent = String(game.score);
  bestScoreValue.textContent = String(game.highScore);
  stageKillsValue.textContent = String(game.stageKills);
  totalKillsValue.textContent = String(game.totalKills);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function aabb(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function rectOf(entity) {
  return { x: entity.x, y: entity.y, width: entity.width, height: entity.height };
}

function createTile(x, y, type) {
  return {
    x,
    y,
    width: GRID,
    height: GRID,
    type,
    hp: type === "brick" ? 1 : Infinity,
  };
}

function createBase() {
  return {
    x: BASE_POSITION.x,
    y: BASE_POSITION.y,
    width: GRID,
    height: GRID,
    alive: true,
  };
}

function createTank({ x, y, direction, speed, color, fireCooldown, hp, kind, score = 0 }) {
  return {
    x,
    y,
    width: TANK_SIZE,
    height: TANK_SIZE,
    direction,
    moveDirection: direction,
    speed,
    color,
    fireCooldown,
    fireTimer: 0,
    hp,
    maxHp: hp,
    kind,
    score,
    aiMoveTimer: 0,
    spawnShield: 0,
  };
}

function createFloatingText(text, x, y, color = "#fff4b1", size = 22) {
  game.floatingTexts.push({
    text,
    x,
    y,
    color,
    size,
    timeLeft: FLOAT_TEXT_TIME,
    totalTime: FLOAT_TEXT_TIME,
  });
}

function resetCombo() {
  game.comboMultiplier = 1;
  game.comboTimer = 0;
  game.comboDisplayTimer = 0;
  game.comboPulse = 0;
}

function addScore(points, floatingPosition = null) {
  game.score += points;
  if (game.score > game.highScore) {
    game.highScore = game.score;
  }
  if (floatingPosition) {
    createFloatingText(
      `+${points}`,
      floatingPosition.x,
      floatingPosition.y,
      floatingPosition.color,
      floatingPosition.size
    );
  }
  refreshScorePanel();
}

function awardStageBonus() {
  const stageNumber = game.stageIndex + 1;
  addScore(1000 * stageNumber);
  if (stageNumber === STAGES.length) {
    addScore(5000);
  }
}

function finalizeRun(result) {
  if (result === "victory") {
    game.victory = true;
  } else {
    game.gameOver = true;
  }

  if (!game.finalScoreSaved) {
    saveHighScore();
    game.finalScoreSaved = true;
  }
  refreshScorePanel();
}

function registerEnemyKill(enemy) {
  if (game.comboTimer > 0) {
    game.comboMultiplier += 1;
  } else {
    game.comboMultiplier = 1;
  }

  game.comboTimer = COMBO_WINDOW;
  if (game.comboMultiplier > 1) {
    game.comboDisplayTimer = COMBO_DISPLAY_TIME;
    game.comboPulse = 0;
  }

  game.stageKills += 1;
  game.totalKills += 1;
  addScore(enemy.score * game.comboMultiplier, {
    x: enemy.x + enemy.width / 2,
    y: enemy.y,
  });
}

function tileRect(x, y) {
  return { x: x * GRID, y: y * GRID };
}

function buildMap() {
  const tiles = [];
  const placements = [
    ...[
      [4, 2, "brick"],
      [5, 2, "brick"],
      [14, 2, "brick"],
      [15, 2, "brick"],
      [3, 4, "steel"],
      [16, 4, "steel"],
      [2, 6, "grass"],
      [3, 6, "grass"],
      [16, 6, "grass"],
      [17, 6, "grass"],
      [6, 5, "brick"],
      [7, 5, "brick"],
      [12, 5, "brick"],
      [13, 5, "brick"],
      [6, 6, "brick"],
      [13, 6, "brick"],
      [9, 4, "steel"],
      [10, 4, "steel"],
      [5, 8, "brick"],
      [6, 8, "brick"],
      [13, 8, "brick"],
      [14, 8, "brick"],
      [8, 8, "grass"],
      [9, 8, "grass"],
      [10, 8, "grass"],
      [11, 8, "grass"],
      [4, 10, "steel"],
      [15, 10, "steel"],
      [7, 11, "brick"],
      [12, 11, "brick"],
      [7, 12, "brick"],
      [12, 12, "brick"],
      [2, 13, "grass"],
      [3, 13, "grass"],
      [16, 13, "grass"],
      [17, 13, "grass"],
      [6, 14, "brick"],
      [13, 14, "brick"],
      [8, 15, "steel"],
      [11, 15, "steel"],
      [8, 16, "brick"],
      [11, 16, "brick"],
      [9, 16, "brick"],
      [10, 16, "brick"],
      [8, 18, "brick"],
      [10, 18, "brick"],
      [8, 19, "brick"],
      [9, 19, "steel"],
      [10, 19, "brick"],
    ],
  ];

  for (const [tx, ty, type] of placements) {
    const pos = tileRect(tx, ty);
    tiles.push(createTile(pos.x, pos.y, type));
  }
  return tiles;
}

const game = {
  started: false,
  player: null,
  enemies: [],
  bullets: [],
  tiles: [],
  base: createBase(),
  stageIndex: 0,
  pendingSpawns: [],
  stageMessageTimer: 0,
  gameOver: false,
  victory: false,
  score: 0,
  highScore: loadHighScore(),
  stageKills: 0,
  totalKills: 0,
  lives: 3,
  maxConcurrentEnemies: 4,
  comboMultiplier: 1,
  comboTimer: 0,
  comboDisplayTimer: 0,
  comboPulse: 0,
  floatingTexts: [],
  finalScoreSaved: false,
  stageRewardGranted: false,
};

function resetStage(index) {
  game.stageIndex = index;
  game.tiles = buildMap();
  game.base = createBase();
  game.bullets = [];
  game.enemies = [];
  game.pendingSpawns = STAGES[index].map((type, i) => ({
    type,
    delay: i * 0.8,
  }));
  game.stageMessageTimer = 0;
  game.stageRewardGranted = false;
  game.stageKills = 0;
  resetCombo();
  spawnPlayer();
  refreshScorePanel();
}

function spawnPlayer() {
  game.player = createTank({
    x: PLAYER_SPAWN.x,
    y: PLAYER_SPAWN.y,
    direction: "up",
    speed: PLAYER_SPEED,
    color: "#53d769",
    fireCooldown: 0.35,
    hp: 1,
    kind: "player",
  });
  game.player.spawnShield = 2;
}

function startNewGame() {
  game.started = true;
  game.score = 0;
  game.stageKills = 0;
  game.totalKills = 0;
  game.lives = 3;
  game.gameOver = false;
  game.victory = false;
  game.floatingTexts = [];
  game.finalScoreSaved = false;
  resetStage(0);
}

function getMovementInput() {
  if (keys.has("KeyW") || keys.has("ArrowUp")) {
    return "up";
  }
  if (keys.has("KeyS") || keys.has("ArrowDown")) {
    return "down";
  }
  if (keys.has("KeyA") || keys.has("ArrowLeft")) {
    return "left";
  }
  if (keys.has("KeyD") || keys.has("ArrowRight")) {
    return "right";
  }
  return null;
}

function getBlockingRects() {
  const solidTiles = game.tiles.filter((tile) => tile.type === "brick" || tile.type === "steel");
  const rects = solidTiles.map(rectOf);
  if (game.base.alive) {
    rects.push(rectOf(game.base));
  }
  return rects;
}

function resolveTankMove(tank, direction, dt) {
  const dir = DIRS[direction];
  const next = {
    x: clamp(tank.x + dir.x * tank.speed * dt, 0, WIDTH - tank.width),
    y: clamp(tank.y + dir.y * tank.speed * dt, 0, HEIGHT - tank.height),
    width: tank.width,
    height: tank.height,
  };

  for (const obstacle of getBlockingRects()) {
    if (aabb(next, obstacle)) {
      return false;
    }
  }

  const tanks = tank.kind === "player" ? game.enemies : [game.player, ...game.enemies];
  for (const other of tanks) {
    if (!other || other === tank) {
      continue;
    }
    if (aabb(next, rectOf(other))) {
      return false;
    }
  }

  tank.x = next.x;
  tank.y = next.y;
  return true;
}

function spawnEnemy(type) {
  const spawn = ENEMY_SPAWNS[Math.floor(Math.random() * ENEMY_SPAWNS.length)];
  const stats = ENEMY_TYPES[type];
  const enemy = createTank({
    x: spawn.x,
    y: spawn.y,
    direction: "down",
    speed: stats.speed,
    color: stats.color,
    fireCooldown: stats.fireCooldown,
    hp: stats.hp,
    kind: "enemy",
    score: stats.score,
  });
  enemy.aiMoveTimer = 0.6;

  const playerBlocked = game.player ? aabb(rectOf(enemy), rectOf(game.player)) : false;
  if (!game.enemies.some((other) => aabb(rectOf(enemy), rectOf(other))) && !playerBlocked) {
    game.enemies.push(enemy);
  } else {
    game.pendingSpawns.push({ type, delay: 0.75 });
  }
}

function muzzlePosition(tank) {
  const centerX = tank.x + tank.width / 2 - BULLET_SIZE / 2;
  const centerY = tank.y + tank.height / 2 - BULLET_SIZE / 2;
  switch (tank.direction) {
    case "up":
      return { x: centerX, y: tank.y - BULLET_SIZE };
    case "down":
      return { x: centerX, y: tank.y + tank.height };
    case "left":
      return { x: tank.x - BULLET_SIZE, y: centerY };
    default:
      return { x: tank.x + tank.width, y: centerY };
  }
}

function fireBullet(owner) {
  if (owner.fireTimer > 0) {
    return;
  }
  owner.fireTimer = owner.fireCooldown;
  const start = muzzlePosition(owner);
  const dir = DIRS[owner.direction];
  game.bullets.push({
    x: start.x,
    y: start.y,
    width: BULLET_SIZE,
    height: BULLET_SIZE,
    direction: owner.direction,
    vx: dir.x * BULLET_SPEED,
    vy: dir.y * BULLET_SPEED,
    owner: owner.kind,
  });
}

function updatePlayer(dt) {
  const player = game.player;
  player.fireTimer = Math.max(0, player.fireTimer - dt);
  player.spawnShield = Math.max(0, player.spawnShield - dt);

  const direction = getMovementInput();
  if (direction) {
    player.direction = direction;
    resolveTankMove(player, direction, dt);
  }

  if (keys.has("Space")) {
    fireBullet(player);
  }
}

function pickEnemyDirection(enemy) {
  const choices = ["up", "down", "left", "right"];
  const preferredX = game.player.x + game.player.width / 2 < enemy.x + enemy.width / 2 ? "left" : "right";
  const preferredY = game.player.y + game.player.height / 2 < enemy.y + enemy.height / 2 ? "up" : "down";
  if (Math.random() < 0.5) {
    choices.unshift(preferredX, preferredY);
  } else {
    choices.unshift(preferredY, preferredX);
  }

  for (const dir of choices) {
    const before = { x: enemy.x, y: enemy.y };
    if (resolveTankMove(enemy, dir, 0.05)) {
      enemy.x = before.x;
      enemy.y = before.y;
      return dir;
    }
  }
  return enemy.direction;
}

function aimAtPlayer(enemy) {
  const dx = game.player.x - enemy.x;
  const dy = game.player.y - enemy.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    enemy.direction = dx < 0 ? "left" : "right";
  } else {
    enemy.direction = dy < 0 ? "up" : "down";
  }
}

function updateEnemies(dt) {
  for (const enemy of game.enemies) {
    enemy.fireTimer = Math.max(0, enemy.fireTimer - dt);
    enemy.aiMoveTimer -= dt;
    if (enemy.aiMoveTimer <= 0) {
      enemy.moveDirection = pickEnemyDirection(enemy);
      enemy.aiMoveTimer = 0.7 + Math.random() * 1.2;
    }

    const moved = resolveTankMove(enemy, enemy.moveDirection, dt);
    if (!moved) {
      enemy.moveDirection = pickEnemyDirection(enemy);
      enemy.aiMoveTimer = 0.35;
    }

    aimAtPlayer(enemy);
    if (Math.random() < 0.015 || enemy.fireTimer <= 0) {
      fireBullet(enemy);
    }
  }
}

function removeTile(tile) {
  const index = game.tiles.indexOf(tile);
  if (index >= 0) {
    game.tiles.splice(index, 1);
  }
}

function damagePlayer() {
  if (game.player.spawnShield > 0) {
    return;
  }
  game.lives -= 1;
  resetCombo();
  if (game.lives <= 0) {
    finalizeRun("gameOver");
    return;
  }
  spawnPlayer();
}

function updateBullets(dt) {
  for (let i = game.bullets.length - 1; i >= 0; i -= 1) {
    const bullet = game.bullets[i];
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;

    if (
      bullet.x < -bullet.width ||
      bullet.x > WIDTH ||
      bullet.y < -bullet.height ||
      bullet.y > HEIGHT
    ) {
      game.bullets.splice(i, 1);
      continue;
    }

    let destroyed = false;
    for (const tile of game.tiles) {
      if (tile.type === "grass") {
        continue;
      }
      if (aabb(bullet, rectOf(tile))) {
        if (tile.type === "brick") {
          tile.hp -= 1;
          if (tile.hp <= 0) {
            removeTile(tile);
          }
        }
        destroyed = true;
        break;
      }
    }

    if (destroyed) {
      game.bullets.splice(i, 1);
      continue;
    }

    if (game.base.alive && aabb(bullet, rectOf(game.base))) {
      game.base.alive = false;
      finalizeRun("gameOver");
      game.bullets.splice(i, 1);
      continue;
    }

    if (bullet.owner === "player") {
      let hitEnemy = false;
      for (let j = game.enemies.length - 1; j >= 0; j -= 1) {
        const enemy = game.enemies[j];
        if (aabb(bullet, rectOf(enemy))) {
          enemy.hp -= 1;
          hitEnemy = true;
          if (enemy.hp <= 0) {
            registerEnemyKill(enemy);
            game.enemies.splice(j, 1);
          }
          break;
        }
      }
      if (hitEnemy) {
        game.bullets.splice(i, 1);
      }
    } else if (game.player && aabb(bullet, rectOf(game.player))) {
      damagePlayer();
      game.bullets.splice(i, 1);
    }
  }
}

function updateSpawns(dt) {
  if (game.enemies.length >= game.maxConcurrentEnemies || game.pendingSpawns.length === 0) {
    return;
  }
  for (let i = 0; i < game.pendingSpawns.length; i += 1) {
    game.pendingSpawns[i].delay -= dt;
  }
  const readyIndex = game.pendingSpawns.findIndex((spawn) => spawn.delay <= 0);
  if (readyIndex >= 0) {
    const [spawn] = game.pendingSpawns.splice(readyIndex, 1);
    spawnEnemy(spawn.type);
  }
}

function updateCombo(dt) {
  if (game.comboTimer > 0) {
    game.comboTimer = Math.max(0, game.comboTimer - dt);
    if (game.comboTimer === 0) {
      game.comboMultiplier = 1;
    }
  }

  if (game.comboDisplayTimer > 0) {
    game.comboDisplayTimer = Math.max(0, game.comboDisplayTimer - dt);
    game.comboPulse += dt;
  }
}

function updateFloatingTexts(dt) {
  for (let i = game.floatingTexts.length - 1; i >= 0; i -= 1) {
    const text = game.floatingTexts[i];
    text.timeLeft -= dt;
    text.y -= 32 * dt;
    if (text.timeLeft <= 0) {
      game.floatingTexts.splice(i, 1);
    }
  }
}

function updateStageState(dt) {
  if (game.stageMessageTimer > 0) {
    game.stageMessageTimer -= dt;
    if (game.stageMessageTimer <= 0) {
      if (game.stageIndex === STAGES.length - 1) {
        finalizeRun("victory");
      } else {
        resetStage(game.stageIndex + 1);
      }
    }
    return;
  }

  if (
    game.pendingSpawns.length === 0 &&
    game.enemies.length === 0 &&
    !game.victory &&
    !game.gameOver &&
    !game.stageRewardGranted
  ) {
    game.stageRewardGranted = true;
    awardStageBonus();
    game.stageMessageTimer = 2;
    resetCombo();
  }
}

function update(dt) {
  if (!game.started) {
    if (keys.has("Enter")) {
      startNewGame();
    }
    return;
  }

  updateCombo(dt);
  updateFloatingTexts(dt);

  if (game.gameOver || game.victory) {
    if (keys.has("Enter")) {
      startNewGame();
    }
    return;
  }

  if (game.stageMessageTimer > 0) {
    updateStageState(dt);
    return;
  }

  updatePlayer(dt);
  updateEnemies(dt);
  updateBullets(dt);
  updateSpawns(dt);
  updateStageState(dt);
}

function drawTank(tank) {
  if (tank.kind === "player" && tank.spawnShield > 0 && Math.floor(performance.now() / 80) % 2 === 0) {
    return;
  }

  ctx.save();
  ctx.translate(tank.x + tank.width / 2, tank.y + tank.height / 2);
  ctx.rotate(DIRS[tank.direction].angle);

  ctx.fillStyle = tank.color;
  ctx.fillRect(-10, -10, 20, 20);
  ctx.fillStyle = "#1d221f";
  ctx.fillRect(-4, -12, 8, 10);
  ctx.fillRect(-3, -16, 6, 18);

  if (tank.kind === "enemy" && tank.maxHp > 1) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillRect(-10, 11, 20, 3);
    ctx.fillStyle = "#dff6d8";
    ctx.fillRect(-10, 11, (20 * tank.hp) / tank.maxHp, 3);
  }
  ctx.restore();
}

function drawTile(tile) {
  if (tile.type === "brick") {
    ctx.fillStyle = "#8b5a35";
    ctx.fillRect(tile.x, tile.y, GRID, GRID);
    ctx.strokeStyle = "#b97848";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tile.x, tile.y + GRID / 2);
    ctx.lineTo(tile.x + GRID, tile.y + GRID / 2);
    ctx.moveTo(tile.x + GRID / 2, tile.y);
    ctx.lineTo(tile.x + GRID / 2, tile.y + GRID);
    ctx.stroke();
  } else if (tile.type === "steel") {
    ctx.fillStyle = "#4a5159";
    ctx.fillRect(tile.x, tile.y, GRID, GRID);
    ctx.strokeStyle = "#838c96";
    ctx.strokeRect(tile.x + 2, tile.y + 2, GRID - 4, GRID - 4);
  } else if (tile.type === "grass") {
    ctx.fillStyle = "rgba(26, 92, 41, 0.88)";
    ctx.fillRect(tile.x, tile.y, GRID, GRID);
    ctx.fillStyle = "rgba(56, 136, 68, 0.75)";
    ctx.fillRect(tile.x + 4, tile.y + 2, 4, 18);
    ctx.fillRect(tile.x + 12, tile.y + 4, 4, 16);
    ctx.fillRect(tile.x + 18, tile.y + 1, 3, 19);
  }
}

function drawBase() {
  if (!game.base.alive) {
    return;
  }
  const cx = game.base.x + GRID / 2;
  const cy = game.base.y + GRID / 2;
  const outer = GRID / 2 - 2;
  const inner = outer / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = "#3b83f6";
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (Math.PI / 5) * i;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBullets() {
  for (const bullet of game.bullets) {
    ctx.fillStyle = bullet.owner === "player" ? "#f5f2cb" : "#ffb3ab";
    ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
  }
}

function drawFloatingTexts() {
  ctx.save();
  ctx.textAlign = "center";
  for (const text of game.floatingTexts) {
    const alpha = clamp(text.timeLeft / text.totalTime, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = text.color;
    ctx.font = `bold ${text.size}px Trebuchet MS`;
    ctx.fillText(text.text, text.x, text.y);
  }
  ctx.restore();
}

function drawComboIndicator() {
  if (game.comboDisplayTimer <= 0 || game.comboMultiplier <= 1) {
    return;
  }

  const fade = game.comboDisplayTimer < 0.35 ? game.comboDisplayTimer / 0.35 : 1;
  const pulseProgress = Math.min(game.comboPulse / 0.35, 1);
  const scale = 0.9 + Math.sin(pulseProgress * Math.PI) * 0.28;

  ctx.save();
  ctx.translate(WIDTH / 2, HEIGHT / 2 - 58);
  ctx.scale(scale, scale);
  ctx.globalAlpha = fade;
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff2a8";
  ctx.font = "bold 34px Trebuchet MS";
  ctx.fillText(`x${game.comboMultiplier}`, 0, 0);
  ctx.font = "bold 15px Trebuchet MS";
  ctx.fillStyle = "#ffd46b";
  ctx.fillText("COMBO", 0, 22);
  ctx.restore();
}

function drawHUD() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(0, 0, 220, 64);
  ctx.fillStyle = "#f7f5d7";
  ctx.font = "14px Trebuchet MS";
  const remainingEnemies = game.enemies.length + game.pendingSpawns.length;
  ctx.fillText(`STAGE: ${game.stageIndex + 1}`, 12, 20);
  ctx.fillText(`LIVES: ${game.lives}`, 12, 40);
  ctx.fillText(`ENEMIES: ${remainingEnemies}`, 110, 20);
  ctx.fillText(`CHAIN: x${game.comboMultiplier}`, 110, 40);
}

function drawOverlay() {
  if (!(game.stageMessageTimer > 0 || game.gameOver || game.victory || !game.started)) {
    return;
  }

  ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#f4f1d0";
  ctx.textAlign = "center";

  if (!game.started) {
    ctx.font = "bold 34px Trebuchet MS";
    ctx.fillText("TANK BATTLE", WIDTH / 2, HEIGHT / 2 - 54);
    ctx.font = "20px Trebuchet MS";
    ctx.fillText(`BEST SCORE: ${game.highScore}`, WIDTH / 2, HEIGHT / 2 - 12);
    ctx.font = "18px Trebuchet MS";
    ctx.fillText("WASD / Arrow Keys to Move", WIDTH / 2, HEIGHT / 2 + 28);
    ctx.fillText("Space to Fire", WIDTH / 2, HEIGHT / 2 + 56);
    ctx.fillText("Press Enter to Start", WIDTH / 2, HEIGHT / 2 + 96);
  } else if (game.gameOver) {
    ctx.font = "bold 34px Trebuchet MS";
    ctx.fillText("GAME OVER", WIDTH / 2, HEIGHT / 2 - 16);
    ctx.font = "20px Trebuchet MS";
    ctx.fillText(`FINAL SCORE: ${game.score}`, WIDTH / 2, HEIGHT / 2 + 20);
    ctx.fillText(`BEST SCORE: ${game.highScore}`, WIDTH / 2, HEIGHT / 2 + 48);
    ctx.fillText("PRESS ENTER TO RESTART", WIDTH / 2, HEIGHT / 2 + 86);
  } else if (game.victory) {
    ctx.font = "bold 34px Trebuchet MS";
    ctx.fillText("VICTORY", WIDTH / 2, HEIGHT / 2 - 16);
    ctx.font = "20px Trebuchet MS";
    ctx.fillText(`FINAL SCORE: ${game.score}`, WIDTH / 2, HEIGHT / 2 + 20);
    ctx.fillText(`BEST SCORE: ${game.highScore}`, WIDTH / 2, HEIGHT / 2 + 48);
    ctx.fillText("PRESS ENTER TO RESTART", WIDTH / 2, HEIGHT / 2 + 86);
  } else {
    ctx.font = "bold 34px Trebuchet MS";
    ctx.fillText(`STAGE ${game.stageIndex + 1} CLEAR`, WIDTH / 2, HEIGHT / 2 - 10);
    ctx.font = "18px Trebuchet MS";
    ctx.fillText(`BONUS +${1000 * (game.stageIndex + 1)}`, WIDTH / 2, HEIGHT / 2 + 28);
    if (game.stageIndex === STAGES.length - 1) {
      ctx.fillText("ALL CLEAR BONUS +5000", WIDTH / 2, HEIGHT / 2 + 56);
    }
  }

  ctx.textAlign = "start";
}

function render() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#162016";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  for (const tile of game.tiles.filter((tile) => tile.type !== "grass")) {
    drawTile(tile);
  }

  drawBase();
  if (game.player) {
    drawTank(game.player);
  }
  for (const enemy of game.enemies) {
    drawTank(enemy);
  }
  drawBullets();

  for (const tile of game.tiles.filter((tile) => tile.type === "grass")) {
    drawTile(tile);
  }

  drawFloatingTexts();
  drawComboIndicator();
  drawHUD();
  drawOverlay();
}

let lastTime = performance.now();

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

refreshScorePanel();
requestAnimationFrame(loop);
