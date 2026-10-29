import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* =========================================================
   Utilities
   ========================================================= */
const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const rand = (a, b) => a + Math.random() * (b - a);
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } }
};

/* =========================================================
   Audio (Web Audio, fully synthesized)
   ========================================================= */
class Sound {
  constructor() { this.ctx = null; this.muted = !!store.get('ct3d:muted', false); this.nitroOn = false; }
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(ctx.destination);

      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      // Engine: saw + square sub through a resonant low-pass
      this.engFilter = ctx.createBiquadFilter();
      this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 500; this.engFilter.Q.value = 5;
      this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
      this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth'; this.osc1.frequency.value = 50;
      this.osc2 = ctx.createOscillator(); this.osc2.type = 'square'; this.osc2.frequency.value = 25;
      const sub = ctx.createGain(); sub.gain.value = 0.35;
      this.osc1.connect(this.engFilter); this.osc2.connect(sub); sub.connect(this.engFilter);
      this.engFilter.connect(this.engGain); this.engGain.connect(this.master);
      this.osc1.start(); this.osc2.start();

      // Nitro: a single looping hiss that fades in and out (no per-frame buffers)
      const hiss = ctx.createBufferSource(); hiss.buffer = this.noise; hiss.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 0.7;
      this.nitroGain = ctx.createGain(); this.nitroGain.gain.value = 0;
      hiss.connect(bp); bp.connect(this.nitroGain); this.nitroGain.connect(this.master); hiss.start();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }
  get t() { return this.ctx.currentTime; }
  engine(on, load, rpm) {
    if (!this.ctx) return;
    const t = this.t, f = 40 + rpm * 115;
    this.osc1.frequency.setTargetAtTime(f, t, 0.04);
    this.osc2.frequency.setTargetAtTime(f / 2, t, 0.04);
    this.engFilter.frequency.setTargetAtTime(350 + rpm * 1500, t, 0.05);
    this.engGain.gain.setTargetAtTime(on ? 0.045 + load * 0.05 : 0, t, 0.1);
  }
  nitro(on) {
    if (!this.ctx || on === this.nitroOn) return;
    this.nitroOn = on;
    this.nitroGain.gain.setTargetAtTime(on ? 0.16 : 0, this.t, 0.06);
  }
  burst({ freq = 900, type = 'bandpass', dur = 0.3, vol = 0.3, q = 1, delay = 0, sweep = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.t + delay;
    const src = this.ctx.createBufferSource(); src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }
  tone(freq, dur, vol, type = 'sine', slideTo = 0, delay = 0) {
    if (!this.ctx) return;
    const t = this.t + delay;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  impact(k) { k = clamp(k, 0.15, 1); this.burst({ freq: 700, type: 'lowpass', dur: 0.2 + 0.4 * k, vol: 0.55 * k, sweep: 120 }); this.tone(150, 0.15 + 0.3 * k, 0.3 * k, 'sawtooth', 35); }
  scrape() { this.burst({ freq: 2600, type: 'bandpass', dur: 0.12, vol: 0.08, q: 3 }); }
  coin() { this.tone(988, 0.08, 0.09, 'square'); this.tone(1319, 0.14, 0.09, 'square', 0, 0.07); }
  pickup() { this.tone(520, 0.25, 0.12, 'triangle', 1560); }
  whoosh() { this.burst({ freq: 3000, type: 'bandpass', dur: 0.35, vol: 0.22, q: 0.8, sweep: 500 }); }
  beep(go) { this.tone(go ? 1320 : 660, go ? 0.45 : 0.16, 0.14, 'triangle'); }
  setMuted(m) { this.muted = m; store.set('ct3d:muted', m); if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.t, 0.02); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
}
const sound = new Sound();

/* =========================================================
   Game data
   ========================================================= */
const ROAD_W = 15.4, ROAD_HALF = ROAD_W / 2;
const LANE_W = 3.6;
const LANES = [-1.5, -0.5, 0.5, 1.5].map((k) => k * LANE_W);
const MS_PER_KMH = 1.25 / 3.6;          // slightly arcade-scaled metres per second per km/h
const FOG_COLOR = 0x2a0f48;
const VIEW = 420;                       // how far ahead the world is populated (m)

const PRESETS = [
  { id: 'roadster', name: 'Cyber Roadster', tag: 'Balanced sports coupe', color: 0x2de2e6,
    L: 4.4, W: 2.0, r: 0.36, maxSpeed: 210, boost: 295, accel: 0.45, handling: 15, hp: 100, drain: 30, regen: 6,
    prof: { g: 0.3, nose: 0.56, beltF: 0.74, beltR: 0.84, tail: 0.78, roof: 1.18, cf: 0.2, rf: 0.0, rr: -0.27, cr: -0.42 }, wing: 'lip' },
  { id: 'formula', name: 'Apex Formula', tag: 'Fast, light and fragile', color: 0xff2a6d,
    L: 4.6, W: 2.05, r: 0.34, maxSpeed: 245, boost: 330, accel: 0.55, handling: 17, hp: 70, drain: 34, regen: 6,
    prof: { g: 0.24, nose: 0.42, beltF: 0.62, beltR: 0.76, tail: 0.74, roof: 1.04, cf: 0.12, rf: -0.08, rr: -0.25, cr: -0.38 }, wing: 'big' },
  { id: 'titan', name: 'Titan Enforcer', tag: 'Armored truck that shrugs off hits', color: 0xffb000,
    L: 4.8, W: 2.3, r: 0.46, maxSpeed: 185, boost: 255, accel: 0.34, handling: 12, hp: 160, drain: 28, regen: 6,
    prof: { g: 0.46, nose: 0.9, beltF: 1.08, beltR: 1.12, tail: 1.06, roof: 1.78, cf: 0.28, rf: 0.14, rr: -0.42, cr: -0.46 }, wing: 'lightbar' },
  { id: 'phantom', name: 'Neon Phantom', tag: 'Fastback built around its nitro', color: 0x9b5cff,
    L: 4.5, W: 2.05, r: 0.36, maxSpeed: 225, boost: 315, accel: 0.48, handling: 15.5, hp: 90, drain: 20, regen: 10,
    prof: { g: 0.3, nose: 0.5, beltF: 0.68, beltR: 0.8, tail: 0.78, roof: 1.12, cf: 0.18, rf: -0.04, rr: -0.32, cr: -0.47 }, wing: 'lip' }
];
const TRAFFIC_COLORS = [0xe8e6f0, 0x9aa0b5, 0x283a7a, 0xb3202f, 0x1d1d24, 0x2f6b5a, 0xd8b04a];

function zeroTo100(p) { return -Math.log(1 - 100 / p.maxSpeed) / p.accel; }

/* =========================================================
   Renderer, scene, post-processing
   ========================================================= */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  document.body.innerHTML = '<div class="panel err"><h2>3D graphics are unavailable</h2><p>This browser could not start WebGL 2. Try a current version of Chrome, Safari, Edge or Firefox with hardware acceleration turned on.</p></div>';
  throw err;
}
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;
$('stage').appendChild(renderer.domElement);
const maxAniso = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(FOG_COLOR, 30, VIEW);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 1800);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;
pmrem.dispose();

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

let quality = store.get('ct3d:quality', coarse ? 'low' : 'high');
if (quality !== 'high' && quality !== 'low') quality = 'high';

/* =========================================================
   Procedural textures
   ========================================================= */
function canvasTex(w, h, draw, { repeat = false, srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = maxAniso;
  return t;
}
const fogCss = '#' + new THREE.Color(FOG_COLOR).getHexString();
const roadPx = (x, w) => (x / ROAD_W + 0.5) * w;

const roadTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#17131f'; g.fillRect(0, 0, w, h);
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() * 16) | 0; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n + 3; }
  g.putImageData(img, 0, 0);
}, { repeat: true });
const roadGlowTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#2de2e6';
  g.fillRect(roadPx(-ROAD_HALF + 0.45, w) - 4, 0, 8, h);
  g.fillRect(roadPx(ROAD_HALF - 0.45, w) - 4, 0, 8, h);
  g.fillStyle = '#e9e4ff';
  for (const x of [-LANE_W, 0, LANE_W]) g.fillRect(roadPx(x, w) - 3, 0, 6, h * 0.42);
}, { repeat: true });
const gridTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#130828'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ff2a6d'; g.fillRect(0, 0, w, 3); g.fillRect(0, 0, 3, h);
}, { repeat: true });
const windowTex = canvasTex(64, 256, (g, w, h) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  const cols = ['#2de2e6', '#ff2a6d', '#ffb000', '#b9a7ff'];
  for (let y = 6; y < h - 6; y += 10) for (let x = 5; x < w - 5; x += 9) {
    if (Math.random() < 0.33) { g.fillStyle = cols[(Math.random() * cols.length) | 0]; g.globalAlpha = rand(0.35, 1); g.fillRect(x, y, 5, 5); }
  }
  g.globalAlpha = 1;
});
const radialTex = (inner, outer) => canvasTex(128, 128, (g, w) => {
  const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  grd.addColorStop(0, inner); grd.addColorStop(1, outer);
  g.fillStyle = grd; g.fillRect(0, 0, w, w);
});
const glowTex = radialTex('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
const shadowTex = radialTex('rgba(0,0,0,0.85)', 'rgba(0,0,0,0)');
const smokeTex = canvasTex(64, 64, (g, w) => {
  const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, w);
});

scene.background = canvasTex(4, 512, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#05020d'); grd.addColorStop(0.45, '#160733'); grd.addColorStop(0.75, '#2d0f4c'); grd.addColorStop(1, fogCss);
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
});

const horizonTex = canvasTex(2048, 640, (g, w, h) => {
  const cx = w / 2, cy = 360, R = 230, base = 500;
  let grd = g.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 2.3);
  grd.addColorStop(0, 'rgba(255,60,140,0.5)'); grd.addColorStop(1, 'rgba(255,60,140,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.save(); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
  grd = g.createLinearGradient(0, cy - R, 0, cy + R);
  grd.addColorStop(0, '#fff27a'); grd.addColorStop(0.45, '#ffb000'); grd.addColorStop(1, '#ff2a6d');
  g.fillStyle = grd; g.fillRect(cx - R, cy - R, R * 2, R * 2);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 9; i++) g.fillRect(cx - R, cy + R * 0.05 + i * R * 0.11, R * 2, 2 + i * 2.2);
  g.restore();
  const range = (amp, fill, stroke, seed) => {
    const pts = [];
    for (let x = 0; x <= w + 60;) {
      const fall = 0.3 + 0.7 * Math.min(1, Math.abs(x - cx) / 700);
      const y = base - amp * fall * (0.3 + 0.7 * Math.abs(Math.sin(x * 0.004 + seed) * Math.cos(x * 0.0013 + seed * 2))) - hash(x + seed) * amp * 0.2;
      pts.push([x, y]); x += 40 + hash(x * 3 + seed) * 60;
    }
    g.beginPath(); g.moveTo(0, base); pts.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(w, base); g.closePath();
    g.fillStyle = fill; g.fill();
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.strokeStyle = stroke; g.lineWidth = 2.5; g.stroke();
  };
  range(150, '#1c0a36', '#ff2a6d', 1.3);
  range(95, '#110622', '#2de2e6', 4.1);
  grd = g.createLinearGradient(0, base - 70, 0, base);
  grd.addColorStop(0, 'rgba(42,15,72,0)'); grd.addColorStop(1, fogCss);
  g.fillStyle = grd; g.fillRect(0, base - 70, w, 70);
  g.fillStyle = fogCss; g.fillRect(0, base, w, h - base);
});

/* =========================================================
   World (road, grid, rails, lamps, arches, buildings, horizon)
   ========================================================= */
const world = { lampBase: null, archBase: null, bBase: null };
const ROAD_LEN = VIEW + 160;
const dummy = new THREE.Object3D();

const road = new THREE.Mesh(
  new THREE.PlaneGeometry(ROAD_W, ROAD_LEN),
  new THREE.MeshStandardMaterial({ map: roadTex, emissiveMap: roadGlowTex, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.78, metalness: 0.05, envMapIntensity: 0.15 })
);
road.rotation.x = -Math.PI / 2;
roadTex.repeat.set(1, ROAD_LEN / 24); roadGlowTex.repeat.set(1, ROAD_LEN / 24);
road.frustumCulled = false;
scene.add(road);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, ROAD_LEN), new THREE.MeshBasicMaterial({ map: gridTex }));
gridTex.repeat.set(900 / 8, ROAD_LEN / 8);
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.06; ground.frustumCulled = false;
scene.add(ground);

const neonMat = (hex, k = 2.2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), toneMapped: false });
const railGroup = new THREE.Group();
for (const side of [-1, 1]) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.9, ROAD_LEN), new THREE.MeshStandardMaterial({ color: 0x1a1030, roughness: 0.6, metalness: 0.4 }));
  wall.position.set(side * (ROAD_HALF + 0.2), 0.45, 0);
  const tube = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, ROAD_LEN), neonMat(0x2de2e6));
  tube.position.set(side * (ROAD_HALF + 0.2), 0.97, 0);
  railGroup.add(wall, tube);
}
railGroup.traverse((o) => (o.frustumCulled = false));
scene.add(railGroup);

// Street lamps (instanced)
const LAMP_GAP = 36, LAMPS_PER_SIDE = 16;
const poleGeo = new THREE.BoxGeometry(0.22, 8.5, 0.22); poleGeo.translate(0, 4.25, 0);
const headGeo = new THREE.BoxGeometry(2.4, 0.16, 0.45);
const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x241638, metalness: 0.6, roughness: 0.4 }), LAMPS_PER_SIDE * 2);
const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), LAMPS_PER_SIDE * 2);
poles.frustumCulled = heads.frustumCulled = false;
scene.add(poles, heads);
const lampColA = new THREE.Color(0xff2a6d).multiplyScalar(2.4), lampColB = new THREE.Color(0x2de2e6).multiplyScalar(2.4);

// Overhead arches (instanced)
const ARCH_GAP = 150, ARCHES = 5;
const archBarGeo = new THREE.BoxGeometry(ROAD_W + 5, 0.35, 0.35);
const archPostGeo = new THREE.BoxGeometry(0.35, 8, 0.35); archPostGeo.translate(0, 4, 0);
const archMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
const archBars = new THREE.InstancedMesh(archBarGeo, archMat, ARCHES);
const archPosts = new THREE.InstancedMesh(archPostGeo, archMat, ARCHES * 2);
archBars.frustumCulled = archPosts.frustumCulled = false;
scene.add(archBars, archPosts);

// City blocks (instanced)
const B_GAP = 24, B_ROWS = 22;
const bGeo = new THREE.BoxGeometry(1, 1, 1); bGeo.translate(0, 0.5, 0);
const buildings = new THREE.InstancedMesh(bGeo, new THREE.MeshStandardMaterial({ color: 0x120a22, roughness: 0.85, emissive: 0xffffff, emissiveMap: windowTex, emissiveIntensity: 1.3 }), B_ROWS * 2);
buildings.frustumCulled = false;
scene.add(buildings);

// Horizon: sun + mountains on one far plane, and a starfield
const horizon = new THREE.Mesh(new THREE.PlaneGeometry(2600, 812), new THREE.MeshBasicMaterial({ map: horizonTex, transparent: true, fog: false, depthWrite: false, toneMapped: false }));
horizon.rotation.y = Math.PI; // face back toward the camera
horizon.renderOrder = -1;
scene.add(horizon);

const starGeo = new THREE.BufferGeometry();
{
  const pts = [];
  while (pts.length < 700 * 3) {
    const v = new THREE.Vector3().randomDirection();
    if (v.y < 0.06) continue;
    if (v.z > 0 && Math.hypot(v.x, v.y - 0.35) < 0.55) continue; // keep the sun clear
    v.multiplyScalar(600); pts.push(v.x, v.y, v.z);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
}
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xd9ccff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
stars.renderOrder = -2;
scene.add(stars);

// Lights
scene.add(new THREE.HemisphereLight(0x8a7cff, 0x1a0a20, 1.3));
const keyLight = new THREE.DirectionalLight(0xffc3e6, 1.6);
const fillLight = new THREE.DirectionalLight(0x6fe7ff, 0.7);
scene.add(keyLight, keyLight.target, fillLight, fillLight.target);

function updateWorld(z) {
  const snap = Math.floor(z / 24) * 24;
  const mid = snap + ROAD_LEN / 2 - 120;
  road.position.z = mid; ground.position.z = mid; railGroup.position.z = mid;
  horizon.position.set(0, 229, z + 650);

  const lb = Math.floor(z / LAMP_GAP) - 2;
  if (lb !== world.lampBase) {
    world.lampBase = lb;
    let i = 0;
    for (let k = 0; k < LAMPS_PER_SIDE; k++) for (const side of [-1, 1]) {
      const kz = (lb + k) * LAMP_GAP;
      dummy.position.set(side * (ROAD_HALF + 1.4), 0, kz); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      poles.setMatrixAt(i, dummy.matrix);
      dummy.position.set(side * (ROAD_HALF + 0.4), 8.5, kz); dummy.updateMatrix();
      heads.setMatrixAt(i, dummy.matrix);
      heads.setColorAt(i, (lb + k) % 2 ? lampColA : lampColB);
      i++;
    }
    poles.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
    heads.instanceColor.needsUpdate = true;
  }

  const ab = Math.floor(z / ARCH_GAP) - 1;
  if (ab !== world.archBase) {
    world.archBase = ab;
    for (let k = 0; k < ARCHES; k++) {
      const n = ab + k, kz = n * ARCH_GAP + 60;
      const col = n % 2 ? lampColA : lampColB;
      dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
      dummy.position.set(0, 8, kz); dummy.updateMatrix(); archBars.setMatrixAt(k, dummy.matrix); archBars.setColorAt(k, col);
      for (let s = 0; s < 2; s++) {
        dummy.position.set((s ? 1 : -1) * (ROAD_W / 2 + 2.5), 0, kz); dummy.updateMatrix();
        archPosts.setMatrixAt(k * 2 + s, dummy.matrix); archPosts.setColorAt(k * 2 + s, col);
      }
    }
    archBars.instanceMatrix.needsUpdate = archPosts.instanceMatrix.needsUpdate = true;
    archBars.instanceColor.needsUpdate = archPosts.instanceColor.needsUpdate = true;
  }

  const bb = Math.floor(z / B_GAP) - 2;
  if (bb !== world.bBase) {
    world.bBase = bb;
    let i = 0;
    for (let k = bb; k < bb + B_ROWS; k++) for (const side of [-1, 1]) {
      const h1 = hash(k * 2 + (side > 0 ? 1 : 0)), h2 = hash(k * 7.3 + side * 3.1), h3 = hash(k * 1.7 - side * 9.2);
      const w = 8 + h2 * 14, d = 12 + h3 * 9, h = 8 + h1 * h1 * 55;
      dummy.position.set(side * (ROAD_HALF + 22 + h3 * 40 + w / 2), 0, k * B_GAP); dummy.rotation.set(0, 0, 0);
      dummy.scale.set(w, h, d); dummy.updateMatrix();
      buildings.setMatrixAt(i++, dummy.matrix);
    }
    buildings.instanceMatrix.needsUpdate = true;
  }

  keyLight.position.set(-30, 40, z + 80); keyLight.target.position.set(0, 0, z);
  fillLight.position.set(20, 25, z - 60); fillLight.target.position.set(0, 0, z);
}

/* =========================================================
   Car factory (extruded side profiles, modular breakable parts)
   ========================================================= */
const matCache = new Map();
const cached = (key, make) => { if (!matCache.has(key)) matCache.set(key, make()); return matCache.get(key); };
const paintMat = (hex) => cached('paint' + hex, () => new THREE.MeshPhysicalMaterial({ color: hex, metalness: 0.6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 }));
const glassMat = cached('glass', () => new THREE.MeshPhysicalMaterial({ color: 0x07060f, metalness: 0.2, roughness: 0.06, clearcoat: 1, envMapIntensity: 1.6 }));
const trimMat = cached('trim', () => new THREE.MeshStandardMaterial({ color: 0x14121c, metalness: 0.5, roughness: 0.5 }));
const tireMat = cached('tire', () => new THREE.MeshStandardMaterial({ color: 0x0c0b10, roughness: 0.9 }));
const rimMat = cached('rim', () => new THREE.MeshStandardMaterial({ color: 0xb8b8c8, metalness: 0.9, roughness: 0.3 }));
const headMat = cached('head', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3.3), toneMapped: false }));
const TAIL = new THREE.Color(2.6, 0.12, 0.28), TAIL_BRAKE = new THREE.Color(7, 0.35, 0.7);
const tailMat = cached('tail', () => new THREE.MeshBasicMaterial({ color: TAIL.clone(), toneMapped: false }));
const shadowMat = cached('shadow', () => new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.8 }));

function subdivide(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < n; j++) out.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]);
  }
  return out;
}
function extrudeProfile(pts, width, bevel) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const depth = Math.max(0.05, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(s, { depth, steps: 4, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 1 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2); // profile x axis becomes the car's forward (+z)
  g.computeVertexNormals();
  return g;
}

const kitCache = new Map();
function carKit(p) {
  if (kitCache.has(p.id)) return kitCache.get(p.id);
  const { L, W, r, prof: q } = p;
  const body = extrudeProfile(subdivide([[-L / 2, q.g], [L / 2, q.g], [L / 2, q.nose], [L * q.cf, q.beltF], [L * q.cr, q.beltR], [-L / 2, q.tail]], 0.3), W - 0.18, 0.06);
  const cabin = extrudeProfile([[L * q.cf + 0.06, q.beltF - 0.05], [L * q.rf, q.roof], [L * q.rr, q.roof], [L * q.cr - 0.06, q.beltR - 0.05]], W * 0.8, 0.05);
  const tire = new THREE.CylinderGeometry(r, r, 0.32, 22); tire.rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.34, 12); rim.rotateZ(Math.PI / 2);
  const spoke = new THREE.BoxGeometry(0.36, r * 1.15, 0.09);
  const kit = { body, cabin, tire, rim, spoke,
    head: new THREE.BoxGeometry(0.46, 0.09, 0.05),
    tail: new THREE.BoxGeometry(W * 0.78, 0.08, 0.05),
    splitter: new THREE.BoxGeometry(W * 0.92, 0.07, 0.32),
    hood: new THREE.BoxGeometry(W * 0.5, 0.05, L * (0.5 - q.cf) * 0.7),
    wing: new THREE.BoxGeometry(W * (p.wing === 'big' ? 0.98 : 0.86), 0.06, p.wing === 'big' ? 0.5 : 0.36),
    post: new THREE.BoxGeometry(0.08, 0.3, 0.12),
    lightbar: new THREE.BoxGeometry(W * 0.6, 0.1, 0.18),
    plate: new THREE.PlaneGeometry(1, 1)
  };
  kitCache.set(p.id, kit);
  return kit;
}

function buildCar(p, color, isPlayer) {
  const kit = carKit(p);
  const { L, W, r, prof: q } = p;
  const g = new THREE.Group();
  const parts = {};
  const paint = paintMat(color);

  const body = new THREE.Mesh(isPlayer ? kit.body.clone() : kit.body, paint);
  const cabin = new THREE.Mesh(kit.cabin, glassMat);
  g.add(body, cabin);

  const wheels = [];
  const wheelRim = isPlayer ? cached('rimglow' + color, () => neonMat(color, 1.6)) : rimMat;
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * (W / 2 - 0.16), r, sz * L * 0.31);
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(kit.tire, tireMat), new THREE.Mesh(kit.rim, wheelRim), new THREE.Mesh(kit.spoke, trimMat));
    pivot.add(spin); g.add(pivot);
    wheels.push({ pivot, spin, front: sz > 0 });
    parts[(sz > 0 ? 'wheelF' : 'wheelR') + (sx < 0 ? 'L' : 'R')] = pivot;
  }

  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(kit.head, headMat);
    h.position.set(sx * W * 0.3, q.nose - 0.07, L / 2 + 0.07);
    g.add(h);
  }
  const myTail = isPlayer ? tailMat.clone() : tailMat;
  const tail = new THREE.Mesh(kit.tail, myTail);
  tail.position.set(0, q.tail - 0.1, -L / 2 - 0.07);
  g.add(tail);

  const splitter = new THREE.Mesh(kit.splitter, trimMat);
  splitter.position.set(0, q.g + 0.02, L / 2 + 0.1);
  g.add(splitter); parts.splitter = splitter;

  const hood = new THREE.Mesh(kit.hood, trimMat);
  hood.position.set(0, (q.nose + q.beltF) / 2 + 0.045, L * (0.5 + q.cf) / 2);
  hood.rotation.x = Math.atan2(q.beltF - q.nose, L * (0.5 - q.cf));
  g.add(hood); parts.hood = hood;

  if (p.wing === 'lightbar') {
    const bar = new THREE.Mesh(kit.lightbar, cached('amberbar', () => neonMat(0xffb000, 2)));
    bar.position.set(0, q.roof + 0.1, L * q.rf - 0.1);
    g.add(bar); parts.spoiler = bar;
  } else {
    const sp = new THREE.Group();
    const wing = new THREE.Mesh(kit.wing, isPlayer ? paint : trimMat);
    wing.position.set(0, q.tail + 0.3, -L / 2 + 0.3);
    sp.add(wing);
    for (const sx of [-1, 1]) { const post = new THREE.Mesh(kit.post, trimMat); post.position.set(sx * W * 0.28, q.tail + 0.13, -L / 2 + 0.3); sp.add(post); }
    g.add(sp); parts.spoiler = sp;
  }

  const shadow = new THREE.Mesh(kit.plate, shadowMat);
  shadow.rotation.x = -Math.PI / 2; shadow.scale.set(W + 1.0, L + 0.9, 1); shadow.position.y = 0.025;
  g.add(shadow);

  if (isPlayer) {
    const glow = new THREE.Mesh(kit.plate, new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(color).multiplyScalar(0.45), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    glow.rotation.x = -Math.PI / 2; glow.scale.set(W + 1.2, L + 1.4, 1); glow.position.y = 0.035;
    g.add(glow);
    const beam = new THREE.SpotLight(0xf2f0ff, 6, 60, 0.45, 0.7, 1);
    beam.position.set(0, q.nose, L / 2);
    beam.target.position.set(0, 0, 30);
    g.add(beam, beam.target);
  }

  return { group: g, parts, body, wheels, tail: myTail, preset: p, color, halfW: W / 2, halfL: L / 2 + 0.08,
    ownedGeo: isPlayer ? body.geometry : null, ownedMats: isPlayer ? [myTail] : [] };
}

function disposeCar(car) {
  if (!car) return;
  car.group.parent?.remove(car.group);
  car.ownedGeo?.dispose();
  car.ownedMats.forEach((m) => m.dispose());
  car.group.traverse((o) => { if (o.isMesh && o.material?.map === glowTex) o.material.dispose(); });
}

// Dent the player's body around a local-space point. Duplicate vertices share a position, so they move together.
const _v = new THREE.Vector3(), _c = new THREE.Vector3();
function dentBody(car, localPoint, strength) {
  const pos = car.body.geometry.attributes.position;
  const radius = 1.4;
  _c.set(0, car.preset.prof.beltF * 0.7, 0);
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    const d = _v.distanceTo(localPoint);
    if (d > radius) continue;
    const f = (1 - d / radius) ** 2 * strength * (0.7 + 0.6 * hash(_v.x * 13.1 + _v.y * 7.7 + _v.z * 3.3));
    const dir = _c.clone().sub(_v).normalize();
    _v.addScaledVector(dir, f);
    pos.setXYZ(i, _v.x, _v.y, _v.z);
  }
  pos.needsUpdate = true;
  car.body.geometry.computeVertexNormals();
}

/* =========================================================
   Pickups
   ========================================================= */
const coinGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.12, 24); coinGeo.rotateX(Math.PI / 2);
const coinMat = new THREE.MeshStandardMaterial({ color: 0xffc23d, metalness: 1, roughness: 0.25, emissive: 0x6a3a00, emissiveIntensity: 1 });
const nitroGeo = new THREE.OctahedronGeometry(0.65);
const nitroMat = neonMat(0x2de2e6, 1.8);
const repairGeo = new THREE.IcosahedronGeometry(0.6);
const repairMat = neonMat(0x46ff9a, 1.6);

/* =========================================================
   Particles (pooled — nothing is allocated per frame)
   ========================================================= */
const sparkGeo = new THREE.BoxGeometry(0.05, 0.05, 0.28);
const sparkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.8, 0.6), toneMapped: false });
const sparks = Array.from({ length: 160 }, () => {
  const m = new THREE.Mesh(sparkGeo, sparkMat); m.visible = false; scene.add(m);
  return { m, v: new THREE.Vector3(), life: 0 };
});
let sparkCursor = 0;
function spawnSparks(pos, count, push = 0) {
  for (let i = 0; i < count; i++) {
    const s = sparks[sparkCursor = (sparkCursor + 1) % sparks.length];
    s.m.position.copy(pos);
    s.v.set(rand(-7, 7), rand(2, 8), rand(-4, 7) + push);
    s.life = rand(0.35, 0.8); s.m.visible = true; s.m.scale.setScalar(1);
  }
}

const smokes = Array.from({ length: 50 }, () => {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }));
  sp.visible = false; scene.add(sp);
  return { sp, life: 0, max: 1, vy: 0, vx: 0 };
});
let smokeCursor = 0;
function spawnSmoke(pos, dark, fire) {
  const s = smokes[smokeCursor = (smokeCursor + 1) % smokes.length];
  s.sp.position.copy(pos).add(_v.set(rand(-0.3, 0.3), 0, rand(-0.3, 0.3)));
  s.sp.material.color.setHex(fire ? 0xff7a2a : dark ? 0x2a2433 : 0x8a8098);
  s.sp.material.blending = fire ? THREE.AdditiveBlending : THREE.NormalBlending;
  s.max = s.life = fire ? 0.5 : rand(1.0, 1.6);
  s.vy = rand(1.2, 2.4); s.vx = rand(-0.4, 0.4);
  s.sp.scale.setScalar(rand(0.6, 1.0)); s.sp.visible = true;
}

const FLAMES = 70;
const flameGeo = new THREE.BufferGeometry();
flameGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FLAMES * 3), 3));
const flames = new THREE.Points(flameGeo, new THREE.PointsMaterial({ map: glowTex, color: new THREE.Color(0.25, 1.1, 1.4), size: 0.32, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
flames.frustumCulled = false; flames.visible = false;
const flameSeed = Array.from({ length: FLAMES }, () => Math.random());

const debris = [];
function detachPart(car, key, impulse) {
  const part = car.parts[key];
  if (!part || part.parent !== car.group) return;
  delete car.parts[key];
  scene.attach(part); // keeps its world transform
  debris.push({ obj: part, v: impulse, w: new THREE.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8)), life: 6 });
}

/* =========================================================
   Game state
   ========================================================= */
let phase = 'garage';          // garage | countdown | race | paused | over
let pausedFrom = null;
let timeScale = 1;
const input = { left: false, right: false, gas: false, brake: false, nitro: false };

const P = { car: null, x: 0, z: 0, y: 0, vy: 0, speed: 0, lat: 0, yaw: 0, roll: 0, pitch: 0, hp: 100, maxHp: 100,
  nitro: 100, nitroOn: false, invuln: 0, shake: 0, smokeT: 0, scrapeT: 0, spin: new THREE.Vector3(), steerVis: 0, braking: false };
const S = { score: 0, mult: 1, coins: 0, dist: 0, near: 0, best: Number(store.get('ct3d:best', 0)) || 0,
  carIndex: clamp(Number(store.get('ct3d:car', 0)) | 0, 0, PRESETS.length - 1), nextWave: 0, cdT: 0, cdStep: -1, overT: 0, overShown: false };
const traffic = [];
const items = [];

const preset = () => PRESETS[S.carIndex];

function setPlayerCar() {
  if (P.car) { P.car.group.remove(flames); disposeCar(P.car); }
  const p = preset();
  P.car = buildCar(p, p.color, true);
  P.car.group.add(flames);
  flames.position.set(0, p.prof.g + 0.12, -p.L / 2 - 0.1);
  scene.add(P.car.group);
  document.documentElement.style.setProperty('--car', '#' + new THREE.Color(p.color).getHexString());
}

function clearEntities() {
  traffic.forEach((t) => scene.remove(t.car.group)); traffic.length = 0;
  items.forEach((it) => scene.remove(it.mesh)); items.length = 0;
  debris.forEach((d) => scene.remove(d.obj)); debris.length = 0;
  sparks.forEach((s) => { s.life = 0; s.m.visible = false; });
  smokes.forEach((s) => { s.life = 0; s.sp.visible = false; });
}

/* =========================================================
   Traffic & pickups spawning
   ========================================================= */
const difficulty = () => clamp(S.dist / 9000, 0, 1);

function laneFree(laneX, z, gap, ignore) {
  return !traffic.some((t) => t !== ignore && Math.abs(t.targetX - laneX) < 1 && Math.abs(t.z - z) < gap);
}
function addTraffic(lane, z) {
  const x = LANES[lane];
  if (!laneFree(x, z, 16)) return;
  const p = PRESETS[(Math.random() * PRESETS.length) | 0];
  const car = buildCar(p, TRAFFIC_COLORS[(Math.random() * TRAFFIC_COLORS.length) | 0], false);
  car.group.position.set(x, 0, z);
  scene.add(car.group);
  traffic.push({ car, x, targetX: x, z, speed: rand(70, 115), cruise: 0, yaw: 0, laneT: rand(2, 6),
    wrecked: false, vx: 0, yawVel: 0, passed: false });
  traffic[traffic.length - 1].cruise = traffic[traffic.length - 1].speed;
}
function addItem(type, x, z) {
  const mesh = new THREE.Mesh(type === 'coin' ? coinGeo : type === 'nitro' ? nitroGeo : repairGeo, type === 'coin' ? coinMat : type === 'nitro' ? nitroMat : repairMat);
  mesh.position.set(x, 1, z);
  scene.add(mesh);
  items.push({ mesh, type });
}
function spawnWave(z) {
  const d = difficulty();
  const maxBlocked = d < 0.3 ? 1 : d < 0.65 ? 2 : 3;
  const n = 1 + ((Math.random() * maxBlocked) | 0);
  const lanes = shuffle([0, 1, 2, 3]);
  for (let i = 0; i < n; i++) addTraffic(lanes[i], z + rand(-5, 5) + i * rand(0, 16));
  const free = LANES[lanes[n]];
  const roll = Math.random();
  if (roll < 0.55) for (let i = 0; i < 5; i++) addItem('coin', free, z - 6 + i * 3.6);
  else if (roll < 0.68) addItem('nitro', free, z);
  else if (roll < 0.74 && P.hp < P.maxHp * 0.7) addItem('repair', free, z);
}
function spawnAhead() {
  while (S.nextWave < P.z + VIEW - 40) {
    spawnWave(S.nextWave);
    S.nextWave += (85 - 47 * difficulty()) * rand(0.85, 1.25);
  }
}

/* =========================================================
   Damage, collisions, near misses
   ========================================================= */
const _p = new THREE.Vector3();
function damage(amount, worldPoint, k) {
  const car = P.car;
  P.hp = Math.max(0, P.hp - amount);
  P.invuln = 0.9;
  P.shake = Math.min(1.2, P.shake + 0.35 + k * 0.6);
  if (S.mult > 1) pop('Combo lost', 'bad');
  S.mult = 1;
  sound.impact(k);
  spawnSparks(worldPoint, 10 + Math.round(k * 20), P.speed * MS_PER_KMH * 0.4);
  flashHit();

  dentBody(car, car.body.worldToLocal(_p.copy(worldPoint)), 0.12 + k * 0.28);

  const frac = P.hp / P.maxHp;
  const fling = () => new THREE.Vector3(rand(-6, 6), rand(4, 9), P.speed * MS_PER_KMH * rand(0.3, 0.6));
  if (frac < 0.8) detachPart(car, 'splitter', fling());
  if (frac < 0.6) detachPart(car, 'hood', fling());
  if (frac < 0.4) detachPart(car, 'spoiler', fling());
  if (frac < 0.18) detachPart(car, 'wheelFL', fling());

  if (P.hp <= 0) wreck();
}

function hitTraffic(t, dt) {
  const car = P.car;
  const dx = P.x - t.x, dz = P.z - t.z;
  const penX = car.halfW + t.car.halfW - 0.05 - Math.abs(dx);
  const penZ = car.halfL + t.car.halfL - 0.2 - Math.abs(dz);
  if (penX <= 0 || penZ <= 0) return;

  const sideHit = penX < penZ;
  if (sideHit) {
    const dir = Math.sign(dx) || 1;
    P.x += dir * (penX + 0.05);
    P.lat = dir * Math.max(3, Math.abs(P.lat) * 0.4);
    if (!t.wrecked) { t.vx -= dir * 2.5; t.yawVel -= dir * 0.8; }
    if (P.invuln > 0) return;
    const k = clamp(0.25 + Math.abs(P.lat) * 0.03, 0.2, 0.6);
    P.speed *= 0.88;
    damage(5 + P.speed * 0.035, _p.set(P.x - dir * car.halfW, 0.6, P.z), k);
  } else {
    const ahead = dz < 0; // the traffic car is in front of us
    const rel = Math.abs(P.speed - t.speed);
    P.z += (ahead ? -1 : 1) * (penZ + 0.05);
    if (P.invuln > 0) return;
    const k = clamp(rel / 120, 0.25, 1);
    const hit = ahead ? 10 + rel * 0.32 : 6;
    if (ahead) {
      P.speed = Math.max(0, Math.min(P.speed, t.speed) * 0.7 - 10);
      t.speed += rel * 0.4;
    }
    t.wrecked = true;
    t.vx = (Math.sign(t.x - P.x) || (Math.random() < 0.5 ? -1 : 1)) * rand(3, 6);
    t.yawVel = rand(-4, 4);
    pop('Crash', 'bad');
    damage(hit, _p.set(P.x, 0.6, P.z + (ahead ? car.halfL : -car.halfL)), k);
  }
}

function wreck() {
  phase = 'over';
  timeScale = 0.35;
  S.overT = 0; S.overShown = false;
  sound.engine(false, 0, 0); sound.nitro(false);
  sound.impact(1);
  sound.burst({ freq: 300, type: 'lowpass', dur: 1.4, vol: 0.6, sweep: 60, delay: 0.05 });
  const car = P.car;
  _p.set(P.x, 0.8, P.z);
  spawnSparks(_p, 60, P.speed * MS_PER_KMH * 0.3);
  for (let i = 0; i < 8; i++) spawnSmoke(_p, true, i < 4);
  for (const key of Object.keys(car.parts)) detachPart(car, key, new THREE.Vector3(rand(-7, 7), rand(5, 11), P.speed * MS_PER_KMH * rand(0.2, 0.7)));
  P.vy = 6; P.spin.set(rand(-2, 2), rand(-3, 3), rand(-4, 4));
  car.group.visible = true;
  flames.visible = false;
}

/* =========================================================
   Per-frame updates
   ========================================================= */
function updatePlayer(dt, controllable) {
  const p = preset(), car = P.car;
  const steer = controllable ? (input.left ? 1 : 0) - (input.right ? 1 : 0) : 0;
  const wantsNitro = controllable && input.nitro && P.nitro > 0.5;
  const brake = controllable && input.brake;
  const gas = controllable && (input.gas || wantsNitro);
  P.nitroOn = wantsNitro && !brake;
  P.braking = brake && P.speed > 1;

  if (P.nitroOn) P.nitro = Math.max(0, P.nitro - p.drain * dt);
  else P.nitro = Math.min(100, P.nitro + p.regen * dt);

  const limp = P.hp / P.maxHp < 0.25 ? 0.85 : 1;
  const top = (P.nitroOn ? p.boost : p.maxSpeed) * limp;
  if (brake) P.speed = Math.max(0, P.speed - 150 * dt);
  else if (gas) P.speed = P.speed < top ? damp(P.speed, top, P.nitroOn ? p.accel * 2.2 : p.accel, dt) : damp(P.speed, top, 1.2, dt);
  else P.speed = Math.max(0, P.speed - (6 + P.speed * 0.1) * dt);

  // Lateral motion with inertia
  const grip = clamp(0.25 + P.speed / 120, 0.25, 1);
  P.lat = damp(P.lat, steer * p.handling * grip, 9, dt);
  P.x += P.lat * dt;
  const limit = ROAD_HALF - car.halfW - 0.3;
  if (Math.abs(P.x) > limit) {
    const side = Math.sign(P.x);
    P.x = side * limit;
    if (P.speed > 40 && (Math.abs(P.lat) > 1 || steer === side)) {
      P.speed *= 1 - 0.5 * dt;
      P.scrapeT -= dt;
      if (P.scrapeT <= 0) {
        P.scrapeT = 0.07;
        spawnSparks(_p.set(P.x + side * car.halfW, 0.5, P.z + rand(-1, 1)), 3, P.speed * MS_PER_KMH * 0.5);
        sound.scrape();
        P.hp = Math.max(0, P.hp - 0.6);
        P.shake = Math.max(P.shake, 0.12);
        if (P.hp <= 0) { wreck(); return; }
      }
    }
    P.lat *= -0.2;
  }

  const ms = P.speed * MS_PER_KMH;
  P.z += ms * dt;
  if (controllable) {
    S.dist += ms * dt;
    S.score += ms * dt * S.mult;
  }

  // Body dynamics: yaw into the turn, roll outward, pitch on throttle/brake
  P.yaw = damp(P.yaw, P.lat * 0.012, 8, dt);
  P.roll = damp(P.roll, P.lat * 0.009, 6, dt);
  P.pitch = damp(P.pitch, brake && P.speed > 5 ? 0.045 : gas && P.speed < top * 0.9 ? -0.035 : 0, 5, dt);
  P.steerVis = damp(P.steerVis, steer * 0.35, 12, dt);

  const g = car.group;
  g.position.set(P.x, 0, P.z);
  g.rotation.set(P.pitch, P.yaw, P.roll);
  for (const w of car.wheels) { w.spin.rotation.x += ms * dt / p.r; if (w.front) w.pivot.rotation.y = P.steerVis; }
  car.tail.color.copy(P.braking ? TAIL_BRAKE : TAIL);

  if (P.invuln > 0) { P.invuln -= dt; g.visible = P.invuln <= 0 || Math.floor(P.invuln * 16) % 2 === 0; }
  else g.visible = true;

  // Damage smoke from the engine bay
  const hpFrac = P.hp / P.maxHp;
  if (hpFrac < 0.6) {
    P.smokeT -= dt;
    if (P.smokeT <= 0) {
      P.smokeT = 0.03 + hpFrac * 0.25;
      spawnSmoke(g.localToWorld(_p.set(0, p.prof.beltF, p.L * 0.32)), hpFrac < 0.35, hpFrac < 0.2 && Math.random() < 0.4);
    }
  }

  // Nitro flames
  flames.visible = P.nitroOn;
  if (P.nitroOn) {
    const arr = flameGeo.attributes.position.array, t = performance.now() / 1000;
    for (let i = 0; i < FLAMES; i++) {
      const f = (t * 3.2 + flameSeed[i]) % 1, side = i % 2 ? 1 : -1;
      arr[i * 3] = side * p.W * 0.22 + (flameSeed[(i + 7) % FLAMES] - 0.5) * 0.25 * f;
      arr[i * 3 + 1] = (flameSeed[(i + 3) % FLAMES] - 0.5) * 0.2 * f;
      arr[i * 3 + 2] = -f * 2.4;
    }
    flameGeo.attributes.position.needsUpdate = true;
  }

  // Engine sound with simulated gear changes
  const gearSpan = p.boost / 6;
  const gear = Math.min(6, Math.floor(P.speed / gearSpan) + 1);
  const rpm = clamp((P.speed - (gear - 1) * gearSpan) / gearSpan, 0, 1) * 0.75 + 0.25 + (gas && P.speed < 3 ? 0.15 : 0);
  sound.engine(true, P.speed / p.boost, rpm + gear * 0.06);
  sound.nitro(P.nitroOn);
  P.gear = P.speed < 1 && !gas ? 'N' : String(gear);
}

function updateTraffic(dt, collide) {
  const d = difficulty();
  for (let i = traffic.length - 1; i >= 0; i--) {
    const t = traffic[i];
    if (t.wrecked) {
      t.speed = Math.max(0, t.speed - 60 * dt);
      t.x += t.vx * dt; t.vx = damp(t.vx, 0, 1.5, dt);
      t.yaw += t.yawVel * dt; t.yawVel = damp(t.yawVel, 0, 1.2, dt);
      t.x = clamp(t.x, -ROAD_HALF + 1.2, ROAD_HALF - 1.2);
      if (Math.random() < dt * 6) spawnSmoke(_p.set(t.x, 1, t.z), true, false);
    } else {
      // Follow the car ahead in the same lane instead of driving through it
      let speed = t.cruise;
      for (const o of traffic) {
        if (o === t || Math.abs(o.x - t.targetX) > LANE_W * 0.5) continue;
        const gap = o.z - t.z;
        if (gap > 0 && gap < 18) speed = Math.min(speed, o.speed - (18 - gap));
      }
      t.speed = damp(t.speed, Math.max(20, speed), 2, dt);

      // Occasional lane changes as the run gets harder
      t.laneT -= dt;
      if (t.laneT <= 0) {
        t.laneT = rand(3, 7);
        if (Math.random() < 0.25 + d * 0.5 && t.z - P.z > 28) {
          const li = LANES.indexOf(t.targetX);
          const ni = li + (Math.random() < 0.5 ? -1 : 1);
          if (ni >= 0 && ni < LANES.length && laneFree(LANES[ni], t.z, 14, t)) t.targetX = LANES[ni];
        }
      }
      const prevX = t.x;
      t.x = damp(t.x, t.targetX, 1.4, dt);
      t.yaw = damp(t.yaw, (t.x - prevX) / Math.max(dt, 1e-3) * 0.04, 6, dt);
    }
    t.z += t.speed * MS_PER_KMH * dt;
    t.car.group.position.set(t.x, 0, t.z);
    t.car.group.rotation.y = t.yaw;
    for (const w of t.car.wheels) w.spin.rotation.x += t.speed * MS_PER_KMH * dt / t.car.preset.r;

    if (collide) {
      hitTraffic(t, dt);
      if (phase !== 'race') return;
      // Near miss: we fully passed it, close, at speed, without contact
      if (!t.passed && t.z + t.car.halfL < P.z - P.car.halfL) {
        t.passed = true;
        const gap = Math.abs(P.x - t.x) - P.car.halfW - t.car.halfW;
        if (!t.wrecked && gap < 1.1 && P.speed > 90) {
          S.near++;
          S.mult = Math.min(8, +(S.mult + 0.25).toFixed(2));
          S.score += 250 * S.mult;
          pop(`Near miss +${Math.round(250 * S.mult)}`, 'near');
          bumpMult();
          sound.whoosh();
        }
      }
    }

    if (t.z < P.z - 40 || t.z > P.z + VIEW + 200) { scene.remove(t.car.group); traffic.splice(i, 1); }
  }
}

function updateItems(dt) {
  const car = P.car;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    it.mesh.rotation.y += dt * 3;
    it.mesh.position.y = 1 + Math.sin(performance.now() / 300 + it.mesh.position.z) * 0.12;
    if (Math.abs(it.mesh.position.z - P.z) < car.halfL + 0.4 && Math.abs(it.mesh.position.x - P.x) < car.halfW + 0.5) {
      if (it.type === 'coin') { S.coins++; S.score += 100 * S.mult; sound.coin(); }
      else if (it.type === 'nitro') { P.nitro = 100; S.score += 50; pop('Nitro refilled', 'near'); sound.pickup(); }
      else { P.hp = Math.min(P.maxHp, P.hp + P.maxHp * 0.3); pop('Hull repaired', 'good'); sound.pickup(); }
      scene.remove(it.mesh); items.splice(i, 1);
    } else if (it.mesh.position.z < P.z - 20) {
      scene.remove(it.mesh); items.splice(i, 1);
    }
  }
}

function updateWreck(dt) {
  P.speed = damp(P.speed, 0, 1.4, dt);
  P.z += P.speed * MS_PER_KMH * dt;
  P.vy -= 20 * dt; P.y += P.vy * dt;
  if (P.y < 0) { P.y = 0; P.vy = Math.abs(P.vy) > 2 ? -P.vy * 0.35 : 0; P.spin.multiplyScalar(0.6); }
  const g = P.car.group;
  g.position.set(P.x, P.y, P.z);
  g.rotation.x += P.spin.x * dt; g.rotation.y += P.spin.y * dt; g.rotation.z += P.spin.z * dt;
  if (Math.random() < dt * 14) spawnSmoke(g.localToWorld(_p.set(0, 1, 0)), true, Math.random() < 0.35);
}

function updateEffects(dt) {
  for (const s of sparks) {
    if (s.life <= 0) continue;
    s.life -= dt;
    if (s.life <= 0) { s.m.visible = false; continue; }
    s.v.y -= 18 * dt;
    s.m.position.addScaledVector(s.v, dt);
    if (s.m.position.y < 0.05) { s.m.position.y = 0.05; s.v.y *= -0.3; s.v.x *= 0.6; }
    s.m.lookAt(_v.copy(s.m.position).add(s.v));
    s.m.scale.setScalar(Math.min(1, s.life * 2.5));
  }
  for (const s of smokes) {
    if (s.life <= 0) continue;
    s.life -= dt;
    if (s.life <= 0) { s.sp.visible = false; continue; }
    s.sp.position.y += s.vy * dt; s.sp.position.x += s.vx * dt;
    s.sp.scale.addScalar(dt * 1.6);
    s.sp.material.opacity = (s.life / s.max) * 0.7;
  }
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.life -= dt;
    d.v.y -= 22 * dt;
    d.obj.position.addScaledVector(d.v, dt);
    d.obj.rotation.x += d.w.x * dt; d.obj.rotation.y += d.w.y * dt; d.obj.rotation.z += d.w.z * dt;
    if (d.obj.position.y < 0.15) { d.obj.position.y = 0.15; d.v.y = Math.abs(d.v.y) * 0.35; d.v.x *= 0.7; d.v.z *= 0.7; d.w.multiplyScalar(0.7); }
    if (d.life <= 0 || d.obj.position.z < P.z - 60) { scene.remove(d.obj); debris.splice(i, 1); }
  }
}

/* =========================================================
   Camera
   ========================================================= */
const camOff = new THREE.Vector3(0, 3.2, -7.8);
let fov = 62, orbit = 0;

function applyViewOffset() {
  const w = innerWidth, h = innerHeight;
  if (phase === 'garage') {
    const aspect = w / h;
    if (aspect < 0.9) camera.setViewOffset(w, h, 0, h * 0.2, w, h);          // portrait: lift the car above the panel
    else if (w >= 900) camera.setViewOffset(w, h, -w * 0.18, h * 0.04, w, h); // wide: push the car right of the panel
    else camera.setViewOffset(w, h, 0, h * 0.14, w, h);
  } else camera.clearViewOffset();
}

function updateCamera(dt) {
  if (phase === 'garage') {
    const portrait = innerWidth / innerHeight < 0.9;
    camera.position.set(portrait ? 6 : 4.8, portrait ? 2.6 : 1.9, portrait ? -9.5 : -6.8);
    camera.lookAt(0, 0.6, 0.5);
    if (camera.fov !== 50) { camera.fov = 50; camera.updateProjectionMatrix(); }
    return;
  }
  const p = preset();
  if (phase === 'over') {
    orbit += dt * 0.5;
    const r = 10;
    camera.position.set(P.x + Math.sin(orbit) * r, 4.5, P.z + Math.cos(orbit) * r - 2);
    camera.lookAt(P.x, 0.8, P.z);
    return;
  }
  const sr = P.speed / p.boost;
  camOff.x = damp(camOff.x, P.x * 0.55, 5, dt);
  camOff.y = damp(camOff.y, 3.0 + sr * 0.6, 4, dt);
  camOff.z = damp(camOff.z, -7.6 - sr * 1.8, 4, dt);
  camera.position.set(camOff.x, camOff.y, P.z + camOff.z);
  if (P.shake > 0) {
    if (!reduceMotion) camera.position.add(_v.set(rand(-1, 1), rand(-1, 1), 0).multiplyScalar(P.shake * 0.35));
    P.shake = Math.max(0, P.shake - dt * 2.5);
  }
  camera.lookAt(P.x * 0.8, 1.1, P.z + 14);
  const targetFov = 62 + sr * 14 + (P.nitroOn ? 6 : 0);
  fov = damp(fov, targetFov, 4, dt);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
}

/* =========================================================
   HUD
   ========================================================= */
const H = {
  score: $('h-score'), mult: $('h-mult'), coins: $('h-coins'), dist: $('h-dist'),
  hp: $('h-hp'), hpBar: $('h-hp-bar'), hpWrap: $('h-hp-wrap'), nitroBar: $('h-nitro-bar'), nitroTxt: $('h-nitro-txt'),
  speed: $('h-speed'), gear: $('h-gear'), arc: $('h-arc'), fxSpeed: $('fx-speed')
};
const last = {};
const setText = (key, el, value) => { if (last[key] !== value) { last[key] = value; el.textContent = value; } };
const setStyle = (key, el, prop, value) => { if (last[key] !== value) { last[key] = value; el.style[prop] = value; } };

function updateHud() {
  const p = preset();
  setText('score', H.score, Math.floor(S.score).toLocaleString('en-US'));
  setText('mult', H.mult, '×' + (Math.round(S.mult * 10) === S.mult * 10 ? S.mult.toFixed(1) : S.mult.toFixed(2)));
  setText('coins', H.coins, String(S.coins));
  setText('dist', H.dist, (S.dist / 1000).toFixed(1));
  const hpPct = Math.ceil((P.hp / P.maxHp) * 100);
  setText('hp', H.hp, hpPct + '%');
  setStyle('hpw', H.hpBar, 'transform', `scaleX(${hpPct / 100})`);
  setStyle('hpc', H.hpBar, 'backgroundColor', hpPct > 60 ? '#2de2e6' : hpPct > 30 ? '#ffb000' : '#ff2a6d');
  H.hpWrap.classList.toggle('crit', hpPct <= 25);
  setStyle('nb', H.nitroBar, 'transform', `scaleX(${(P.nitro / 100).toFixed(3)})`);
  setText('nt', H.nitroTxt, P.nitroOn ? 'Boosting' : P.nitro >= 99.5 ? 'Ready' : 'Charging');
  setText('spd', H.speed, String(Math.round(P.speed)));
  setText('gear', H.gear, P.gear === 'N' ? 'N' : 'Gear ' + P.gear);
  setStyle('arc', H.arc, 'strokeDasharray', `${(Math.min(1, P.speed / p.boost) * 235.6).toFixed(1)} 314.2`);
  setStyle('fx', H.fxSpeed, 'opacity', reduceMotion ? '0' : P.nitroOn ? '1' : P.speed > p.maxSpeed * 0.92 ? '0.35' : '0');
}

function pop(text, kind) {
  const box = $('pops');
  while (box.children.length > 3) box.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = 'pop ' + kind; el.textContent = text;
  el.addEventListener('animationend', () => el.remove());
  box.appendChild(el);
}
function bumpMult() { H.mult.classList.add('bump'); setTimeout(() => H.mult.classList.remove('bump'), 150); }
function flashHit() { const el = $('fx-hit'); el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); }

/* =========================================================
   Screens & flow
   ========================================================= */
function show(id, on) { $(id).hidden = !on; }

function renderGarage() {
  const p = preset();
  $('g-name').textContent = p.name;
  $('g-tag').textContent = p.tag;
  $('g-best').textContent = Math.floor(S.best).toLocaleString('en-US');
  $('g-dots').innerHTML = PRESETS.map((_, i) => `<i class="${i === S.carIndex ? 'on' : ''}"></i>`).join('');
  const handling = p.handling >= 17 ? 'Razor' : p.handling >= 15 ? 'Sharp' : p.handling >= 13 ? 'Steady' : 'Heavy';
  const stats = [
    ['Top speed', `${p.maxSpeed} km/h`, (p.maxSpeed - 160) / 95],
    ['0–100', `${zeroTo100(p).toFixed(1)} s`, (p.accel - 0.28) / 0.3],
    ['Handling', handling, (p.handling - 10) / 8],
    ['Armor', `${p.hp} hp`, p.hp / 170],
    ['Nitro', p.regen / p.drain > 0.3 ? 'Long burn' : 'Standard', (p.regen / p.drain) * 1.6]
  ];
  $('g-stats').innerHTML = stats.map(([k, v, f]) =>
    `<div class="stat"><dt><span>${k}</span><b>${v}</b></dt><dd><i style="transform:scaleX(${clamp(f, 0.06, 1).toFixed(2)})"></i></dd></div>`).join('');
  updateOptionLabels();
}

function updateOptionLabels() {
  $('g-quality').textContent = 'Graphics: ' + quality;
  $('g-sound').textContent = 'Sound: ' + (sound.muted ? 'off' : 'on');
  const btn = $('b-sound');
  btn.setAttribute('aria-label', sound.muted ? 'Turn sound on' : 'Mute sound');
  btn.querySelector('use').setAttribute('href', sound.muted ? '#i-mute' : '#i-sound');
}

function switchCar(step) {
  S.carIndex = (S.carIndex + step + PRESETS.length) % PRESETS.length;
  store.set('ct3d:car', S.carIndex);
  const rot = P.car ? P.car.group.rotation.y : 0;
  setPlayerCar();
  P.car.group.rotation.y = rot;
  P.car.group.scale.setScalar(0.92);
  renderGarage();
}

function enterGarage() {
  keepAwake(false);
  phase = 'garage'; pausedFrom = null; timeScale = 1;
  clearEntities();
  P.x = 0; P.z = 0; P.y = 0; P.speed = 0;
  setPlayerCar();
  P.car.group.position.set(0, 0, 0);
  P.car.group.rotation.set(0, 2.4, 0);
  flames.visible = false;
  sound.engine(false, 0, 0); sound.nitro(false);
  show('hud', false); show('modal', false); show('countdown', false); show('garage', true);
  applyViewOffset(); camera.updateProjectionMatrix();
  renderGarage();
}

// Keep the screen awake while racing (supported in Chrome, Edge and Safari 16.4+)
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      const lock = wakeLock; wakeLock = null; await lock.release();
    }
  } catch { wakeLock = null; }
}

function startRace() {
  sound.ensure();
  keepAwake(true);
  clearEntities();
  setPlayerCar();
  const p = preset();
  Object.assign(P, { x: 0, z: 0, y: 0, vy: 0, speed: 0, lat: 0, yaw: 0, roll: 0, pitch: 0, hp: p.hp, maxHp: p.hp,
    nitro: 100, nitroOn: false, invuln: 0, shake: 0, smokeT: 0, scrapeT: 0, steerVis: 0, gear: 'N' });
  Object.assign(S, { score: 0, mult: 1, coins: 0, dist: 0, near: 0, nextWave: 150, cdT: 0, cdStep: -1 });
  Object.keys(input).forEach((k) => (input[k] = false));
  camOff.set(0, 3.2, -7.8); fov = 62; timeScale = 1;
  phase = 'countdown';
  show('garage', false); show('modal', false); show('m-over', false); show('m-pause', false); show('hud', true); show('countdown', true);
  $('pops').replaceChildren();
  applyViewOffset();
  spawnAhead();
  updateHud();
}

function updateCountdown(dt) {
  S.cdT += dt;
  const step = Math.floor(S.cdT / 0.8);
  if (step !== S.cdStep) {
    S.cdStep = step;
    const label = ['3', '2', '1', 'Go'][step];
    if (label) { $('countdown').innerHTML = `<span>${label}</span>`; sound.beep(step === 3); }
    if (step === 3) phase = 'race';
  }
}

function togglePause(force) {
  if (phase === 'race' || phase === 'countdown') {
    if (force === false) return;
    pausedFrom = phase; phase = 'paused';
    keepAwake(false);
    sound.engine(false, 0, 0); sound.nitro(false);
    show('modal', true); show('m-pause', true); show('m-over', false);
    $('m-resume').focus({ preventScroll: true });
  } else if (phase === 'paused' && force !== true) {
    phase = pausedFrom || 'race'; pausedFrom = null;
    sound.ensure();
    keepAwake(true);
    show('modal', false); show('m-pause', false);
    Object.keys(input).forEach((k) => (input[k] = false));
  }
}

function showResults() {
  S.overShown = true;
  keepAwake(false);
  timeScale = 1;
  const score = Math.floor(S.score);
  const record = score > S.best;
  if (record) { S.best = score; store.set('ct3d:best', score); }
  $('o-score').textContent = score.toLocaleString('en-US');
  $('o-dist').textContent = (S.dist / 1000).toFixed(1) + ' km';
  $('o-coins').textContent = String(S.coins);
  $('o-near').textContent = String(S.near);
  $('o-sub').textContent = S.dist < 300 ? 'That ended quickly. Ease off near the rails.' : 'The hull gave out.';
  show('o-best', record);
  show('hud', false); show('modal', true); show('m-over', true); show('m-pause', false);
  $('o-retry').focus({ preventScroll: true });
}

/* =========================================================
   Input
   ========================================================= */
const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'gas', KeyW: 'gas',
  ArrowDown: 'brake', KeyS: 'brake', Space: 'nitro', ShiftLeft: 'nitro', ShiftRight: 'nitro' };

addEventListener('keydown', (e) => {
  if (phase === 'garage') {
    if (e.code === 'ArrowLeft') { e.preventDefault(); switchCar(-1); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); switchCar(1); }
    else if (e.code === 'Enter' && document.activeElement === document.body) startRace();
    return;
  }
  if (e.code === 'KeyP' || e.code === 'Escape') { e.preventDefault(); if (!e.repeat) togglePause(); return; }
  if (phase === 'over' && S.overShown && e.code === 'Enter' && document.activeElement === document.body) { startRace(); return; }
  const k = KEYMAP[e.code];
  if (k && (phase === 'race' || phase === 'countdown')) { e.preventDefault(); input[k] = true; }
});
addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) input[k] = false; });
addEventListener('blur', () => { Object.keys(input).forEach((k) => (input[k] = false)); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { togglePause(true); sound.suspend(); }
});

document.querySelectorAll('.t-btn').forEach((btn) => {
  const key = btn.dataset.key;
  const up = () => { input[key] = false; btn.classList.remove('down'); };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    input[key] = true; btn.classList.add('down');
    try { btn.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  });
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('lostpointercapture', up);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
});
if (coarse) document.body.classList.add('is-touch');
addEventListener('touchstart', () => document.body.classList.add('is-touch'), { once: true, passive: true });

$('g-prev').addEventListener('click', () => switchCar(-1));
$('g-next').addEventListener('click', () => switchCar(1));
$('g-start').addEventListener('click', startRace);
$('o-retry').addEventListener('click', startRace);
$('o-garage').addEventListener('click', enterGarage);
$('m-resume').addEventListener('click', () => togglePause());
$('m-quit').addEventListener('click', enterGarage);
$('b-pause').addEventListener('click', () => togglePause());
const toggleSound = () => { sound.ensure(); sound.setMuted(!sound.muted); updateOptionLabels(); };
$('b-sound').addEventListener('click', toggleSound);
$('g-sound').addEventListener('click', toggleSound);
$('g-quality').addEventListener('click', () => { quality = quality === 'high' ? 'low' : 'high'; store.set('ct3d:quality', quality); resize(); updateOptionLabels(); });

/* =========================================================
   Resize & main loop
   ========================================================= */
function pixelRatio() {
  const dpr = window.devicePixelRatio || 1;
  return quality === 'high' ? Math.min(dpr, coarse ? 1.5 : 2) : Math.min(dpr, 1);
}
function resize() {
  const w = innerWidth, h = innerHeight, pr = pixelRatio();
  renderer.setPixelRatio(pr); renderer.setSize(w, h);
  composer.setPixelRatio(pr); composer.setSize(w, h);
  camera.aspect = w / h;
  applyViewOffset();
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

let lastT = performance.now();
function frame(now) {
  const raw = Math.min(0.05, Math.max(0, (now - lastT) / 1000));
  lastT = now;
  const dt = raw * timeScale;

  switch (phase) {
    case 'garage': {
      const g = P.car.group;
      g.rotation.y += raw * 0.45;
      g.scale.setScalar(damp(g.scale.x, 1, 14, raw));
      for (const w of P.car.wheels) w.pivot.rotation.y = 0;
      break;
    }
    case 'countdown':
      updateCountdown(raw);
      updatePlayer(raw, false);
      updateTraffic(raw, false);
      break;
    case 'race':
      updatePlayer(dt, true);
      if (phase === 'race') updateTraffic(dt, true);
      if (phase === 'race') { updateItems(dt); spawnAhead(); }
      break;
    case 'over':
      updateWreck(dt);
      updateTraffic(dt, false);
      S.overT += raw;
      if (!S.overShown && S.overT > 1.6) showResults();
      break;
  }

  if (phase !== 'paused') {
    updateEffects(dt);
    updateWorld(phase === 'garage' ? 0 : P.z);
    updateCamera(raw);
    stars.position.copy(camera.position);
    if (phase === 'race' || phase === 'countdown') updateHud();
  }

  if (quality === 'high') composer.render(); else renderer.render(scene, camera);
}

resize();
enterGarage();
renderer.setAnimationLoop(frame);
