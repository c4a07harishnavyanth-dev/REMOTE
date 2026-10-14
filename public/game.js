import { connectRoom } from "./app.js";

const COLORS = ["#c1f17a", "#5ee1bc", "#ffbd72", "#d39bf7", "#f47f83", "#80a9ff", "#f4e577", "#ff91cb"];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const BASE_SPEED = 255;
const CRASH_ANIMATION_MS = 1050;

export async function startGame() {
  const canvas = document.querySelector("#game-canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    document.querySelector("#connection-label").textContent = "This browser cannot draw the game.";
    return;
  }
  const overlay = document.querySelector("#race-overlay");
  const gameOverOverlay = document.querySelector("#game-over-overlay");
  const gameOverDistance = document.querySelector("#game-over-distance");
  const restartButton = document.querySelector("#restart-race");
  const connection = document.querySelector("#connection");
  const connectionLabel = document.querySelector("#connection-label");
  const roomCode = document.querySelector("#room-code");
  const qrCode = document.querySelector("#qr-code");
  const qrLoading = document.querySelector("#qr-loading");
  const pairUrl = document.querySelector("#pair-url");
  const playerList = document.querySelector("#player-list");
  const playerCount = document.querySelector("#player-count");
  const gridCount = document.querySelector("#grid-count");
  const distanceLabel = document.querySelector("#distance");
  const bestTimeLabel = document.querySelector("#best-time");
  const latencyLabel = document.querySelector("#game-latency");
  const copyButton = document.querySelector("#copy-code");
  const players = new Map();
  const keys = new Set();
  const obstacles = [];
  const state = { width: 960, height: 600, speed: BASE_SPEED, distance: 0, time: 0, lastFrame: 0, spawnIn: 0, latency: null };
  const joinedAt = performance.now();
  let socket;
  let gameOverStartedAt = null;
  let crashedPlayer = null;
  let crashX = 480;
  let crashColor = COLORS[0];
  let crashParticles = [];

  const resize = () => {
    const bounds = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(bounds.width * dpr));
    canvas.height = Math.max(1, Math.round(bounds.height * dpr));
    context.setTransform(canvas.width / state.width, 0, 0, canvas.height / state.height, 0, 0);
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  const updateRoster = (roster) => {
    const ordered = [...roster].slice(0, 8);
    for (const [id, player] of players) {
      if (!ordered.some((entry) => entry.id === id)) {
        players.delete(id);
      } else if (player.disconnected) {
        player.disconnected = false;
      }
    }
    for (const entry of ordered) {
      if (!players.has(entry.id)) {
        players.set(entry.id, {
          id: entry.id,
          name: entry.name,
          color: COLORS[players.size % COLORS.length],
          x: null,
          tilt: 0,
          throttle: 0,
          brake: false,
          jumpUntil: 0,
          distance: 0
        });
      }
    }
    const count = players.size;
    let index = 0;
    for (const player of players.values()) {
      player.target = (index + 1) / (count + 1);
      if (player.x === null) {
        player.x = player.target;
      }
      index += 1;
    }
    playerCount.textContent = `${count} ${count === 1 ? "pilot" : "pilots"}`;
    gridCount.textContent = String(count);
    playerList.replaceChildren();
    if (count === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-player";
      empty.textContent = "The starting line is yours.";
      playerList.append(empty);
    } else {
      for (const player of players.values()) {
        const item = document.createElement("li");
        item.className = "player-chip";
        const dot = document.createElement("span");
        dot.style.backgroundColor = player.color;
        const label = document.createElement("span");
        label.textContent = player.name;
        item.append(dot, label);
        playerList.append(item);
      }
    }
    overlay.hidden = count > 0;
  };

  const updateLatency = () => {
    latencyLabel.textContent = state.latency === null ? "—" : `${state.latency} ms`;
  };

  try {
    const response = await fetch("/api/rooms", { method: "POST" });
    if (!response.ok) {
      throw new Error(`Room creation failed (HTTP ${response.status}).`);
    }
    const room = await response.json();
    roomCode.textContent = room.code;
    qrCode.src = room.qr;
    qrCode.hidden = false;
    qrLoading.hidden = true;
    pairUrl.textContent = room.controllerUrl.replace(/^https?:\/\//, "");
    pairUrl.title = room.controllerUrl;
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(room.code);
        copyButton.textContent = "✓";
        setTimeout(() => { copyButton.textContent = "▢"; }, 1200);
      } catch (error) {
        console.error("Could not copy room code:", error);
        copyButton.setAttribute("aria-label", `Room code is ${room.code}`);
      }
    });
    socket = connectRoom(room.code, "game", "", (message) => {
      if (message.type === "roster") {
        updateRoster(message.players);
      } else if (message.type === "joined") {
        updateRoster(message.players || []);
      } else if (message.type === "control") {
        const control = message.player;
        const player = players.get(control.id);
        if (!player) {
          return;
        }
        if (control.disconnected) {
          players.delete(control.id);
          updateRoster([...players.values()]);
          return;
        }
        player.tilt = control.tilt;
        player.throttle = control.throttle;
        player.brake = control.brake;
        if (control.jump) {
          player.jumpUntil = performance.now() + 650;
        }
      } else if (message.type === "pong") {
        state.latency = Math.max(0, Date.now() - message.sentAt);
        updateLatency();
      }
    }, (connected, detail) => {
      connection.classList.toggle("connected", connected);
      connectionLabel.textContent = connected ? "Track is live · share the code" : detail || "Reconnecting to the track…";
    });
  } catch (error) {
    console.error("Could not start the race:", error);
    connectionLabel.textContent = "Could not create a room. Refresh to try again.";
    roomCode.textContent = "ERROR";
    qrLoading.textContent = "Could not create a room";
  }

  const onKey = (event) => {
    if (gameOverStartedAt !== null) {
      return;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(event.key)) {
      event.preventDefault();
      keys.add(event.key);
    }
  };
  const onKeyUp = (event) => keys.delete(event.key);
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", () => keys.clear());
  window.addEventListener("pagehide", () => socket?.close(), { once: true });

  const roadLeft = (y) => 155 + y * 0.02;
  const roadRight = (y) => 805 - y * 0.02;

  const spawnObstacle = () => {
    const lane = Math.floor(Math.random() * 3);
    obstacles.push({ y: -100, lane, speed: 0.72 + Math.random() * 0.24, color: ["#dc735f", "#798dc1", "#cfaa61"][Math.floor(Math.random() * 3)] });
  };

  const drawRoad = (time) => {
    const { width, height } = state;
    const scenery = context.createLinearGradient(0, 0, 0, height);
    scenery.addColorStop(0, "#243b31");
    scenery.addColorStop(1, "#13271e");
    context.fillStyle = scenery;
    context.fillRect(0, 0, width, height);

    context.fillStyle = "#0c1813";
    context.beginPath();
    context.moveTo(roadLeft(0), 0);
    context.lineTo(roadRight(0), 0);
    context.lineTo(roadRight(height), height);
    context.lineTo(roadLeft(height), height);
    context.closePath();
    context.fill();

    context.strokeStyle = "#cad9b041";
    context.lineWidth = 3;
    for (let index = 1; index <= 2; index += 1) {
      const x = roadLeft(0) + (roadRight(0) - roadLeft(0)) * (index / 3);
      context.beginPath();
      for (let y = -55 + ((time * 0.3) % 110); y < height + 60; y += 110) {
        context.moveTo(x - y * 0.02, y);
        context.lineTo(x - (y + 55) * 0.02, y + 55);
      }
      context.stroke();
    }

    context.strokeStyle = "#b8c89b60";
    context.lineWidth = 4;
    for (const edge of [-1, 1]) {
      const xTop = edge < 0 ? roadLeft(0) : roadRight(0);
      const xBottom = edge < 0 ? roadLeft(height) : roadRight(height);
      context.beginPath();
      context.moveTo(xTop, 0);
      context.lineTo(xBottom, height);
      context.stroke();
    }

    for (let y = -36 + ((time * 0.9) % 72); y < height; y += 72) {
      const widthAtY = 8 + y * 0.018;
      for (const side of [-1, 1]) {
        const edge = side < 0 ? roadLeft(y) : roadRight(y);
        context.fillStyle = Math.floor((y + 36) / 72) % 2 === 0 ? "#d6dfbc" : "#ed8b73";
        context.fillRect(edge - (side < 0 ? widthAtY : 0), y, widthAtY, 34);
      }
    }
  };

  const drawCar = (x, y, color, size, jumped, damaged, rotation = 0, alpha = 1) => {
    context.save();
    context.translate(x, y);
    context.rotate(rotation);
    context.globalAlpha = alpha;
    if (jumped) {
      context.shadowColor = color;
      context.shadowBlur = 20;
    }
    const w = size * 0.58;
    const h = size;
    context.fillStyle = "#050a08";
    context.fillRect(-w * 0.67, -h * 0.31, w * 0.22, h * 0.25);
    context.fillRect(w * 0.45, -h * 0.31, w * 0.22, h * 0.25);
    context.fillRect(-w * 0.67, h * 0.13, w * 0.22, h * 0.25);
    context.fillRect(w * 0.45, h * 0.13, w * 0.22, h * 0.25);
    context.fillStyle = damaged ? "#e56b60" : color;
    context.beginPath();
    context.roundRect(-w / 2, -h / 2, w, h, [size * 0.16, size * 0.16, size * 0.22, size * 0.22]);
    context.fill();
    context.fillStyle = "#13221b";
    context.beginPath();
    context.roundRect(-w * 0.33, -h * 0.27, w * 0.66, h * 0.29, 5);
    context.fill();
    context.fillStyle = "#f5ddab";
    context.fillRect(-w * 0.33, h * 0.35, w * 0.18, h * 0.06);
    context.fillRect(w * 0.15, h * 0.35, w * 0.18, h * 0.06);
    context.restore();
  };

  const drawCrash = (now) => {
    const age = Math.max(0, now - gameOverStartedAt);
    const progress = Math.min(age / CRASH_ANIMATION_MS, 1);
    const bounce = Math.sin(Math.min(age / 220, 1) * Math.PI) * 22;
    const fadeStart = CRASH_ANIMATION_MS * 0.72;
    const alpha = age > fadeStart ? 1 - (age - fadeStart) / (CRASH_ANIMATION_MS - fadeStart) : 1;
    const rotation = progress * Math.PI * 1.5;
    const size = 78 * (1 + Math.sin(progress * Math.PI) * 0.16);
    drawCar(crashX, 470 - bounce, crashColor, size, false, true, rotation, alpha);

    for (const particle of crashParticles) {
      const travel = particle.speed * progress;
      const x = crashX + Math.cos(particle.angle) * travel;
      const y = 470 + Math.sin(particle.angle) * travel + 42 * progress * progress;
      context.save();
      context.globalAlpha = 1 - progress;
      context.strokeStyle = particle.color;
      context.lineWidth = particle.size;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x - Math.cos(particle.angle) * particle.size * 3, y - Math.sin(particle.angle) * particle.size * 3);
      context.stroke();
      context.restore();
    }
  };

  const draw = (now) => {
    const elapsed = state.lastFrame ? Math.min((now - state.lastFrame) / 1000, 0.06) : 0;
    state.lastFrame = now;
    const racers = [...players.values()];
    if (gameOverStartedAt === null) {
      state.time += elapsed;
      const pace = BASE_SPEED + racers.reduce((boost, player) => boost + player.throttle * 90 - (player.brake ? 90 : 0), 0) / Math.max(1, racers.length);
      state.speed = clamp(pace, 165, 390);
      state.distance += (state.speed * elapsed) / 18;
      state.spawnIn -= elapsed;
      if (state.spawnIn <= 0) {
        spawnObstacle();
        state.spawnIn = 0.85 + Math.random() * 0.8;
      }
      for (const obstacle of obstacles) {
        obstacle.y += state.speed * obstacle.speed * elapsed;
      }
      while (obstacles.length && obstacles[0].y > state.height + 120) {
        obstacles.shift();
      }
    }
    const crashAge = gameOverStartedAt === null ? 0 : now - gameOverStartedAt;
    const shake = gameOverStartedAt !== null ? Math.max(0, 10 * (1 - crashAge / 300)) : 0;
    context.save();
    if (shake > 0) {
      context.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }
    drawRoad(state.time * 100);

    for (const obstacle of obstacles) {
      const y = obstacle.y;
      const center = roadLeft(y) + (roadRight(y) - roadLeft(y)) * ((obstacle.lane + 0.5) / 3);
      const scale = 0.75 + (y / state.height) * 0.45;
      drawCar(center, y, obstacle.color, 61 * scale, false, false);
      if (gameOverStartedAt !== null) {
        continue;
      }
      for (const player of racers) {
        const x = roadLeft(475) + (roadRight(475) - roadLeft(475)) * player.x;
        if (Math.abs(y - 470) < 36 && Math.abs(center - x) < 47 && now > player.jumpUntil) {
          gameOverStartedAt = now;
          crashedPlayer = player;
          crashX = x;
          crashColor = player.color;
          crashParticles = Array.from({ length: 16 }, (_, index) => ({
            angle: (index / 16) * Math.PI * 2 + Math.random() * 0.18,
            speed: 55 + Math.random() * 110,
            size: 2 + Math.random() * 3,
            color: ["#fff0c2", "#ffb171", "#ff786b"][index % 3]
          }));
          keys.clear();
          obstacle.y = state.height + 120;
          break;
        }
      }
    }

    for (let index = 0; index < racers.length; index += 1) {
      const player = racers[index];
      const slotWidth = 1 / racers.length;
      const leftLimit = Math.max(0.04, index * slotWidth + 0.035);
      const rightLimit = Math.min(0.96, (index + 1) * slotWidth - 0.035);
      const steering = player.tilt + (keys.has("ArrowRight") ? 0.6 : 0) - (keys.has("ArrowLeft") ? 0.6 : 0);
      if (gameOverStartedAt === null) {
        player.x = clamp(player.x + steering * elapsed * 0.5, leftLimit, rightLimit);
      }
      const jumping = now < player.jumpUntil;
      const x = roadLeft(475) + (roadRight(475) - roadLeft(475)) * player.x;
      if (player === crashedPlayer) {
        drawCrash(now);
        continue;
      }
      drawCar(x, 470 - (jumping ? 34 : 0), player.color, 78, jumping, false);
      if (jumping) {
        context.fillStyle = `${player.color}80`;
        context.font = "10px 'DM Mono', monospace";
        context.textAlign = "center";
        context.fillText("JUMP!", x, 419);
      }
    }

    if (racers.length === 0) {
      drawCar(480 + (keys.has("ArrowRight") ? 90 : 0) - (keys.has("ArrowLeft") ? 90 : 0), 470, COLORS[0], 78, false, false);
    }
    if (gameOverStartedAt !== null && crashAge < 130) {
      context.fillStyle = `rgba(255, 240, 204, ${(1 - crashAge / 130) * 0.72})`;
      context.fillRect(0, 0, state.width, state.height);
    }
    context.restore();

    const distance = Math.floor(state.distance);
    distanceLabel.innerHTML = `${String(distance).padStart(4, "0")}<span> m</span>`;
    if (distance >= 1000 && !bestTimeLabel.textContent.includes(":")) {
      const seconds = (now - joinedAt) / 1000;
      bestTimeLabel.textContent = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
    }
    if (gameOverStartedAt !== null && crashAge >= CRASH_ANIMATION_MS && gameOverOverlay.hidden) {
      gameOverDistance.textContent = `${distance} m`;
      gameOverOverlay.hidden = false;
    }
    if (gameOverStartedAt === null || crashAge < CRASH_ANIMATION_MS) {
      requestAnimationFrame(draw);
    }
  };

  restartButton.addEventListener("click", () => {
    gameOverStartedAt = null;
    crashedPlayer = null;
    crashParticles = [];
    state.speed = BASE_SPEED;
    state.distance = 0;
    state.time = 0;
    state.lastFrame = performance.now();
    state.spawnIn = 0;
    obstacles.length = 0;
    bestTimeLabel.textContent = "—";
    for (const player of players.values()) {
      player.x = player.target;
      player.tilt = 0;
      player.throttle = 0;
      player.brake = false;
      player.jumpUntil = 0;
    }
    gameOverOverlay.hidden = true;
    requestAnimationFrame(draw);
  });
  requestAnimationFrame(draw);
}
