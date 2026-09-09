import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020611);
scene.fog = new THREE.FogExp2(0x020611, 0.0035);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 18, 76);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.minDistance = 42;
controls.maxDistance = 125;
controls.enablePan = false;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.55;

scene.add(new THREE.AmbientLight(0x9db8ff, 0.85));
const sun = new THREE.DirectionalLight(0xffffff, 3.2);
sun.position.set(45, 30, 35);
scene.add(sun);
const rim = new THREE.DirectionalLight(0x6f9dff, 1.25);
rim.position.set(-45, -5, -35);
scene.add(rim);

// Star field: generated locally, so the project has no image assets to load.
const starGeo = new THREE.BufferGeometry();
const starCount = 2600;
const starPos = new Float32Array(starCount * 3);
let starSeed = 918273;
for (let i = 0; i < starCount; i++) {
  starSeed = (starSeed * 1664525 + 1013904223) >>> 0;
  const a = (starSeed / 4294967296) * Math.PI * 2;
  starSeed = (starSeed * 1664525 + 1013904223) >>> 0;
  const u = starSeed / 4294967296;
  const r = 125 + u * 120;
  const y = (u - 0.5) * 170;
  const s = Math.sqrt(Math.max(0, r * r - y * y));
  starPos[i * 3] = Math.cos(a) * s;
  starPos[i * 3 + 1] = y;
  starPos[i * 3 + 2] = Math.sin(a) * s;
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.42, sizeAttenuation: true, transparent: true, opacity: 0.82 })));

const RADIUS = 28;
const LAT_STEPS = 36;
const LON_STEPS = 72;
const BLOCK = 1.62;
const MAX_HEIGHT = 7;
let worldGroup = null;

const palette = {
  water: 0x246da7,
  sand: 0xd8bf78,
  grass: 0x4d9a4c,
  forest: 0x2e713c,
  rock: 0x727b82,
  snow: 0xe9f2f6,
  dirt: 0x795a3d,
};

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h += h << 13; h ^= h >>> 7; h += h << 3; h ^= h >>> 17; h += h << 5;
  return h >>> 0;
}

function hash3(x, y, z, seed) {
  let h = Math.imul(x ^ seed, 374761393);
  h = Math.imul(h ^ Math.imul(y, 668265263), 1274126177);
  h = Math.imul(h ^ Math.imul(z, 1442695041), 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967295;
}

function fade(t) { return t * t * (3 - 2 * t); }

function valueNoise3(x, y, z, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fx = fade(x - x0), fy = fade(y - y0), fz = fade(z - z0);
  const v = (dx, dy, dz) => hash3(x0 + dx, y0 + dy, z0 + dz, seed);
  const x00 = THREE.MathUtils.lerp(v(0,0,0), v(1,0,0), fx);
  const x10 = THREE.MathUtils.lerp(v(0,1,0), v(1,1,0), fx);
  const x01 = THREE.MathUtils.lerp(v(0,0,1), v(1,0,1), fx);
  const x11 = THREE.MathUtils.lerp(v(0,1,1), v(1,1,1), fx);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(x00, x10, fy), THREE.MathUtils.lerp(x01, x11, fy), fz);
}

function fbm(x, y, z, seed) {
  let value = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < 5; i++) {
    value += valueNoise3(x * freq, y * freq, z * freq, seed + i * 1013) * amp;
    freq *= 2;
    amp *= 0.5;
  }
  return value;
}

function terrainAt(lat, lon, seed) {
  // Sampling noise in 3D makes the longitude seam continuous.
  const cl = Math.cos(lat);
  const x = cl * Math.cos(lon);
  const y = Math.sin(lat);
  const z = cl * Math.sin(lon);

  const continent = fbm(x * 1.65, y * 1.65, z * 1.65, seed);
  const detail = fbm(x * 5.2 + 17, y * 5.2 - 11, z * 5.2 + 7, seed + 77);
  const mountain = fbm(x * 8.5 - 9, y * 8.5 + 4, z * 8.5 + 13, seed + 151);

  // Bias creates broad oceans and continents rather than noisy confetti.
  const land = continent * 0.78 + detail * 0.22;
  const polar = Math.abs(y);
  let elevation = (land - 0.505) * 17;
  if (land < 0.50) elevation = -1;
  if (elevation > 0) elevation += Math.max(0, mountain - 0.54) * 14;
  if (polar > 0.84 && elevation > 0) elevation += (polar - 0.84) * 18;
  return Math.max(-1, Math.min(MAX_HEIGHT, Math.floor(elevation)));
}

function material(type) {
  return new THREE.MeshStandardMaterial({
    color: palette[type],
    roughness: 0.92,
    metalness: 0.0,
  });
}

function makeWorld(seedText) {
  if (worldGroup) scene.remove(worldGroup);
  worldGroup = new THREE.Group();
  worldGroup.rotation.y = 0.18;
  scene.add(worldGroup);

  const seed = hashString(seedText);
  const blocks = { water: [], sand: [], grass: [], forest: [], rock: [], snow: [], dirt: [] };
  const dummy = new THREE.Object3D();
  let total = 0;

  for (let iy = 0; iy < LAT_STEPS; iy++) {
    const lat = -Math.PI / 2 + Math.PI * (iy + 0.5) / LAT_STEPS;
    for (let ix = 0; ix < LON_STEPS; ix++) {
      const lon = -Math.PI + Math.PI * 2 * (ix + 0.5) / LON_STEPS;
      const h = terrainAt(lat, lon, seed);
      const water = h < 0;
      const layers = water ? 1 : Math.max(1, h + 1);

      const radial = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)).normalize();
      const east = new THREE.Vector3(-Math.sin(lon), 0, Math.cos(lon)).normalize();
      const north = new THREE.Vector3().crossVectors(radial, east).normalize();
      const basis = new THREE.Matrix4().makeBasis(east, radial, north);
      const q = new THREE.Quaternion().setFromRotationMatrix(basis);

      for (let layer = 0; layer < layers; layer++) {
        const radius = RADIUS + (layer + 0.5) * BLOCK;
        dummy.position.copy(radial).multiplyScalar(radius);
        dummy.quaternion.copy(q);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();

        let type = 'grass';
        if (water) type = 'water';
        else if (Math.abs(lat) > 1.18) type = 'snow';
        else if (h <= 1 && layer === h) type = 'sand';
        else if (h >= 5 && layer === h) type = 'rock';
        else if (h >= 3 && layer === h) type = 'forest';
        else if (layer < h) type = 'dirt';
        blocks[type].push(dummy.matrix.clone());
        total++;
      }
    }
  }

  const cube = new THREE.BoxGeometry(BLOCK * 0.98, BLOCK * 0.98, BLOCK * 0.98);
  for (const [type, matrices] of Object.entries(blocks)) {
    if (!matrices.length) continue;
    const mesh = new THREE.InstancedMesh(cube, material(type), matrices.length);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    worldGroup.add(mesh);
  }

  // Subtle atmosphere shell.
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS + 9.5, 64, 32),
    new THREE.MeshBasicMaterial({ color: 0x4f9cff, transparent: true, opacity: 0.055, side: THREE.BackSide, depthWrite: false })
  );
  worldGroup.add(atmosphere);

  document.querySelector('#stats').textContent = `Seed: ${seedText}  ·  ${total.toLocaleString()} voxel blocks  ·  ${LAT_STEPS}×${LON_STEPS} surface grid`;
}

function generate() {
  const input = document.querySelector('#seed');
  const seed = input.value.trim() || 'EARTH';
  input.value = seed;
  document.querySelector('#loading').classList.remove('hidden');
  requestAnimationFrame(() => {
    makeWorld(seed);
    setTimeout(() => document.querySelector('#loading').classList.add('hidden'), 40);
  });
}

document.querySelector('#generate').addEventListener('click', generate);
document.querySelector('#random').addEventListener('click', () => {
  const adjectives = ['ORBIT','NOVA','TERRA','COSMOS','LUNA','VOID','AURORA','MARS','GALAXY','STAR'];
  const a = adjectives[Math.floor(Math.random() * adjectives.length)];
  document.querySelector('#seed').value = `${a}-${Math.floor(Math.random() * 1e9)}`;
  generate();
});
document.querySelector('#seed').addEventListener('keydown', e => { if (e.key === 'Enter') generate(); });

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

generate();

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  if (worldGroup) worldGroup.position.y = Math.sin(t * 0.45) * 0.15;
  controls.update();
  renderer.render(scene, camera);
}
animate();
