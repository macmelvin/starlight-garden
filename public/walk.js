// The Lantern Walk: a starlit garden path lined with memorial niches.
import * as THREE from "/static/three.js";

const root = document.querySelector("[data-walk]");
const canvas = root.querySelector("[data-walk-canvas]");
const DATA = JSON.parse(document.getElementById("walk-data").textContent);
const PETS = DATA.pets;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- layout ----------
const HALF_W = 3; // path half-width (walls at x = ±3)
const COLS = 5; // niche columns per bay
const ROWS = 4;
const BAYS = 7;
const COL_W = 0.95;
const PILLAR_W = 0.5;
const BAY_LEN = COLS * COL_W + PILLAR_W;
const Z0 = -2; // where the first bay starts
const LEN = BAYS * BAY_LEN;
const Z_END = Z0 - LEN;
const ROW_Y = [0.55, 1.15, 1.75, 2.35];
const PLATE_W = 0.78;
const PLATE_H = 0.5;
const WALL_H = 3.0;

// Every slot on both side walls. Eye-level rows near the entrance fill first,
// so a pet keeps its place as new friends arrive (pets are ordered oldest first).
const slots = [];
for (let b = 0; b < BAYS; b++)
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r < ROWS; r++)
      for (const side of [-1, 1]) {
        const z = Z0 - b * BAY_LEN - PILLAR_W - (c + 0.5) * COL_W;
        slots.push({ bay: b, col: c, row: r, side, x: side * (HALF_W - 0.06), y: ROW_Y[r], z });
      }
const rowPref = { 1: 0, 2: 1, 0: 2, 3: 3 };
const order = slots
  .map((s, i) => i)
  .sort((a, b) => {
    const A = slots[a], B = slots[b];
    return A.bay - B.bay || rowPref[A.row] - rowPref[B.row] || A.col - B.col || A.side - B.side;
  });
PETS.forEach((p, i) => {
  if (i < order.length) {
    slots[order[i]].pet = p;
    p.slot = slots[order[i]];
  }
});

const countEl = root.querySelector("[data-walk-count]");
countEl.textContent = `${slots.length} niches · ${PETS.length} ${PETS.length === 1 ? "friend" : "friends"}`;

// ---------- renderer ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
} catch (e) {
  root.querySelector("[data-walk-fallback]").hidden = false;
  root.querySelector("[data-walk-loading]").hidden = true;
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101628);
scene.fog = new THREE.Fog(0x141b30, 14, 42);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 200);

scene.add(new THREE.HemisphereLight(0x8fa3d6, 0x2a2a22, 1.25));
const moon = new THREE.DirectionalLight(0xc8d4ff, 1.1);
moon.position.set(-6, 14, 4);
scene.add(moon);

// ---------- canvas textures ----------
function canvasTex(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function noiseFill(ctx, w, h, base, spread, n) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = Math.random() * spread;
    ctx.fillStyle = `rgba(${v > spread / 2 ? "255,255,255" : "0,0,0"},${(Math.random() * 0.05).toFixed(3)})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 2 + Math.random() * 6);
  }
}

const stoneTex = canvasTex(256, 256, (ctx, w, h) => noiseFill(ctx, w, h, "#d9d2c3", 10, 900));
stoneTex.wrapS = stoneTex.wrapT = THREE.RepeatWrapping;

const pathTex = canvasTex(512, 512, (ctx, w, h) => {
  noiseFill(ctx, w, h, "#cfc6b5", 10, 1400);
  ctx.strokeStyle = "rgba(90,80,60,0.35)";
  ctx.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath(); ctx.moveTo(0, (i * h) / 4); ctx.lineTo(w, (i * h) / 4); ctx.stroke();
  }
  for (let r = 0; r < 4; r++)
    for (let i = 0; i <= 2; i++) {
      const x = ((i + (r % 2) * 0.5) * w) / 2;
      ctx.beginPath(); ctx.moveTo(x, (r * h) / 4); ctx.lineTo(x, ((r + 1) * h) / 4); ctx.stroke();
    }
});
pathTex.wrapS = pathTex.wrapT = THREE.RepeatWrapping;
pathTex.repeat.set(3, LEN / 2);

const grassTex = canvasTex(256, 256, (ctx, w, h) => {
  ctx.fillStyle = "#24382c";
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = `rgba(${60 + Math.random() * 40},${100 + Math.random() * 50},${70 + Math.random() * 30},0.5)`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 3 + Math.random() * 4);
  }
});
grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
grassTex.repeat.set(20, 20);

const emptyPlateTex = canvasTex(256, 164, (ctx, w, h) => {
  noiseFill(ctx, w, h, "#ece6d9", 8, 200);
  ctx.strokeStyle = "rgba(78,107,82,0.55)";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(w / 2, h * 0.42, w * 0.2, h * 0.24, 0, 0, Math.PI * 2); ctx.stroke();
  // small star in the ring
  ctx.fillStyle = "rgba(232,176,75,0.55)";
  star(ctx, w / 2, h * 0.42, 12, 5);
  ctx.fillStyle = "#4E6B52";
  ctx.fillRect(w * 0.36, h * 0.8, w * 0.28, 5);
});

function star(ctx, x, y, r, inner) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 ? inner : r;
    ctx[i ? "lineTo" : "moveTo"](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function glowTex(color) {
  return canvasTex(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, color);
    g.addColorStop(0.25, color.replace(/,[\d.]+\)$/, ",0.45)"));
    g.addColorStop(1, color.replace(/,[\d.]+\)$/, ",0)"));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}
const warmGlow = glowTex("rgba(255,200,110,1)");

// ---------- ground ----------
const grass = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ map: grassTex }));
grass.rotation.x = -Math.PI / 2;
grass.position.set(0, -0.01, Z_END / 2);
scene.add(grass);

const path = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, LEN + 6), new THREE.MeshLambertMaterial({ map: pathTex }));
path.rotation.x = -Math.PI / 2;
path.position.set(0, 0, Z0 - LEN / 2 + 3);
scene.add(path);

const flickers = [];

// ---------- walls ----------
const stoneMat = new THREE.MeshLambertMaterial({ map: stoneTex, color: 0xf3eee4 });
const darkStoneMat = new THREE.MeshLambertMaterial({ map: stoneTex, color: 0xd2c8b3 });
for (const side of [-1, 1]) {
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.4, WALL_H, LEN), stoneMat);
  back.position.set(side * (HALF_W + 0.2), WALL_H / 2, Z0 - LEN / 2);
  scene.add(back);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, LEN + 0.3), darkStoneMat);
  cap.position.set(side * (HALF_W + 0.15), WALL_H + 0.08, Z0 - LEN / 2);
  scene.add(cap);
  // pillars between bays, each with a lantern
  for (let b = 0; b <= BAYS; b++) {
    const z = Z0 - b * BAY_LEN - PILLAR_W / 2;
    const zz = b === BAYS ? Z_END + PILLAR_W / 2 : z;
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.34, WALL_H + 0.25, PILLAR_W), darkStoneMat);
    p.position.set(side * (HALF_W - 0.05), (WALL_H + 0.25) / 2, zz);
    scene.add(p);
    addLantern(side * (HALF_W - 0.3), 2.55, zz);
  }
  // shelves under each row
  for (const y of ROW_Y) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, LEN), darkStoneMat);
    shelf.position.set(side * (HALF_W - 0.06), y - PLATE_H / 2 - 0.05, Z0 - LEN / 2);
    scene.add(shelf);
  }
}

// end wall with the garden's name
const endWall = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2 + 0.8, WALL_H + 0.6, 0.4), stoneMat);
endWall.position.set(0, (WALL_H + 0.6) / 2, Z_END - 0.2);
scene.add(endWall);
const signTex = canvasTex(1024, 300, (ctx, w, h) => {
  noiseFill(ctx, w, h, "#1B2236", 6, 200);
  ctx.strokeStyle = "#E8B04B";
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, w - 28, h - 28);
  ctx.fillStyle = "#F2EEE6";
  ctx.textAlign = "center";
  ctx.font = '84px Marcellus, Georgia, serif';
  ctx.fillText("STARLIGHT GARDEN", w / 2, h * 0.5);
  ctx.fillStyle = "#E8B04B";
  ctx.font = '600 30px "Source Sans 3", sans-serif';
  ctx.fillText("EVERY FRIEND IS REMEMBERED HERE", w / 2, h * 0.76);
  star(ctx, 70, h / 2 - 20, 22, 9);
  star(ctx, w - 70, h / 2 - 20, 22, 9);
});
const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.35), new THREE.MeshBasicMaterial({ map: signTex }));
sign.position.set(0, 2.3, Z_END + 0.01);
scene.add(sign);
addLantern(-2.6, 1.6, Z_END + 0.25);
addLantern(2.6, 1.6, Z_END + 0.25);

// entrance arch
for (const side of [-1, 1]) {
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.45, 3.6, 0.45), darkStoneMat);
  post.position.set(side * (HALF_W - 0.1), 1.8, Z0 + 0.3);
  scene.add(post);
}
const lintel = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2 + 0.4, 0.35, 0.5), darkStoneMat);
lintel.position.set(0, 3.7, Z0 + 0.3);
scene.add(lintel);

// ---------- lanterns ----------
function addLantern(x, y, z) {
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.24, 0.16),
    new THREE.MeshBasicMaterial({ color: 0xffd28a })
  );
  body.position.set(x, y, z);
  scene.add(body);
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.1, 4), new THREE.MeshLambertMaterial({ color: 0x3a2f22 }));
  top.position.set(x, y + 0.17, z);
  top.rotation.y = Math.PI / 4;
  scene.add(top);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: warmGlow, color: 0xffc070, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 }));
  glow.scale.set(1.3, 1.3, 1);
  glow.position.set(x, y, z);
  scene.add(glow);
  flickers.push(glow);
}

// a few real lights so the walls glow warmly
const lightZ = [Z0 - BAY_LEN * 1, Z0 - BAY_LEN * 3.5, Z0 - BAY_LEN * 6];
for (const z of lightZ) {
  const l = new THREE.PointLight(0xffb867, 9, 11, 1.6);
  l.position.set(0, 2.8, z);
  scene.add(l);
}

// ---------- niches ----------
const recessGeo = new THREE.BoxGeometry(0.1, PLATE_H + 0.08, PLATE_W + 0.08);
const recessMat = new THREE.MeshLambertMaterial({ color: 0xa69c88 });
const recesses = new THREE.InstancedMesh(recessGeo, recessMat, slots.length);
const plateGeo = new THREE.PlaneGeometry(PLATE_W, PLATE_H);
const emptySlots = slots.filter((s) => !s.pet);
const emptyPlates = new THREE.InstancedMesh(plateGeo, new THREE.MeshLambertMaterial({ map: emptyPlateTex }), emptySlots.length);
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const one = new THREE.Vector3(1, 1, 1);
slots.forEach((s, i) => {
  m4.compose(new THREE.Vector3(s.x - s.side * 0.0, s.y, s.z), q.identity(), one);
  recesses.setMatrixAt(i, m4);
});
const faceQ = (side) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), side < 0 ? Math.PI / 2 : -Math.PI / 2);
emptySlots.forEach((s, i) => {
  m4.compose(new THREE.Vector3(s.x - s.side * 0.056, s.y, s.z), faceQ(s.side), one);
  emptyPlates.setMatrixAt(i, m4);
});
scene.add(recesses, emptyPlates);

const portraitMeshes = [];
const candleGlows = [];
const fontsReady = document.fonts ? document.fonts.load('40px Marcellus').catch(() => {}) : Promise.resolve();

function drawPetPlate(ctx, w, h, pet, img) {
  noiseFill(ctx, w, h, "#f6efdc", 6, 150);
  // gold frame
  ctx.strokeStyle = "#C9963C";
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, w - 8, h - 8);
  const ph = h * 0.66;
  const pw = ph;
  const px = (w - pw) / 2;
  const py = 18;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(px + pw / 2, py + ph / 2, pw / 2, ph / 2, 0, 0, Math.PI * 2);
  ctx.clip();
  if (img) {
    const s = Math.max(pw / img.width, ph / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, px + (pw - dw) / 2, py + (ph - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = "#D9E2D6";
    ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = "#4E6B52";
    ctx.font = `${Math.round(ph * 0.5)}px Marcellus, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(pet.name.slice(0, 1).toUpperCase(), px + pw / 2, py + ph / 2 + 4);
  }
  ctx.restore();
  ctx.strokeStyle = "#E8B04B";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(px + pw / 2, py + ph / 2, pw / 2, ph / 2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#1B2236";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  let size = 40;
  ctx.font = `${size}px Marcellus, Georgia, serif`;
  while (ctx.measureText(pet.name).width > w - 40 && size > 20) ctx.font = `${--size}px Marcellus, Georgia, serif`;
  ctx.fillText(pet.name, w / 2, h - 22);
}

for (const s of slots) {
  if (!s.pet) continue;
  const pet = s.pet;
  const c = document.createElement("canvas");
  c.width = 384;
  c.height = 246;
  const ctx = c.getContext("2d");
  drawPetPlate(ctx, c.width, c.height, pet, null);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(plateGeo, new THREE.MeshBasicMaterial({ map: tex, color: 0xeeeeee }));
  mesh.position.set(s.x - s.side * 0.057, s.y, s.z);
  mesh.quaternion.copy(faceQ(s.side));
  mesh.userData.pet = pet;
  scene.add(mesh);
  portraitMeshes.push(mesh);
  const redraw = (img) => fontsReady.then(() => { drawPetPlate(ctx, c.width, c.height, pet, img); tex.needsUpdate = true; });
  redraw(null);
  if (pet.photo) {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => redraw(img);
    img.src = pet.photo;
  }
  if (pet.candles > 0) {
    const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: warmGlow, color: 0xffb050, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    const sz = 0.22 + Math.min(pet.candles, 40) / 120;
    g.scale.set(sz, sz, 1);
    g.position.set(s.x - s.side * 0.2, s.y - PLATE_H / 2 + 0.02, s.z + 0.3);
    g.userData.base = sz;
    scene.add(g);
    candleGlows.push(g);
    const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.06, 8), new THREE.MeshBasicMaterial({ color: 0xfff1d0 }));
    wick.position.set(s.x - s.side * 0.2, s.y - PLATE_H / 2 - 0.02, s.z + 0.3);
    scene.add(wick);
  }
}

// ---------- sky ----------
const starGeo = new THREE.BufferGeometry();
const starPos = [];
for (let i = 0; i < 1800; i++) {
  const th = Math.random() * Math.PI * 2;
  const ph = Math.acos(Math.random() * 0.95);
  const r = 120;
  starPos.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) + 2, r * Math.sin(ph) * Math.sin(th) + Z_END / 2);
}
starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.55, sizeAttenuation: true, transparent: true, opacity: 0.9, fog: false });
scene.add(new THREE.Points(starGeo, starMat));
// one bright star for each friend, high over the walk
const petStarGeo = new THREE.BufferGeometry();
const ps = PETS.map((p, i) => [Math.sin(i * 2.4) * 30, 45 + (i % 5) * 4, Z_END / 2 - 20 + Math.cos(i * 2.4) * 25]).flat();
petStarGeo.setAttribute("position", new THREE.Float32BufferAttribute(ps, 3));
const petStarMat = new THREE.PointsMaterial({ map: warmGlow, color: 0xffe2a0, size: 4, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
scene.add(new THREE.Points(petStarGeo, petStarMat));
const moonMesh = new THREE.Mesh(new THREE.CircleGeometry(4, 40), new THREE.MeshBasicMaterial({ color: 0xf3ecd8, fog: false }));
moonMesh.position.set(-40, 55, Z_END - 40);
moonMesh.lookAt(0, 2, 0);
scene.add(moonMesh);
const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex("rgba(220,228,255,0.9)"), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
moonGlow.scale.set(26, 26, 1);
moonGlow.position.copy(moonMesh.position);
scene.add(moonGlow);

// trees beyond the walls
const treeMat = new THREE.MeshLambertMaterial({ color: 0x1d3326 });
const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3a2c20 });
for (let i = 0; i < 26; i++) {
  const side = i % 2 ? 1 : -1;
  const x = side * (HALF_W + 2.5 + Math.random() * 6);
  const z = Z0 + 4 - Math.random() * (LEN + 14);
  const h = 4 + Math.random() * 3;
  const crown = new THREE.Mesh(new THREE.ConeGeometry(1.2 + Math.random() * 0.7, h, 7), treeMat);
  crown.position.set(x, h / 2 + 0.9, z);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1, 6), trunkMat);
  trunk.position.set(x, 0.5, z);
  scene.add(crown, trunk);
}

// fireflies
const FF = reduceMotion ? 0 : 60;
const ffGeo = new THREE.BufferGeometry();
const ffBase = [];
for (let i = 0; i < FF; i++) ffBase.push([(Math.random() * 2 - 1) * (HALF_W - 0.5), 0.4 + Math.random() * 2.6, Z0 + 2 - Math.random() * (LEN + 2), Math.random() * 10]);
const ffArr = new Float32Array(FF * 3);
ffGeo.setAttribute("position", new THREE.BufferAttribute(ffArr, 3));
const ffMat = new THREE.PointsMaterial({ map: warmGlow, color: 0xfff0a0, size: 0.18, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
scene.add(new THREE.Points(ffGeo, ffMat));

// ---------- the visitor ----------
const avatar = new THREE.Group();
const skin = new THREE.MeshLambertMaterial({ color: 0xe2b48c });
const sweater = new THREE.MeshLambertMaterial({ color: 0x6f9474 });
const pants = new THREE.MeshLambertMaterial({ color: 0x4a5a4f });
const hairMat = new THREE.MeshLambertMaterial({ color: 0x5a3f2b });
const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.6, 12), sweater);
torso.position.y = 1.0;
const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), skin);
head.position.y = 1.52;
const hair = new THREE.Mesh(new THREE.SphereGeometry(0.215, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
hair.position.y = 1.54;
const bun = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), hairMat);
bun.position.set(0, 1.72, 0.06);
const legL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.7, 0.14), pants);
const legR = legL.clone();
legL.geometry.translate(0, -0.35, 0);
legL.position.set(-0.1, 0.72, 0);
legR.position.set(0.1, 0.72, 0);
const armL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.11), sweater);
armL.geometry.translate(0, -0.27, 0);
const armR = armL.clone();
armL.position.set(-0.29, 1.27, 0);
armR.position.set(0.29, 1.27, 0);
// the little lantern they carry
const handLantern = new THREE.Group();
const hlBody = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.1), new THREE.MeshBasicMaterial({ color: 0xffd28a }));
const hlGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: warmGlow, color: 0xffc070, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
hlGlow.scale.set(0.8, 0.8, 1);
const hlLight = new THREE.PointLight(0xffc27a, 4, 6, 1.5);
handLantern.add(hlBody, hlGlow, hlLight);
handLantern.position.set(0, -0.62, -0.06);
armR.add(handLantern);
avatar.add(torso, head, hair, bun, legL, legR, armL, armR);
scene.add(avatar);

// ---------- state & controls ----------
const START = { x: 0, z: Z0 + 3.5, yaw: 0 };
const state = { x: START.x, z: START.z, yaw: START.yaw, pitch: -0.12, walk: 0, moving: 0 };
const keys = new Set();
const KEYMAP = { KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down", KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right" };
window.addEventListener("keydown", (e) => {
  if (e.target.closest && e.target.closest("input,textarea")) return;
  const k = KEYMAP[e.code];
  if (k) { keys.add(k); e.preventDefault(); }
});
window.addEventListener("keyup", (e) => { const k = KEYMAP[e.code]; if (k) keys.delete(k); });
window.addEventListener("blur", () => keys.clear());

root.querySelectorAll("[data-walk-key]").forEach((b) => {
  const k = b.dataset.walkKey;
  if (k === "reset") {
    b.addEventListener("click", () => { Object.assign(state, { x: START.x, z: START.z, yaw: START.yaw, pitch: -0.12 }); closeCard(); });
    return;
  }
  const on = (e) => { e.preventDefault(); keys.add(k); b.classList.add("is-down"); try { b.setPointerCapture(e.pointerId); } catch (_) {} };
  const off = () => { keys.delete(k); b.classList.remove("is-down"); };
  b.addEventListener("pointerdown", on);
  b.addEventListener("pointerup", off);
  b.addEventListener("pointercancel", off);
  b.addEventListener("lostpointercapture", off);
  b.addEventListener("contextmenu", (e) => e.preventDefault());
});

// drag to look, tap to pick
let drag = null;
canvas.addEventListener("pointerdown", (e) => {
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 8) drag.moved = true;
  state.yaw -= dx * 0.005;
  state.pitch = Math.max(-0.6, Math.min(0.35, state.pitch - dy * 0.003));
});
canvas.addEventListener("pointerup", (e) => {
  if (drag && !drag.moved) pick(e.clientX, e.clientY);
  drag = null;
});
canvas.addEventListener("pointercancel", () => (drag = null));

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let highlight = null;
function pick(cx, cy) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects([...portraitMeshes, emptyPlates], false);
  if (!hits.length || hits[0].distance > 14) return closeCard();
  const h = hits[0];
  if (h.object === emptyPlates) openEmpty(emptySlots[h.instanceId]);
  else openPet(h.object.userData.pet);
}

// ---------- cards ----------
const card = root.querySelector("[data-walk-card]");
const cPhoto = card.querySelector("[data-walk-card-photo]");
const cName = card.querySelector("[data-walk-card-name]");
const cMeta = card.querySelector("[data-walk-card-meta]");
const cLink = card.querySelector("[data-walk-card-link]");
function openPet(pet) {
  cPhoto.innerHTML = "";
  if (pet.photo) {
    const img = document.createElement("img");
    img.src = pet.photo;
    img.alt = "";
    cPhoto.appendChild(img);
  } else cPhoto.textContent = pet.name.slice(0, 1);
  cName.textContent = pet.name;
  cMeta.textContent = [pet.kind, pet.years, `${pet.candles} ${pet.candles === 1 ? "candle" : "candles"} lit`].filter(Boolean).join(" · ");
  cLink.textContent = `Visit ${pet.name}'s niche`;
  cLink.href = `/pet/${encodeURIComponent(pet.slug)}`;
  cLink.dataset.umamiEvent = "Walk visit niche";
  card.hidden = false;
  card.classList.remove("is-empty");
  setHighlight(pet.slot);
}
function openEmpty(slot) {
  cPhoto.innerHTML = "";
  cPhoto.textContent = "✦";
  cName.textContent = "An empty niche under the stars";
  cMeta.textContent = `Bay ${slot.bay + 1} · ${slot.side < 0 ? "left" : "right"} wall · row ${ROWS - slot.row}. Give your friend a place in the garden.`;
  cLink.textContent = "Create a niche";
  cLink.href = "/create";
  cLink.dataset.umamiEvent = "Walk create niche";
  card.hidden = false;
  card.classList.add("is-empty");
  setHighlight(slot);
}
function closeCard() {
  card.hidden = true;
  setHighlight(null);
}
card.querySelector("[data-walk-close]").addEventListener("click", closeCard);

const hlMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(PLATE_W + 0.12, PLATE_H + 0.12),
  new THREE.MeshBasicMaterial({ map: glowTex("rgba(255,214,130,1)"), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
);
hlMesh.visible = false;
scene.add(hlMesh);
function setHighlight(slot) {
  highlight = slot;
  hlMesh.visible = !!slot;
  if (!slot) return;
  hlMesh.position.set(slot.x - slot.side * 0.07, slot.y, slot.z);
  hlMesh.quaternion.copy(faceQ(slot.side));
}

// walk straight to a slot and face it
function goTo(slot) {
  state.x = -slot.side * 0.6;
  state.z = slot.z + 2.4;
  // face toward the niche, slightly down the path
  state.yaw = Math.atan2(-(slot.x - state.x), -(slot.z - state.z)) * 0.85;
  state.pitch = -0.08 - (slot.y < 1 ? 0.15 : 0);
}

// ---------- bays ----------
const bayLabel = root.querySelector("[data-walk-bay-label]");
function currentBay() {
  return Math.max(0, Math.min(BAYS - 1, Math.floor((Z0 - state.z) / BAY_LEN)));
}
root.querySelectorAll("[data-walk-bay]").forEach((b) =>
  b.addEventListener("click", () => {
    const next = Math.max(0, Math.min(BAYS - 1, currentBay() + Number(b.dataset.walkBay)));
    state.x = 0;
    state.z = Z0 - next * BAY_LEN + 1.2;
    state.yaw = 0;
    state.pitch = -0.12;
    closeCard();
  })
);

// ---------- find a friend ----------
const find = root.querySelector("[data-walk-find]");
const findList = root.querySelector("[data-walk-find-list]");
const findInput = root.querySelector("[data-walk-find-input]");
function renderFind() {
  const qv = findInput.value.trim().toLowerCase();
  const list = PETS.filter((p) => p.slot && (!qv || p.name.toLowerCase().includes(qv)));
  findList.innerHTML = "";
  if (!list.length) {
    const li = document.createElement("li");
    li.className = "walk-find-empty";
    li.textContent = PETS.length ? "No friend by that name yet." : "The garden is waiting for its first friend.";
    findList.appendChild(li);
    return;
  }
  for (const p of list) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    const ph = document.createElement("span");
    ph.className = "walk-find-photo";
    if (p.photo) { const im = document.createElement("img"); im.src = p.photo; im.alt = ""; im.loading = "lazy"; ph.appendChild(im); }
    else ph.textContent = p.name.slice(0, 1);
    const t = document.createElement("span");
    t.className = "walk-find-text";
    t.innerHTML = "<strong></strong><small></small>";
    t.firstChild.textContent = p.name;
    t.lastChild.textContent = `Bay ${p.slot.bay + 1} · ${p.slot.side < 0 ? "left" : "right"} wall`;
    b.append(ph, t);
    b.addEventListener("click", () => { find.hidden = true; goTo(p.slot); openPet(p); });
    li.appendChild(b);
    findList.appendChild(li);
  }
}
root.querySelector("[data-walk-find-open]").addEventListener("click", () => {
  find.hidden = !find.hidden;
  if (!find.hidden) { closeCard(); renderFind(); findInput.value = ""; if (matchMedia("(pointer:fine)").matches) findInput.focus(); }
});
root.querySelector("[data-walk-find-close]").addEventListener("click", () => (find.hidden = true));
findInput.addEventListener("input", renderFind);

// ---------- sound: a soft night pad with crickets, made in the browser ----------
const sndBtn = root.querySelector("[data-walk-sound]");
let audio = null;
sndBtn.addEventListener("click", () => {
  if (!audio) audio = startSound();
  const on = sndBtn.getAttribute("aria-pressed") !== "true";
  sndBtn.setAttribute("aria-pressed", String(on));
  sndBtn.setAttribute("aria-label", on ? "Turn off garden sounds" : "Turn on garden sounds");
  if (audio) {
    if (on) audio.ctx.resume();
    audio.master.gain.setTargetAtTime(on ? 0.5 : 0, audio.ctx.currentTime, 0.4);
  }
});
function startSound() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  // pad
  const pad = ctx.createGain();
  pad.gain.value = 0.05;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 900;
  pad.connect(lp).connect(master);
  [220, 277.18, 329.63, 440].forEach((f, i) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    o.detune.value = (i - 1.5) * 4;
    const g = ctx.createGain();
    g.gain.value = 0.25;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05 + i * 0.03;
    const lg = ctx.createGain();
    lg.gain.value = 0.2;
    lfo.connect(lg).connect(g.gain);
    o.connect(g).connect(pad);
    o.start(); lfo.start();
  });
  // crickets + occasional chime
  const chirp = () => {
    const t = ctx.currentTime;
    for (let k = 0; k < 3; k++) {
      const o = ctx.createOscillator();
      o.frequency.value = 4200 + Math.random() * 300;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + k * 0.07);
      g.gain.linearRampToValueAtTime(0.012, t + k * 0.07 + 0.01);
      g.gain.linearRampToValueAtTime(0, t + k * 0.07 + 0.045);
      o.connect(g).connect(master);
      o.start(t + k * 0.07);
      o.stop(t + k * 0.07 + 0.06);
    }
    setTimeout(chirp, 900 + Math.random() * 2200);
  };
  const chime = () => {
    const t = ctx.currentTime;
    const notes = [880, 987.77, 1108.73, 1318.51, 1479.98];
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = notes[Math.floor(Math.random() * notes.length)];
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 3.6);
    setTimeout(chime, 5000 + Math.random() * 7000);
  };
  chirp();
  setTimeout(chime, 2500);
  return { ctx, master };
}

// ---------- loop ----------
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 70 : 60;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

let last = performance.now();
let t = 0;
const camPos = new THREE.Vector3();
const camTarget = new THREE.Vector3();
let first = true;
function tick() {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  t += dt;
  // movement
  const turn = (keys.has("left") ? 1 : 0) - (keys.has("right") ? 1 : 0);
  const fwd = (keys.has("up") ? 1 : 0) - (keys.has("down") ? 1 : 0);
  state.yaw += turn * 1.9 * dt;
  const speed = fwd > 0 ? 2.6 : 1.6;
  state.x -= Math.sin(state.yaw) * fwd * speed * dt;
  state.z -= Math.cos(state.yaw) * fwd * speed * dt;
  state.x = Math.max(-HALF_W + 0.6, Math.min(HALF_W - 0.6, state.x));
  state.z = Math.max(Z_END + 0.8, Math.min(Z0 + 6, state.z));
  state.moving += ((fwd !== 0 ? 1 : 0) - state.moving) * Math.min(1, dt * 8);
  if (fwd !== 0 && !card.hidden && highlight && Math.hypot(highlight.z - state.z, highlight.x - state.x) > 6) closeCard();

  // avatar
  avatar.position.set(state.x, 0, state.z);
  avatar.rotation.y = state.yaw;
  state.walk += dt * 8 * Math.abs(fwd);
  const sw = Math.sin(state.walk) * 0.55 * state.moving;
  legL.rotation.x = sw;
  legR.rotation.x = -sw;
  armL.rotation.x = -sw * 0.8;
  armR.rotation.x = 0.25 + sw * 0.3;
  avatar.position.y = Math.abs(Math.cos(state.walk)) * 0.04 * state.moving;

  // third-person camera, kept inside the walls
  const dist = 3.9;
  const fx = -Math.sin(state.yaw), fz = -Math.cos(state.yaw);
  camPos.set(state.x - fx * dist, 2.45 - state.pitch * 2.2, state.z - fz * dist);
  camPos.x = Math.max(-HALF_W + 0.35, Math.min(HALF_W - 0.35, camPos.x));
  camPos.z = Math.min(camPos.z, Z0 + 9);
  camPos.z = Math.max(camPos.z, Z_END + 0.4);
  camTarget.set(state.x + fx * 4, 1.45 + state.pitch * 3, state.z + fz * 4);
  if (first) { camera.position.copy(camPos); first = false; }
  else camera.position.lerp(camPos, Math.min(1, dt * 6));
  camera.lookAt(camTarget);

  // life
  if (!reduceMotion) {
    for (let i = 0; i < flickers.length; i++) {
      const s = 1.2 + Math.sin(t * 3 + i * 1.7) * 0.06 + Math.sin(t * 7.3 + i) * 0.04;
      flickers[i].scale.set(s, s, 1);
    }
    for (let i = 0; i < candleGlows.length; i++) {
      const b = candleGlows[i].userData.base * (1 + Math.sin(t * 9 + i * 2.1) * 0.08);
      candleGlows[i].scale.set(b, b * 1.25, 1);
    }
    for (let i = 0; i < FF; i++) {
      const f = ffBase[i];
      ffArr[i * 3] = f[0] + Math.sin(t * 0.5 + f[3]) * 0.6;
      ffArr[i * 3 + 1] = f[1] + Math.sin(t * 0.8 + f[3] * 2) * 0.3;
      ffArr[i * 3 + 2] = f[2] + Math.cos(t * 0.4 + f[3]) * 0.6;
    }
    ffGeo.attributes.position.needsUpdate = true;
    ffMat.opacity = 0.6 + Math.sin(t * 2) * 0.3;
    starMat.opacity = 0.8 + Math.sin(t * 0.7) * 0.12;
    hlMesh.material.opacity = 0.65 + Math.sin(t * 3) * 0.3;
  }
  bayLabel.textContent = `Bay ${currentBay() + 1} / ${BAYS}`;

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

// start at a pet if the link asks for one
if (DATA.selected) {
  const p = PETS.find((x) => x.slug === DATA.selected);
  if (p && p.slot) { goTo(p.slot); openPet(p); }
}
root.querySelector("[data-walk-loading]").hidden = true;
requestAnimationFrame(tick);
