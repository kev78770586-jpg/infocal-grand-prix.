/**
 * INFOCAL GRAND PRIX - CLIENT GAME ENGINE (MARIO KART HUD & DRIFTING EDITION)
 * Stack: HTML5 Canvas, Vanilla Modular JS, Socket.io, Web Audio API
 *
 * Características Clave:
 *  - Interfaz HUD estilo Mario Kart superpuesta (Posición 1st/2nd, Laps, Cronómetro, Radar)
 *  - Físicas Top-Down con Heading y Velocity desacoplados (Drifting con barra espaciadora)
 *  - Rebote del 50% de velocidad contra bordes azules corporativos (#004b8d)
 *  - Cámara dinámica de persecución (Chase Cam) centrada permanentemente en el auto
 *  - LERP a 60/120 FPS para suavidad absoluta en multijugador
 *  - Bot IA humano con Waypoints, Look-Ahead braking y 5% de error
 *  - Identidad institucional INFOCAL (Azul #004b8d, Rojo #dd1321, Pasto #c2c9dd)
 */

// ==========================================
// 1. CONSTANTES Y PRESETS DE CIRCUITOS
// ==========================================
const TRACK_PRESETS = {
  gp: {
    id: 'gp',
    name: 'Gran Premio INFOCAL',
    difficulty: 'Media (Técnico)',
    keypoints: [
      { x: 380, y: 780 }, { x: 650, y: 780 }, { x: 920, y: 780 },
      { x: 1140, y: 720 }, { x: 1250, y: 570 }, { x: 1250, y: 390 },
      { x: 1140, y: 220 }, { x: 970, y: 150 }, { x: 810, y: 200 },
      { x: 710, y: 310 }, { x: 570, y: 340 }, { x: 440, y: 240 },
      { x: 310, y: 160 }, { x: 180, y: 250 }, { x: 140, y: 440 },
      { x: 140, y: 640 }, { x: 230, y: 740 }
    ],
    startGrid: [
      { x: 340, y: 760, angle: 0 },
      { x: 290, y: 800, angle: 0 }
    ]
  },
  speed: {
    id: 'speed',
    name: 'Speed Ring Oval INFOCAL',
    difficulty: 'Fácil (Alta Velocidad)',
    keypoints: [
      { x: 380, y: 780 }, { x: 700, y: 780 }, { x: 1050, y: 780 },
      { x: 1240, y: 650 }, { x: 1240, y: 350 }, { x: 1050, y: 180 },
      { x: 700, y: 180 }, { x: 350, y: 180 }, { x: 160, y: 350 },
      { x: 160, y: 650 }, { x: 250, y: 750 }
    ],
    startGrid: [
      { x: 340, y: 760, angle: 0 },
      { x: 290, y: 800, angle: 0 }
    ]
  },
  drift: {
    id: 'drift',
    name: 'Autódromo Pro Drift',
    difficulty: 'Difícil (Horquillas y Derrape)',
    keypoints: [
      { x: 380, y: 780 }, { x: 620, y: 780 }, { x: 850, y: 750 },
      { x: 1020, y: 640 }, { x: 1180, y: 480 }, { x: 1240, y: 300 },
      { x: 1100, y: 160 }, { x: 900, y: 220 }, { x: 800, y: 400 },
      { x: 680, y: 440 }, { x: 600, y: 260 }, { x: 460, y: 160 },
      { x: 320, y: 240 }, { x: 240, y: 420 }, { x: 150, y: 560 },
      { x: 180, y: 720 }, { x: 260, y: 760 }
    ],
    startGrid: [
      { x: 340, y: 760, angle: 0 },
      { x: 290, y: 800, angle: 0 }
    ]
  }
};

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
  };
}

function buildTrackGeometry(keypoints, samplesPerSegment = 8, trackWidth = 92) {
  const rawWaypoints = [];
  const n = keypoints.length;
  for (let i = 0; i < n; i++) {
    const p0 = keypoints[(i - 1 + n) % n];
    const p1 = keypoints[i];
    const p2 = keypoints[(i + 1) % n];
    const p3 = keypoints[(i + 2) % n];
    for (let s = 0; s < samplesPerSegment; s++) {
      rawWaypoints.push(catmullRom(p0, p1, p2, p3, s / samplesPerSegment));
    }
  }

  const innerBarrier = [];
  const outerBarrier = [];
  const halfW = trackWidth / 2;
  const count = rawWaypoints.length;

  for (let i = 0; i < count; i++) {
    const prev = rawWaypoints[(i - 1 + count) % count];
    const next = rawWaypoints[(i + 1) % count];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;

    innerBarrier.push({
      x: rawWaypoints[i].x - nx * halfW,
      y: rawWaypoints[i].y - ny * halfW
    });
    outerBarrier.push({
      x: rawWaypoints[i].x + nx * halfW,
      y: rawWaypoints[i].y + ny * halfW
    });
  }

  function getGate(index, span = halfW + 12) {
    const pt = rawWaypoints[index % count];
    const prev = rawWaypoints[(index - 1 + count) % count];
    const next = rawWaypoints[(index + 1) % count];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    return {
      x1: pt.x - nx * span,
      y1: pt.y - ny * span,
      x2: pt.x + nx * span,
      y2: pt.y + ny * span,
      cx: pt.x,
      cy: pt.y
    };
  }

  const gates = {
    FINISH: getGate(0),
    CP1: getGate(Math.floor(count * 0.28)),
    CP2: getGate(Math.floor(count * 0.55)),
    CP3: getGate(Math.floor(count * 0.80))
  };

  return {
    waypoints: rawWaypoints,
    innerBarrier,
    outerBarrier,
    gates
  };
}

function segmentsIntersect(a, b, c, d) {
  const det = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (det === 0) return false;
  const lambda = ((d.y - c.y) * (d.x - a.x) + (c.x - d.x) * (d.y - a.y)) / det;
  const gamma = ((a.y - b.y) * (d.x - a.x) + (b.x - a.x) * (d.y - a.y)) / det;
  return (0 <= lambda && lambda <= 1) && (0 <= gamma && gamma <= 1);
}

function distToSegmentSquared(p, v, w) {
  const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
  if (l2 === 0) return { distSq: (p.x - v.x) ** 2 + (p.y - v.y) ** 2, nx: 0, ny: 0, dist: 0 };
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = v.x + t * (w.x - v.x);
  const projY = v.y + t * (w.y - v.y);
  const dx = p.x - projX;
  const dy = p.y - projY;
  const dist = Math.hypot(dx, dy) || 1;
  return {
    distSq: dx * dx + dy * dy,
    dist,
    nx: dx / dist,
    ny: dy / dist
  };
}

function formatTime(ms) {
  if (typeof ms !== 'number' || ms < 0 || isNaN(ms)) return '00:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centis = Math.floor((ms % 1000) / 10);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return `${pad(minutes)}:${pad(seconds)}:${pad(centis)}`;
}

function drawRoundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// ==========================================
// 2. SISTEMA DE AUDIO PROCEDURAL (WEB AUDIO)
// ==========================================
class SoundFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineGain = null;
    this.engineOsc = null;
    this.skidGain = null;
    this.skidNoise = null;
    this.initAudioContext();
  }

  initAudioContext() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.setupEngine();
        this.setupSkid();
      }
    } catch (e) {
      console.warn('AudioContext no soportado:', e);
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setupEngine() {
    if (!this.ctx) return;
    this.engineOsc = this.ctx.createOscillator();
    this.engineGain = this.ctx.createGain();

    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.setValueAtTime(65, this.ctx.currentTime);
    this.engineGain.gain.setValueAtTime(0.001, this.ctx.currentTime);

    // Filtro pasa-bajas para un sonido de motor más profundo
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(450, this.ctx.currentTime);

    this.engineOsc.connect(filter);
    filter.connect(this.engineGain);
    this.engineGain.connect(this.ctx.destination);
    this.engineOsc.start();
  }

  setupSkid() {
    if (!this.ctx) return;
    // Ruido blanco para chirrido de llantas
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    this.skidNoise = this.ctx.createBufferSource();
    this.skidNoise.buffer = noiseBuffer;
    this.skidNoise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, this.ctx.currentTime);
    filter.Q.setValueAtTime(3.5, this.ctx.currentTime);

    this.skidGain = this.ctx.createGain();
    this.skidGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);

    this.skidNoise.connect(filter);
    filter.connect(this.skidGain);
    this.skidGain.connect(this.ctx.destination);
    this.skidNoise.start();
  }

  updateEngine(speed, maxSpeed = 9.2) {
    if (!this.ctx || this.muted || !this.engineOsc) return;
    const norm = Math.min(1.0, speed / maxSpeed);
    const freq = 60 + norm * 260;
    const vol = 0.04 + norm * 0.12;
    this.engineOsc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.06);
    this.engineGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.06);
  }

  updateSkid(isDrifting) {
    if (!this.ctx || this.muted || !this.skidGain) return;
    const targetVol = isDrifting ? 0.14 : 0.0001;
    this.skidGain.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.04);
  }

  playCollision() {
    if (!this.ctx || this.muted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(35, this.ctx.currentTime + 0.16);
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.16);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.18);
  }

  playBeep(isHigh = false) {
    if (!this.ctx || this.muted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isHigh ? 880 : 440, this.ctx.currentTime);
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.28);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.3);
  }

  playVictory() {
    if (!this.ctx || this.muted) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime + idx * 0.12);
      gain.gain.setValueAtTime(0.25, this.ctx.currentTime + idx * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + idx * 0.12 + 0.35);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(this.ctx.currentTime + idx * 0.12);
      osc.stop(this.ctx.currentTime + idx * 0.12 + 0.4);
    });
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) {
      if (this.engineGain) this.engineGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      if (this.skidGain) this.skidGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    }
    return this.muted;
  }
}

// ==========================================
// 3. CAPTURA DE TECLADO / INPUT MANAGER
// ==========================================
class InputManager {
  constructor(onInputsChange) {
    this.inputs = { up: false, down: false, left: false, right: false, space: false };
    this.onInputsChange = onInputsChange;
    this.setupListeners();
  }

  setupListeners() {
    window.addEventListener('keydown', (e) => this.handleKey(e, true));
    window.addEventListener('keyup', (e) => this.handleKey(e, false));
  }

  handleKey(e, isPressed) {
    let changed = false;
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        if (this.inputs.up !== isPressed) { this.inputs.up = isPressed; changed = true; }
        e.preventDefault();
        break;
      case 'KeyS':
      case 'ArrowDown':
        if (this.inputs.down !== isPressed) { this.inputs.down = isPressed; changed = true; }
        e.preventDefault();
        break;
      case 'KeyA':
      case 'ArrowLeft':
        if (this.inputs.left !== isPressed) { this.inputs.left = isPressed; changed = true; }
        e.preventDefault();
        break;
      case 'KeyD':
      case 'ArrowRight':
        if (this.inputs.right !== isPressed) { this.inputs.right = isPressed; changed = true; }
        e.preventDefault();
        break;
      case 'Space':
        if (this.inputs.space !== isPressed) { this.inputs.space = isPressed; changed = true; }
        e.preventDefault();
        break;
      case 'KeyC':
        if (isPressed && !e.repeat && window.gameEngine) {
          window.gameEngine.toggleCamera();
        }
        break;
    }

    if (changed && this.onInputsChange) {
      this.onInputsChange({ ...this.inputs });
    }
  }
}

// ==========================================
// 4. EFECTOS VISUALES (SKID MARKS Y CHISPAS)
// ==========================================
class VFXManager {
  constructor() {
    this.skids = [];
    this.sparks = [];
    this.maxSkids = 280;
  }

  addSkidSegment(p1, p2, opacity = 0.6) {
    this.skids.push({
      x1: p1.x, y1: p1.y,
      x2: p2.x, y2: p2.y,
      opacity: opacity,
      life: 1.0
    });
    if (this.skids.length > this.maxSkids) {
      this.skids.shift();
    }
  }

  spawnSparks(x, y, count = 12) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 4.5;
      this.sparks.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: Math.random() > 0.4 ? '#ffcc00' : '#ff4400',
        life: 1.0,
        decay: 0.04 + Math.random() * 0.05
      });
    }
  }

  updateAndDraw(ctx, dt) {
    // 1. Dibujar Skid Marks en el asfalto
    for (let i = this.skids.length - 1; i >= 0; i--) {
      const s = this.skids[i];
      s.life -= dt * 0.00012; // Se desvanecen gradualmente
      if (s.life <= 0) {
        this.skids.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.strokeStyle = `rgba(10, 12, 16, ${s.opacity * s.life})`;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // 2. Dibujar Chispas de Colisión
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i];
      sp.x += sp.vx;
      sp.y += sp.vy;
      sp.life -= sp.decay;
      if (sp.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 2.5 * sp.life, 0, Math.PI * 2);
      ctx.fillStyle = sp.color;
      ctx.shadowColor = sp.color;
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.restore();
    }
  }
}

// ==========================================
// 5. CLASE DE VEHÍCULO CLIENTE (LERP & FÍSICAS)
// ==========================================
class ClientCar {
  constructor(id, data = {}) {
    this.id = id;
    this.playerNumber = data.playerNumber || 1;
    this.isBot = !!data.isBot;
    this.name = data.name || (this.isBot ? 'INFOCAL Bot AI' : `Piloto ${this.playerNumber}`);
    this.color = data.color || (this.playerNumber === 1 ? '#004b8d' : '#dd1321');

    // Posición y orientación actuales
    this.x = data.x || 340;
    this.y = data.y || 760;
    this.prevX = this.x;
    this.prevY = this.y;
    this.angle = data.angle || 0;
    this.vx = data.vx || 0;
    this.vy = data.vy || 0;
    this.speed = data.speed || 0;

    // Destinos LERP recibidos del servidor
    this.targetX = this.x;
    this.targetY = this.y;
    this.targetAngle = this.angle;

    // Estado de derrape y colisión
    this.isDrifting = !!data.isDrifting;
    this.justCollided = false;

    // Vueltas y checkpoints
    this.laps = data.laps || 0;
    this.nextCheckpoint = data.nextCheckpoint || 1;
    this.lapStartTime = Date.now();
    this.currentLapTime = 0;
    this.bestLapTime = null;
    this.finished = false;

    // Físicas locales
    this.inputs = { up: false, down: false, left: false, right: false, space: false };
    this.acceleration = 0.44;
    this.reverseAcc = 0.22;
    this.maxSpeed = 9.2;
    this.drag = 0.982;
    this.turnSpeed = 0.068;
    this.gripNormal = 0.88;
    this.gripDrift = 0.32;

    // Bot IA local
    this.botCurrentWaypoint = 0;
    this.botLookAhead = 4;
    this.botNoiseTimer = 0;
    this.botErrorNoise = 0;

    // Ruedas para skid marks
    this.prevTireL = null;
    this.prevTireR = null;
  }

  updateFromServer(data) {
    this.targetX = data.x;
    this.targetY = data.y;
    this.targetAngle = data.angle;
    this.vx = data.vx;
    this.vy = data.vy;
    this.speed = data.speed;
    this.isDrifting = data.isDrifting;
    this.justCollided = data.justCollided;
    this.laps = data.laps;
    this.nextCheckpoint = data.nextCheckpoint;
    this.currentLapTime = data.currentLapTime;
    if (data.bestLapTime) this.bestLapTime = data.bestLapTime;
    this.finished = data.finished;
  }

  interpolate(alpha) {
    this.x += (this.targetX - this.x) * alpha;
    this.y += (this.targetY - this.y) * alpha;

    // LERP angular con envoltura [-PI, PI]
    let diff = this.targetAngle - this.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.angle += diff * alpha;
  }

  updateLocalPhysics(trackData, controlsLocked) {
    this.prevX = this.x;
    this.prevY = this.y;
    this.justCollided = false;

    if (!controlsLocked && !this.finished) {
      const currentSpeed = Math.hypot(this.vx, this.vy);
      const speedFactor = Math.min(1.0, currentSpeed / 2.0);
      if (this.inputs.left) this.angle -= this.turnSpeed * (speedFactor + 0.15);
      if (this.inputs.right) this.angle += this.turnSpeed * (speedFactor + 0.15);

      const headingX = Math.cos(this.angle);
      const headingY = Math.sin(this.angle);

      if (this.inputs.up) {
        this.vx += headingX * this.acceleration;
        this.vy += headingY * this.acceleration;
      }
      if (this.inputs.down) {
        this.vx -= headingX * this.reverseAcc;
        this.vy -= headingY * this.reverseAcc;
      }

      // Descomposición Heading / Velocity para Derrape (Drifting)
      const fwdX = headingX;
      const fwdY = headingY;
      const latX = -fwdY;
      const latY = fwdX;

      const fwdVel = this.vx * fwdX + this.vy * fwdY;
      const latVel = this.vx * latX + this.vy * latY;

      const slideAngle = Math.abs(latVel);
      this.isDrifting = this.inputs.space || (slideAngle > 2.4 && currentSpeed > 4.5);

      const lateralGrip = this.isDrifting ? this.gripDrift : this.gripNormal;
      const adjustedLatVel = latVel * (1.0 - lateralGrip);

      this.vx = fwdX * fwdVel + latX * adjustedLatVel;
      this.vy = fwdY * fwdVel + latY * adjustedLatVel;
    }

    this.vx *= this.drag;
    this.vy *= this.drag;

    const spd = Math.hypot(this.vx, this.vy);
    if (spd > this.maxSpeed) {
      this.vx = (this.vx / spd) * this.maxSpeed;
      this.vy = (this.vy / spd) * this.maxSpeed;
    }
    this.speed = Math.round(spd * 20);

    this.x += this.vx;
    this.y += this.vy;

    // Rebote del 50% al tocar los bordes azules
    if (trackData) {
      this.handleLocalBarrierCollision(trackData);
    }
  }

  handleLocalBarrierCollision(trackData) {
    const carRadius = 15;
    const { innerBarrier, outerBarrier } = trackData;
    const list = [innerBarrier, outerBarrier];

    for (const barrier of list) {
      const len = barrier.length;
      for (let i = 0; i < len; i++) {
        const p1 = barrier[i];
        const p2 = barrier[(i + 1) % len];
        const res = distToSegmentSquared({ x: this.x, y: this.y }, p1, p2);

        if (res.dist < carRadius) {
          const penetration = carRadius - res.dist;
          this.x += res.nx * penetration * 1.25;
          this.y += res.ny * penetration * 1.25;

          const dot = this.vx * res.nx + this.vy * res.ny;
          if (dot < 0) {
            this.vx = (this.vx - 2 * dot * res.nx) * 0.5;
            this.vy = (this.vy - 2 * dot * res.ny) * 0.5;
          }
          this.justCollided = true;
          return;
        }
      }
    }
  }

  updateLocalBotAI(trackData) {
    if (!trackData) return;
    const wp = trackData.waypoints;
    const count = wp.length;

    const cur = wp[this.botCurrentWaypoint % count];
    const dist = Math.hypot(cur.x - this.x, cur.y - this.y);
    if (dist < 65) {
      this.botCurrentWaypoint = (this.botCurrentWaypoint + 1) % count;
    }

    const targetWP = wp[(this.botCurrentWaypoint + 1) % count];
    const lookAheadWP = wp[(this.botCurrentWaypoint + this.botLookAhead) % count];

    let targetAngle = Math.atan2(targetWP.y - this.y, targetWP.x - this.x);

    this.botNoiseTimer++;
    if (this.botNoiseTimer > 20) {
      this.botNoiseTimer = 0;
      this.botErrorNoise = (Math.random() - 0.5) * 0.24;
    }
    targetAngle += this.botErrorNoise;

    let diff = targetAngle - this.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    this.inputs.left = diff < -0.12;
    this.inputs.right = diff > 0.12;

    const futureAngle = Math.atan2(lookAheadWP.y - targetWP.y, lookAheadWP.x - targetWP.x);
    let cornerSharpness = Math.abs(futureAngle - this.angle);
    while (cornerSharpness > Math.PI) cornerSharpness -= Math.PI * 2;
    cornerSharpness = Math.abs(cornerSharpness);

    const speed = Math.hypot(this.vx, this.vy);
    if (cornerSharpness > 0.65 && speed > 5.5) {
      this.inputs.up = false;
      this.inputs.down = true;
      this.inputs.space = (cornerSharpness > 1.1);
    } else {
      this.inputs.up = true;
      this.inputs.down = false;
      this.inputs.space = false;
    }
  }

  checkLocalCheckpoints(trackData, now, onWin) {
    if (!trackData || !trackData.gates) return;
    const { gates } = trackData;
    const prev = { x: this.prevX, y: this.prevY };
    const cur = { x: this.x, y: this.y };

    if (this.nextCheckpoint === 1 && segmentsIntersect(prev, cur, { x: gates.CP1.x1, y: gates.CP1.y1 }, { x: gates.CP1.x2, y: gates.CP1.y2 })) {
      this.nextCheckpoint = 2;
    } else if (this.nextCheckpoint === 2 && segmentsIntersect(prev, cur, { x: gates.CP2.x1, y: gates.CP2.y1 }, { x: gates.CP2.x2, y: gates.CP2.y2 })) {
      this.nextCheckpoint = 3;
    } else if (this.nextCheckpoint === 3 && segmentsIntersect(prev, cur, { x: gates.CP3.x1, y: gates.CP3.y1 }, { x: gates.CP3.x2, y: gates.CP3.y2 })) {
      this.nextCheckpoint = 0;
    } else if (this.nextCheckpoint === 0 && segmentsIntersect(prev, cur, { x: gates.FINISH.x1, y: gates.FINISH.y1 }, { x: gates.FINISH.x2, y: gates.FINISH.y2 })) {
      this.laps++;
      const lapTime = now - this.lapStartTime;
      this.lapStartTime = now;
      if (!this.bestLapTime || lapTime < this.bestLapTime) {
        this.bestLapTime = lapTime;
      }
      this.nextCheckpoint = 1;

      if (this.laps >= 3 && !this.finished) {
        this.finished = true;
        if (onWin) onWin(this);
      }
    }
    this.currentLapTime = now - this.lapStartTime;
  }

  getRearTirePositions() {
    const headingX = Math.cos(this.angle);
    const headingY = Math.sin(this.angle);
    const latX = -headingY;
    const latY = headingX;
    const rearX = this.x - headingX * 14;
    const rearY = this.y - headingY * 14;
    return {
      left: { x: rearX - latX * 12, y: rearY - latY * 12 },
      right: { x: rearX + latX * 12, y: rearY + latY * 12 }
    };
  }
}

// ==========================================
// 6. MOTOR PRINCIPAL DEL JUEGO
// ==========================================
class GameEngine {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.minimapCanvas = document.getElementById('hudMinimapCanvas');
    this.minimapCtx = this.minimapCanvas.getContext('2d');

    this.socket = null;
    this.isOnline = false;
    this.gameMode = 'single'; // 'single' o 'multi'
    this.currentTrackId = 'gp';
    this.myId = 'p1';
    this.myPlayerNumber = 1;

    // Cargar geometría del circuito inicial
    this.trackData = buildTrackGeometry(TRACK_PRESETS.gp.keypoints);

    // Cámara dinámica de persecución
    this.camera = {
      x: 340,
      y: 760,
      zoom: 1.85,
      targetZoom: 1.85,
      mode: 'follow' // 'follow' o 'overview'
    };

    this.cars = {};
    this.vfx = new VFXManager();
    this.sound = new SoundFX();
    this.inputManager = null;

    this.lastFrameTime = performance.now();
    this.gameState = 'WAITING'; // 'WAITING', 'COUNTDOWN', 'RACING', 'FINISHED'
    this.countdown = 3;
    this.countdownTimer = null;
    this.raceStartTime = null;

    // Cache de elementos de la interfaz HUD Mario Kart
    this.ui = {
      serverDot: document.getElementById('serverStatusDot'),
      serverText: document.getElementById('serverStatusText'),
      soundBtn: document.getElementById('soundToggleBtn'),
      soundIcon: document.getElementById('soundIcon'),
      openMenuBtn: document.getElementById('openMenuBtn'),
      camToggleBtn: document.getElementById('camToggleBtn'),
      mainMenuOverlay: document.getElementById('mainMenuOverlay'),
      startRaceBtn: document.getElementById('startRaceBtn'),
      modeSingleCard: document.getElementById('modeSingleCard'),
      modeMultiCard: document.getElementById('modeMultiCard'),
      trackCardGP: document.getElementById('trackCardGP'),
      trackCardSpeed: document.getElementById('trackCardSpeed'),
      trackCardDrift: document.getElementById('trackCardDrift'),
      hudPosNum: document.getElementById('hudPosNum'),
      hudPosSuffix: document.getElementById('hudPosSuffix'),
      hudLapText: document.getElementById('hudLapText'),
      hudLapProgressFill: document.getElementById('hudLapProgressFill'),
      hudTimer: document.getElementById('hudTimer'),
      hudBestLap: document.getElementById('hudBestLap'),
      hudSpeedNum: document.getElementById('hudSpeedNum'),
      hudDriftBadge: document.getElementById('hudDriftBadge'),
      semaphoreOverlay: document.getElementById('semaphoreOverlay'),
      semaphoreText: document.getElementById('semaphoreText'),
      semLight1: document.getElementById('semLight1'),
      semLight2: document.getElementById('semLight2'),
      semLight3: document.getElementById('semLight3'),
      semLightGreen: document.getElementById('semLightGreen'),
      victoryOverlay: document.getElementById('victoryOverlay'),
      victoryTitle: document.getElementById('victoryTitle'),
      victoryWinnerBadge: document.getElementById('victoryWinnerBadge'),
      victoryTotalTime: document.getElementById('victoryTotalTime'),
      victoryBestLap: document.getElementById('victoryBestLap'),
      victoryRestartBtn: document.getElementById('victoryRestartBtn'),
      victoryMenuBtn: document.getElementById('victoryMenuBtn')
    };

    this.setupInitialCars();
    this.setupUIHandlers();
    this.setupSocket();

    this.inputManager = new InputManager((inputs) => this.handleInputsChanged(inputs));

    window.addEventListener('resize', () => this.resizeCanvas());
    this.resizeCanvas();

    requestAnimationFrame((t) => this.renderLoop(t));
  }

  getLocalCar() {
    return this.cars[this.myId] || this.cars['p1'] || Object.values(this.cars)[0];
  }

  setupInitialCars() {
    const preset = TRACK_PRESETS[this.currentTrackId] || TRACK_PRESETS.gp;
    const grid = preset.startGrid;

    this.cars['p1'] = new ClientCar('p1', {
      playerNumber: 1,
      isBot: false,
      name: 'Piloto 1 (Tú)',
      color: '#004b8d',
      x: grid[0].x,
      y: grid[0].y,
      angle: grid[0].angle
    });

    this.cars['p2'] = new ClientCar('p2', {
      playerNumber: 2,
      isBot: (this.gameMode === 'single'),
      name: (this.gameMode === 'single' ? 'INFOCAL Bot AI' : 'Rival (Online)'),
      color: '#dd1321',
      x: grid[1].x,
      y: grid[1].y,
      angle: grid[1].angle
    });

    this.myId = 'p1';
    this.camera.x = grid[0].x;
    this.camera.y = grid[0].y;
  }

  changeTrack(trackId, syncWithServer = true) {
    if (!TRACK_PRESETS[trackId]) return;
    this.currentTrackId = trackId;
    const preset = TRACK_PRESETS[trackId];

    this.trackData = buildTrackGeometry(preset.keypoints);
    this.setupInitialCars();

    [this.ui.trackCardGP, this.ui.trackCardSpeed, this.ui.trackCardDrift].forEach((card) => {
      if (!card) return;
      card.classList.toggle('active', card.getAttribute('data-track') === trackId);
    });

    if (syncWithServer && this.isOnline && this.socket && this.socket.connected) {
      this.socket.emit('changeTrack', trackId);
    }
  }

  toggleCamera() {
    this.camera.mode = this.camera.mode === 'follow' ? 'overview' : 'follow';
    if (this.ui.camToggleBtn) {
      this.ui.camToggleBtn.textContent = this.camera.mode === 'follow'
        ? '🎥 Vista: Dinámica [C]'
        : '🗺️ Vista: Mapa Completo [C]';
    }
  }

  resizeCanvas() {
    const container = this.canvas.parentElement;
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || (window.innerHeight - 64);
    this.canvas.width = Math.floor(w);
    this.canvas.height = Math.floor(h);
  }

  setupSocket() {
    if (typeof io === 'undefined') {
      this.ui.serverDot.classList.remove('online');
      this.ui.serverText.textContent = 'Modo Local (vs Bot)';
      return;
    }

    try {
      const serverUrl = window.INFOCAL_SERVER_URL || undefined;
      this.socket = io(serverUrl, {
        reconnectionAttempts: 6,
        timeout: 3000
      });

      this.socket.on('connect', () => {
        this.isOnline = true;
        this.ui.serverDot.classList.add('online');
        this.ui.serverText.textContent = 'En Línea (Conectado)';
      });

      this.socket.on('disconnect', () => {
        this.isOnline = false;
        this.ui.serverDot.classList.remove('online');
        this.ui.serverText.textContent = 'Modo Local (Desconectado)';
      });

      this.socket.on('init', (data) => {
        this.myId = data.yourId;
        this.myPlayerNumber = data.playerNumber;
        if (data.trackId && data.track) {
          this.currentTrackId = data.trackId;
          this.trackData = data.track;
        }
        this.gameState = data.gameState.status;
      });

      this.socket.on('trackChanged', (data) => {
        this.currentTrackId = data.trackId;
        if (data.track) this.trackData = data.track;
        this.setupInitialCars();
      });

      this.socket.on('gameState', (data) => {
        this.isOnline = true;
        this.gameState = data.status;
        this.countdown = data.countdown;

        for (const id in data.cars) {
          const serverCar = data.cars[id];
          if (!this.cars[id]) {
            this.cars[id] = new ClientCar(id, serverCar);
          } else {
            this.cars[id].updateFromServer(serverCar);
          }

          if (serverCar.justCollided) {
            this.vfx.spawnSparks(serverCar.x, serverCar.y, 12);
            if (id === this.myId) {
              this.sound.playCollision();
            }
          }
        }

        // Limpiar autos que ya no existan en el servidor
        for (const id in this.cars) {
          if (!data.cars[id]) delete this.cars[id];
        }

        this.updateHUD();
      });

      this.socket.on('countdownUpdate', (data) => this.handleCountdown(data.countdown));
      this.socket.on('raceStarted', () => this.handleRaceStart());
      this.socket.on('raceFinished', (data) => this.handleRaceFinished(data.winner));

    } catch (e) {
      console.warn('Socket error:', e);
      this.isOnline = false;
      this.ui.serverText.textContent = 'Modo Local (vs Bot)';
    }
  }

  handleInputsChanged(inputs) {
    if (this.isOnline && this.socket && this.socket.connected && this.gameMode === 'multi') {
      this.socket.emit('playerInput', inputs);
    } else {
      const myCar = this.getLocalCar();
      if (myCar) {
        myCar.inputs = inputs;
      }
    }
  }

  setupUIHandlers() {
    // 1. Selector de Modos de Juego
    this.ui.modeSingleCard.addEventListener('click', () => {
      this.gameMode = 'single';
      this.ui.modeSingleCard.classList.add('active');
      this.ui.modeMultiCard.classList.remove('active');
      this.setupInitialCars();
    });

    this.ui.modeMultiCard.addEventListener('click', () => {
      this.gameMode = 'multi';
      this.ui.modeMultiCard.classList.add('active');
      this.ui.modeSingleCard.classList.remove('active');
      this.setupInitialCars();
    });

    // 2. Selector de Circuitos
    const setupTrackCard = (card, trackId) => {
      if (!card) return;
      card.addEventListener('click', () => {
        this.changeTrack(trackId, true);
      });
    };
    setupTrackCard(this.ui.trackCardGP, 'gp');
    setupTrackCard(this.ui.trackCardSpeed, 'speed');
    setupTrackCard(this.ui.trackCardDrift, 'drift');

    // 3. Botón de Entrar a la Pista
    this.ui.startRaceBtn.addEventListener('click', () => {
      this.sound.resume();
      this.ui.mainMenuOverlay.classList.add('hidden');
      this.startCountdown();
    });

    // 4. Botón Menú / Pistas de la cabecera
    this.ui.openMenuBtn.addEventListener('click', () => {
      this.ui.mainMenuOverlay.classList.remove('hidden');
      this.ui.victoryOverlay.classList.remove('visible');
    });

    // 5. Botón Sonido
    this.ui.soundBtn.addEventListener('click', () => {
      this.sound.resume();
      const muted = this.sound.toggleMute();
      this.ui.soundIcon.textContent = muted ? '🔇' : '🔊';
    });

    // 6. Botón de Cámara
    this.ui.camToggleBtn.addEventListener('click', () => {
      this.toggleCamera();
    });

    // 7. Botones de Victoria
    this.ui.victoryRestartBtn.addEventListener('click', () => {
      this.ui.victoryOverlay.classList.remove('visible');
      this.startCountdown();
    });

    this.ui.victoryMenuBtn.addEventListener('click', () => {
      this.ui.victoryOverlay.classList.remove('visible');
      this.ui.mainMenuOverlay.classList.remove('hidden');
    });
  }

  startCountdown() {
    if (this.isOnline && this.socket && this.socket.connected && this.gameMode === 'multi') {
      this.socket.emit('requestStart');
      return;
    }

    // Cuenta regresiva local
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.gameState = 'COUNTDOWN';
    this.countdown = 3;
    this.setupInitialCars();
    this.handleCountdown(3);

    this.countdownTimer = setInterval(() => {
      this.countdown--;
      if (this.countdown > 0) {
        this.handleCountdown(this.countdown);
      } else if (this.countdown === 0) {
        this.handleCountdown(0);
        this.gameState = 'RACING';
        this.raceStartTime = Date.now();
        const myCar = this.getLocalCar();
        if (myCar) myCar.lapStartTime = Date.now();
        if (this.cars['p2']) this.cars['p2'].lapStartTime = Date.now();
        this.handleRaceStart();
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
      }
    }, 1000);
  }

  handleCountdown(count) {
    this.ui.semaphoreOverlay.classList.add('visible');
    this.ui.semLight1.classList.remove('on');
    this.ui.semLight2.classList.remove('on');
    this.ui.semLight3.classList.remove('on');
    this.ui.semLightGreen.classList.remove('on');

    if (count === 3) {
      this.ui.semLight1.classList.add('on');
      this.ui.semaphoreText.textContent = '3';
      this.sound.playBeep(false);
    } else if (count === 2) {
      this.ui.semLight1.classList.add('on');
      this.ui.semLight2.classList.add('on');
      this.ui.semaphoreText.textContent = '2';
      this.sound.playBeep(false);
    } else if (count === 1) {
      this.ui.semLight1.classList.add('on');
      this.ui.semLight2.classList.add('on');
      this.ui.semLight3.classList.add('on');
      this.ui.semaphoreText.textContent = '1';
      this.sound.playBeep(false);
    } else if (count === 0) {
      this.ui.semLightGreen.classList.add('on');
      this.ui.semaphoreText.textContent = '¡YA!';
      this.sound.playBeep(true);
      setTimeout(() => {
        this.ui.semaphoreOverlay.classList.remove('visible');
      }, 900);
    }
  }

  handleRaceStart() {
    this.gameState = 'RACING';
    this.raceStartTime = Date.now();
    this.camera.mode = 'follow';
    this.ui.camToggleBtn.textContent = '🎥 Vista: Dinámica [C]';
  }

  handleRaceFinished(winner) {
    this.gameState = 'FINISHED';
    this.sound.playVictory();
    this.ui.victoryOverlay.classList.add('visible');

    const isLocalWin = (winner.id === this.myId || winner.playerNumber === this.myPlayerNumber);
    this.ui.victoryTitle.textContent = isLocalWin ? '¡VICTORIA! 1er LUGAR' : '¡CARRERA FINALIZADA!';
    this.ui.victoryWinnerBadge.textContent = `GANADOR: ${winner.name.toUpperCase()}`;
    this.ui.victoryTotalTime.textContent = formatTime(winner.totalTime);
    this.ui.victoryBestLap.textContent = winner.bestLapTime ? formatTime(winner.bestLapTime) : '--:--.--';
  }

  // ==========================================
  // 7. ACTUALIZACIÓN DE LA INTERFAZ HUD MARIO KART
  // ==========================================
  updateHUD() {
    const myCar = this.getLocalCar();
    if (!myCar) return;

    // 1. Cálculo de Posición en tiempo real (1st vs 2nd)
    const allCars = Object.values(this.cars);
    if (allCars.length >= 2 && this.trackData && this.trackData.waypoints) {
      const getProgressScore = (c) => {
        const nextGateIdx = c.nextCheckpoint === 0 ? 0 : Math.floor(this.trackData.waypoints.length * (c.nextCheckpoint === 1 ? 0.28 : c.nextCheckpoint === 2 ? 0.55 : 0.80));
        const targetPt = this.trackData.waypoints[nextGateIdx] || { x: 0, y: 0 };
        const distToGate = Math.hypot(targetPt.x - c.x, targetPt.y - c.y);
        return (c.laps * 100000) + (c.nextCheckpoint * 10000) - distToGate;
      };

      allCars.sort((a, b) => getProgressScore(b) - getProgressScore(a));
      const pos = allCars.findIndex((c) => c.id === myCar.id) + 1;
      this.ui.hudPosNum.textContent = pos;
      this.ui.hudPosSuffix.textContent = pos === 1 ? 'st' : pos === 2 ? 'nd' : 'th';
    } else {
      this.ui.hudPosNum.textContent = '1';
      this.ui.hudPosSuffix.textContent = 'st';
    }

    // 2. Contador de Vueltas (Lap 1/3)
    const lapNumber = Math.min(3, myCar.laps + 1);
    this.ui.hudLapText.textContent = `LAP ${lapNumber}/3`;
    this.ui.hudLapProgressFill.style.width = `${Math.min(100, (lapNumber / 3) * 100)}%`;

    // 3. Temporizador de Carrera
    if (this.gameState === 'RACING' && this.raceStartTime) {
      const elapsed = Date.now() - this.raceStartTime;
      this.ui.hudTimer.textContent = formatTime(elapsed);
    }
    if (myCar.bestLapTime) {
      this.ui.hudBestLap.textContent = `MEJOR: ${formatTime(myCar.bestLapTime)}`;
    }

    // 4. Velocímetro y Badge de Derrape
    const speedKmh = myCar.speed || Math.round(Math.hypot(myCar.vx, myCar.vy) * 20);
    this.ui.hudSpeedNum.textContent = speedKmh;
    this.ui.hudDriftBadge.classList.toggle('active', myCar.isDrifting);

    // 5. Audio del motor
    const speed = Math.hypot(myCar.vx, myCar.vy);
    this.sound.updateEngine(speed, myCar.maxSpeed);
    this.sound.updateSkid(myCar.isDrifting);
  }

  // ==========================================
  // 8. CÁMARA DINÁMICA DE SEGUIMIENTO (CHASE CAM)
  // ==========================================
  updateCamera(dt) {
    const myCar = this.getLocalCar();

    if (this.camera.mode === 'follow' && myCar) {
      // Chase Cam: seguimiento suave con anticipación de velocidad
      const speed = Math.hypot(myCar.vx, myCar.vy);
      const leadDist = Math.min(speed * 12, 100);
      const targetX = myCar.x + Math.cos(myCar.angle) * leadDist;
      const targetY = myCar.y + Math.sin(myCar.angle) * leadDist;

      this.camera.x += (targetX - this.camera.x) * 0.12;
      this.camera.y += (targetY - this.camera.y) * 0.12;

      const norm = Math.min(1.0, speed / 9.2);
      this.camera.targetZoom = 1.95 - norm * 0.35;
      this.camera.zoom += (this.camera.targetZoom - this.camera.zoom) * 0.08;
    } else {
      // Vista Panorámica General: centrar todo el circuito
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      const pts = this.trackData.waypoints;
      for (let i = 0; i < pts.length; i++) {
        if (pts[i].x < minX) minX = pts[i].x;
        if (pts[i].x > maxX) maxX = pts[i].x;
        if (pts[i].y < minY) minY = pts[i].y;
        if (pts[i].y > maxY) maxY = pts[i].y;
      }
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      this.camera.x += (centerX - this.camera.x) * 0.12;
      this.camera.y += (centerY - this.camera.y) * 0.12;

      const trackW = maxX - minX + 160;
      const trackH = maxY - minY + 160;
      const fitZoom = Math.min(this.canvas.width / trackW, this.canvas.height / trackH) * 0.95;
      this.camera.zoom += (fitZoom - this.camera.zoom) * 0.08;
    }
  }

  // ==========================================
  // 9. BUCLE DE RENDERIZADO (60/120 FPS CON LERP)
  // ==========================================
  renderLoop(timestamp) {
    const dt = Math.min(40, timestamp - this.lastFrameTime);
    this.lastFrameTime = timestamp;
    const lerpAlpha = Math.min(1.0, 0.35 * (dt / 16.67));

    // Si es modo local o práctica vs Bot
    if (!this.isOnline || this.gameMode === 'single') {
      const now = Date.now();
      const controlsLocked = (this.gameState === 'COUNTDOWN' || this.gameState === 'WAITING');

      for (const id in this.cars) {
        const car = this.cars[id];
        if (car.isBot) {
          car.updateLocalBotAI(this.trackData);
        }
        car.updateLocalPhysics(this.trackData, controlsLocked);

        if (this.gameState === 'RACING') {
          car.checkLocalCheckpoints(this.trackData, now, (winnerCar) => {
            const total = Date.now() - (this.raceStartTime || Date.now());
            this.handleRaceFinished({
              id: winnerCar.id,
              playerNumber: winnerCar.playerNumber,
              name: winnerCar.name,
              color: winnerCar.color,
              bestLapTime: winnerCar.bestLapTime,
              totalTime: total
            });
          });
        }

        if (car.justCollided) {
          this.vfx.spawnSparks(car.x, car.y, 10);
          if (id === this.myId || id === 'p1') this.sound.playCollision();
        }
      }
      this.updateHUD();
    }

    // Interpolación LERP en multijugador online
    for (const id in this.cars) {
      const car = this.cars[id];
      if (this.isOnline && this.gameMode === 'multi') {
        car.interpolate(lerpAlpha);
      }

      // Registro de marcas de llantas (skid marks)
      const tires = car.getRearTirePositions();
      if (car.isDrifting) {
        if (car.prevTireL && car.prevTireR) {
          this.vfx.addSkidSegment(car.prevTireL, tires.left, 0.65);
          this.vfx.addSkidSegment(car.prevTireR, tires.right, 0.65);
        }
      }
      car.prevTireL = tires.left;
      car.prevTireR = tires.right;
    }

    this.updateCamera(dt);

    const ctx = this.ctx;
    // Fondo de pasto institucional (#c2c9dd)
    ctx.fillStyle = '#c2c9dd';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    // Cuadrícula y pasto extendido
    ctx.fillStyle = '#c2c9dd';
    ctx.fillRect(-3000, -3000, 8000, 8000);

    // 1. DIBUJAR PISTA INFOCAL
    this.renderTrack();

    // 2. DIBUJAR MARCAS DE LLANTAS Y CHISPAS
    this.vfx.updateAndDraw(ctx, dt);

    // 3. DIBUJAR AUTOS AERODINÁMICOS
    this.renderCars();

    ctx.restore();

    // 4. DIBUJAR RADAR / MINIMAPA EN LA CAPA HUD
    this.renderMinimap();

    requestAnimationFrame((t) => this.renderLoop(t));
  }

  // ==========================================
  // 10. RENDERIZADO DEL CIRCUITO INFOCAL
  // ==========================================
  renderTrack() {
    const ctx = this.ctx;
    if (!this.trackData) return;
    const { innerBarrier, outerBarrier, waypoints, gates } = this.trackData;

    // 1. Superficie de Asfalto (Polígono cerrado con regla evenodd)
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < outerBarrier.length; i++) {
      const pt = outerBarrier[i];
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();

    for (let i = innerBarrier.length - 1; i >= 0; i--) {
      const pt = innerBarrier[i];
      if (i === innerBarrier.length - 1) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();

    ctx.fillStyle = '#1e222d'; // Asfalto oscuro
    ctx.fill('evenodd');

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.stroke(); // stroke() sin argumentos para evitar errores
    ctx.restore();

    // 2. Pianos de Competición (Curbs Rojo #dd1321 y Blanco)
    this.drawCurbs(ctx, innerBarrier);
    this.drawCurbs(ctx, outerBarrier);

    // 3. Bordes de Contención en Azul Corporativo INFOCAL (#004b8d)
    ctx.save();
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#004b8d';
    ctx.shadowColor = 'rgba(0, 75, 141, 0.6)';
    ctx.shadowBlur = 8;

    ctx.beginPath();
    for (let i = 0; i < innerBarrier.length; i++) {
      const pt = innerBarrier[i];
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i < outerBarrier.length; i++) {
      const pt = outerBarrier[i];
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    // 4. Guía central de carrera punteada
    ctx.save();
    ctx.setLineDash([14, 18]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < waypoints.length; i++) {
      const pt = waypoints[i];
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    // 5. Línea de Meta (Red #dd1321 & White checkered)
    if (gates && gates.FINISH) this.drawFinishLine(ctx, gates.FINISH);

    // 6. Checkpoints sutiles (Anti-Trampas)
    if (gates && gates.CP1) this.drawCheckpoint(ctx, gates.CP1, 'CP 1');
    if (gates && gates.CP2) this.drawCheckpoint(ctx, gates.CP2, 'CP 2');
    if (gates && gates.CP3) this.drawCheckpoint(ctx, gates.CP3, 'CP 3');
  }

  drawCurbs(ctx, pts) {
    const n = pts.length;
    for (let i = 0; i < n; i += 2) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      const isRed = (Math.floor(i / 2) % 2 === 0);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = isRed ? '#dd1321' : '#ffffff';
      ctx.lineWidth = 5;
      ctx.lineCap = 'butt';
      ctx.stroke();
      ctx.restore();
    }
  }

  drawFinishLine(ctx, gate) {
    const dx = gate.x2 - gate.x1;
    const dy = gate.y2 - gate.y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;

    ctx.save();
    // Borde rojo vibrante INFOCAL (#dd1321)
    ctx.beginPath();
    ctx.moveTo(gate.x1 - nx * 8, gate.y1 - ny * 8);
    ctx.lineTo(gate.x2 - nx * 8, gate.y2 - ny * 8);
    ctx.lineTo(gate.x2 + nx * 8, gate.y2 + ny * 8);
    ctx.lineTo(gate.x1 + nx * 8, gate.y1 + ny * 8);
    ctx.closePath();
    ctx.fillStyle = '#dd1321';
    ctx.fill();

    // Patrón a cuadros blanco y negro
    const cols = 12;
    for (let c = 0; c < cols; c++) {
      const t1 = c / cols;
      const t2 = (c + 1) / cols;
      const px1 = gate.x1 + dx * t1;
      const py1 = gate.y1 + dy * t1;
      const px2 = gate.x1 + dx * t2;
      const py2 = gate.y1 + dy * t2;

      ctx.fillStyle = (c % 2 === 0) ? '#ffffff' : '#111111';
      ctx.beginPath();
      ctx.moveTo(px1 - nx * 6, py1 - ny * 6);
      ctx.lineTo(px2 - nx * 6, py2 - ny * 6);
      ctx.lineTo(px2 + nx * 6, py2 + ny * 6);
      ctx.lineTo(px1 + nx * 6, py1 + ny * 6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawCheckpoint(ctx, gate, label) {
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gate.x1, gate.y1);
    ctx.lineTo(gate.x2, gate.y2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.font = 'bold 9px Chakra Petch';
    ctx.fillText(label, gate.cx - 10, gate.cy - 6);
    ctx.restore();
  }

  // ==========================================
  // 11. RENDERIZADO DE AUTOS AERODINÁMICOS (ctx.beginPath)
  // ==========================================
  renderCars() {
    const ctx = this.ctx;

    for (const id in this.cars) {
      const car = this.cars[id];
      const isMyCar = (car.id === this.myId || (!this.isOnline && car.id === 'p1'));

      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.angle);

      // Sombra del vehículo
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(-2, 3, 22, 12, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.restore();

      // Luces LED delanteras proyectadas en el asfalto
      ctx.save();
      const beamGrad = ctx.createRadialGradient(28, 0, 4, 85, 0, 65);
      beamGrad.addColorStop(0, 'rgba(240, 248, 255, 0.35)');
      beamGrad.addColorStop(1, 'rgba(240, 248, 255, 0.0)');
      ctx.beginPath();
      ctx.moveTo(20, -8);
      ctx.lineTo(90, -35);
      ctx.lineTo(90, 35);
      ctx.lineTo(20, 8);
      ctx.closePath();
      ctx.fillStyle = beamGrad;
      ctx.fill();
      ctx.restore();

      // 4 Ruedas deportivas con rines
      this.drawWheel(ctx, 12, -13);
      this.drawWheel(ctx, 12, 13);
      this.drawWheel(ctx, -14, -13);
      this.drawWheel(ctx, -14, 13);

      // Chasis Aerodinámico usando ctx.beginPath() (No fillRect simple)
      ctx.beginPath();
      ctx.moveTo(24, 0);
      ctx.bezierCurveTo(24, -5, 20, -10, 15, -11);
      ctx.lineTo(6, -11);
      ctx.lineTo(0, -9.5);
      ctx.lineTo(-8, -12);
      ctx.bezierCurveTo(-16, -12, -22, -10, -23, -8);
      ctx.lineTo(-24, 0);
      ctx.lineTo(-23, 8);
      ctx.bezierCurveTo(-22, 10, -16, 12, -8, 12);
      ctx.lineTo(0, 9.5);
      ctx.lineTo(6, 11);
      ctx.bezierCurveTo(20, 10, 24, 5, 24, 0);
      ctx.closePath();

      // Color institucional (P1 Azul #004b8d, Rival Rojo #dd1321)
      const grad = ctx.createLinearGradient(-24, 0, 24, 0);
      if (car.color === '#004b8d') {
        grad.addColorStop(0, '#002e5c');
        grad.addColorStop(0.5, '#004b8d');
        grad.addColorStop(1, '#0e70c4');
      } else {
        grad.addColorStop(0, '#8f000b');
        grad.addColorStop(0.5, '#dd1321');
        grad.addColorStop(1, '#ff3848');
      }
      ctx.fillStyle = grad;
      ctx.shadowColor = car.color;
      ctx.shadowBlur = 10;
      ctx.fill();

      // Borde del chasis
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Cabina / Parabrisas oscurecido
      ctx.beginPath();
      ctx.ellipse(2, 0, 9, 6.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#0f1724';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Destello del parabrisas
      ctx.beginPath();
      ctx.ellipse(3, -2, 5, 2.5, -0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fill();

      // Alerón trasero aerodinámico
      ctx.beginPath();
      ctx.rect(-22, -12, 4, 24);
      ctx.fillStyle = '#0a0f18';
      ctx.fill();
      ctx.strokeStyle = car.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Luces traseras rojas
      ctx.fillStyle = '#ff0033';
      ctx.fillRect(-23, -9, 2, 4);
      ctx.fillRect(-23, 5, 2, 4);

      ctx.restore();

      // Indicador flotante 3D animado encima del monoplaza del jugador local
      if (isMyCar) {
        const bounce = Math.sin(Date.now() * 0.007) * 4;
        const badgeY = car.y - 36 + bounce;

        ctx.save();
        ctx.translate(car.x, badgeY);

        // Flecha hacia abajo
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-7, -9);
        ctx.lineTo(7, -9);
        ctx.closePath();
        ctx.fillStyle = '#ffd700';
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = 8;
        ctx.fill();

        // Placa con texto "TÚ"
        drawRoundRect(ctx, -19, -24, 38, 14, 4);
        ctx.fillStyle = '#004b8d';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px Chakra Petch';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('TÚ', 0, -17);

        ctx.restore();
      }
    }
  }

  drawWheel(ctx, x, y) {
    ctx.save();
    drawRoundRect(ctx, x - 5, y - 2.5, 10, 5, 2);
    ctx.fillStyle = '#11141a';
    ctx.fill();
    ctx.strokeStyle = '#6c7a89';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  // ==========================================
  // 12. RADAR / MINIMAPA ESTILO MARIO KART
  // ==========================================
  renderMinimap() {
    const rctx = this.minimapCtx;
    const rw = this.minimapCanvas.width;
    const rh = this.minimapCanvas.height;

    rctx.clearRect(0, 0, rw, rh);
    if (!this.trackData || !this.trackData.waypoints) return;

    // Calcular bounding box exacto del circuito
    const pts = this.trackData.waypoints;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].x < minX) minX = pts[i].x;
      if (pts[i].x > maxX) maxX = pts[i].x;
      if (pts[i].y < minY) minY = pts[i].y;
      if (pts[i].y > maxY) maxY = pts[i].y;
    }

    const padding = 16;
    const trackW = maxX - minX || 1;
    const trackH = maxY - minY || 1;
    const scale = Math.min((rw - padding * 2) / trackW, (rh - padding * 2) / trackH);

    const offsetX = (rw - trackW * scale) / 2 - minX * scale;
    const offsetY = (rh - trackH * scale) / 2 - minY * scale;

    const mapX = (x) => x * scale + offsetX;
    const mapY = (y) => y * scale + offsetY;

    // 1. Trazado del circuito
    rctx.save();
    rctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const mx = mapX(pts[i].x);
      const my = mapY(pts[i].y);
      if (i === 0) rctx.moveTo(mx, my);
      else rctx.lineTo(mx, my);
    }
    rctx.closePath();

    rctx.strokeStyle = 'rgba(0, 75, 141, 0.9)';
    rctx.lineWidth = 8;
    rctx.lineCap = 'round';
    rctx.lineJoin = 'round';
    rctx.stroke();

    rctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    rctx.lineWidth = 2;
    rctx.stroke();
    rctx.restore();

    // 2. Línea de meta en el radar
    const finish = this.trackData.gates ? this.trackData.gates.FINISH : null;
    if (finish) {
      rctx.save();
      rctx.beginPath();
      rctx.moveTo(mapX(finish.x1), mapY(finish.y1));
      rctx.lineTo(mapX(finish.x2), mapY(finish.y2));
      rctx.strokeStyle = '#dd1321';
      rctx.lineWidth = 3;
      rctx.stroke();
      rctx.restore();
    }

    // 3. Puntos de los vehículos en tiempo real
    for (const id in this.cars) {
      const car = this.cars[id];
      const cx = mapX(car.x);
      const cy = mapY(car.y);
      const isMyCar = (car.id === this.myId || (!this.isOnline && car.id === 'p1'));

      rctx.save();
      rctx.beginPath();
      rctx.arc(cx, cy, isMyCar ? 5.5 : 4.5, 0, Math.PI * 2);
      rctx.fillStyle = isMyCar ? '#00b0ff' : '#ff2244';
      rctx.shadowColor = isMyCar ? '#00b0ff' : '#ff2244';
      rctx.shadowBlur = 8;
      rctx.fill();

      rctx.strokeStyle = '#ffffff';
      rctx.lineWidth = 1.5;
      rctx.stroke();
      rctx.restore();
    }
  }
}

// Inicialización automática
window.addEventListener('DOMContentLoaded', () => {
  window.gameEngine = new GameEngine();
});
