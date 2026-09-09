import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020611);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 10, 78);

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
controls.autoRotateSpeed = 0.42;

scene.add(new THREE.AmbientLight(0x9db8ff, 0.8));
const sun = new THREE.DirectionalLight(0xffffff, 3.3);
sun.position.set(45, 30, 35);
scene.add(sun);
const rim = new THREE.DirectionalLight(0x6f9dff, 1.15);
rim.position.set(-45, -5, -35);
scene.add(rim);

// Clean procedural star field.
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
scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
  color: 0xffffff,
  size: 0.42,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0.82
})));

// Stage 1: only the globe. No player, trees, caves, terrain towers or gameplay yet.
const RADIUS = 28;
const LAT_STEPS = 56;
const LON_STEPS = 112;
const BLOCK = 1.58;
let globe = null;

const palette = {
  ocean: 0x1767a8,
  shallow: 0x2388c7,
  land: 0x4d9447,
  dry: 0x9c844f,
  snow: 0xe8f0f2
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

function fade(t) {
  return t * t * (3 - 2 * t);
}

function noise3(x, y, z, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fx = fade(x - x0), fy = fade(y - y0), fz = fade(z - z0);
  const v = (dx, dy, dz) => hash3(x0 + dx, y0 + dy, z0 + dz, seed);
  const a = THREE.MathUtils.lerp(v(0, 0, 0), v(1, 0, 0), fx);
  const b = THREE.MathUtils.lerp(v(0, 1, 0), v(1, 1, 0), fx);
  const c = THREE.MathUtils.lerp(v(0, 0, 1), v(1, 0, 1), fx);
  const d = THREE.MathUtils.lerp(v(0, 1, 1), v(1, 1, 1), fx);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, fy),
    THREE.MathUtils.lerp(c, d, fy),
    fz
  );
}

function fbm(x, y, z, seed) {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 4; i++) {
    value += noise3(x * freq, y * freq, z * freq, seed + i * 911) * amp;
    freq *= 2;
    amp *= 0.5;
  }
  return value;
}

function biomeAt(lat, lon, seed) {
  const cl = Math.cos(lat);
  const x = cl * Math.cos(lon);
  const y = Math.sin(lat);
  const z = cl * Math.sin(lon);

  // One continuous 3D noise field gives a seamless planet with no longitude seam.
  const continent = fbm(x * 1.75, y * 1.75, z * 1.75, seed);
  const detail = fbm(x * 4.5 + 9, y * 4.5 - 7, z * 4.5 + 3, seed + 37);
  const value = continent * 0.78 + detail * 0.22;

  const polar = Math.abs(y);
  if (polar > 0.86 && value > 0.45) return 'snow';
  if (value < 0.485) return value < 0.39 ? 'ocean' : 'shallow';
  if (value > 0.64) return 'dry';
  return 'land';
}

function makeGlobe(seedText) {
  if (globe) scene.remove(globe);
  globe = new THREE.Group();
  globe.rotation.y = 0.16;
  scene.add(globe);

  const seed = hashString(seedText);
  const cells = { ocean: [], shallow: [], land: [], dry: [], snow: [] };
  const dummy = new THREE.Object3D();

  // Every cell is a single surface voxel. No underground layers yet.
  for (let iy = 0; iy < LAT_STEPS; iy++) {
    const lat = -Math.PI / 2 + Math.PI * (iy + 0.5) / LAT_STEPS;
    const radial = new THREE.Vector3();
    const north = new THREE.Vector3();
    const east = new THREE.Vector3();

    for (let ix = 0; ix < LON_STEPS; ix++) {
      const lon = -Math.PI + Math.PI * (ix + 0.5) / LON_STEPS;
      const cl = Math.cos(lat);

      radial.set(cl * Math.cos(lon), Math.sin(lat), cl * Math.sin(lon)).normalize();
      east.set(-Math.sin(lon), 0, Math.cos(lon)).normalize();
      north.crossVectors(radial, east).normalize();

      const basis = new THREE.Matrix4().makeBasis(east, radial, north);
      const q = new THREE.Quaternion().setFromRotationMatrix(basis);

      const type = biomeAt(lat, lon, seed);
      const latitudeWidth = Math.PI * RADIUS / LAT_STEPS;
      const longitudeWidth = (2 * Math.PI * RADIUS * Math.max(cl, 0.035)) / LON_STEPS;

      dummy.position.copy(radial).multiplyScalar(RADIUS);
      dummy.quaternion.copy(q);

      // Tiny overlap keeps the globe visually solid while preserving the voxel look.
      dummy.scale.set(
        Math.max(0.98, longitudeWidth / BLOCK * 1.045),
        1.02,
        Math.max(0.98, latitudeWidth / BLOCK * 1.045)
      );
      dummy.updateMatrix();
      cells[type].push(dummy.matrix.clone());
    }
  }

  const geometry = new THREE.BoxGeometry(BLOCK, BLOCK, BLOCK);
  let total = 0;

  for (const [type, matrices] of Object.entries(cells)) {
    if (!matrices.length) continue;
    const mesh = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: palette[type],
        roughness: 0.9,
        metalness: 0
      }),
      matrices.length
    );
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    globe.add(mesh);
    total += matrices.length;
  }

  // Soft atmospheric shell only, so the planet still reads clearly against space.
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS + 2.8, 64, 32),
    new THREE.MeshBasicMaterial({
      color: 0x4f9cff,
      transparent: true,
      opacity: 0.07,
      side: THREE.BackSide,
      depthWrite: false
    })
  );
  globe.add(atmosphere);

  document.querySelector('#stats').textContent =
    `Seed: ${seedText}  ·  ${total.toLocaleString()} globe blocks  ·  ${LAT_STEPS}×${LON_STEPS} surface grid`;
}

function generate() {
  const input = document.querySelector('#seed');
  const seed = input.value.trim() || 'EARTH';
  input.value = seed;
  document.querySelector('#loading').classList.remove('hidden');
  requestAnimationFrame(() => {
    makeGlobe(seed);
    setTimeout(() => document.querySelector('#loading').classList.add('hidden'), 40);
  });
}

document.querySelector('#generate').addEventListener('click', generate);
document.querySelector('#random').addEventListener('click', () => {
  const names = ['TERRA', 'NOVA', 'AURORA', 'GAIA', 'ORBIT', 'COSMOS', 'STAR', 'BLUE'];
  const name = names[Math.floor(Math.random() * names.length)];
  document.querySelector('#seed').value = `${name}-${Math.floor(Math.random() * 1e9)}`;
  generate();
});
document.querySelector('#seed').addEventListener('keydown', e => {
  if (e.key === 'Enter') generate();
});

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
  if (globe) globe.position.y = Math.sin(t * 0.4) * 0.08;
  controls.update();
  renderer.render(scene, camera);
}
animate();
