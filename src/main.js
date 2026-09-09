import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020611);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 8, 78);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.minDistance = 43;
controls.maxDistance = 120;
controls.enablePan = false;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;
controls.target.set(0, 0, 0);

scene.add(new THREE.AmbientLight(0x9db8ff, 0.72));
const sun = new THREE.DirectionalLight(0xffffff, 3.2);
sun.position.set(45, 32, 38);
scene.add(sun);
const rim = new THREE.DirectionalLight(0x477dff, 1.0);
rim.position.set(-40, -12, -45);
scene.add(rim);

// Simple deep-space star field.
const starGeo = new THREE.BufferGeometry();
const starCount = 2400;
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

// Stage 1 only: a single solid voxel globe.
// No player, trees, caves, gameplay, gravity or underground systems.
const VOXEL = 1.45;
const BASE_RADIUS = 19.5;
const TERRAIN_HEIGHT = 3.2;
const GRID_RADIUS = Math.ceil(BASE_RADIUS + TERRAIN_HEIGHT + 2);
let globe = null;

const palette = {
  ocean: 0x1977b9,
  shallow: 0x2a92cf,
  grass: 0x4f9a48,
  dry: 0xa48750,
  snow: 0xe9f1f4,
  dirt: 0x6b4b31,
  stone: 0x5a6069
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
  let h = Math.imul((x ^ seed) | 0, 374761393);
  h = Math.imul(h ^ Math.imul(y | 0, 668265263), 1274126177);
  h = Math.imul(h ^ Math.imul(z | 0, 1442695041), 2246822519);
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

function terrainAt(direction, seed) {
  const continent = fbm(direction.x * 1.65, direction.y * 1.65, direction.z * 1.65, seed);
  const detail = fbm(
    direction.x * 4.2 + 13,
    direction.y * 4.2 - 5,
    direction.z * 4.2 + 8,
    seed + 71
  );

  const value = continent * 0.78 + detail * 0.22;
  const latitude = Math.abs(direction.y);

  // Broad oceans, continents and a little polar ice.
  const ocean = value < 0.485;
  let height = ocean ? 0 : (value - 0.485) * 7.2;
  height = Math.min(TERRAIN_HEIGHT, Math.max(0, height));

  return { value, ocean, height, latitude };
}

function surfaceType(direction, terrain) {
  if (terrain.ocean) return terrain.value < 0.405 ? 'ocean' : 'shallow';
  if (terrain.latitude > 0.82 && terrain.value > 0.50) return 'snow';
  if (terrain.value > 0.66) return 'dry';
  return 'grass';
}

function makeGlobe(seedText) {
  if (globe) {
    scene.remove(globe);
    globe.traverse(obj => {
      if (obj.isInstancedMesh) obj.dispose();
    });
  }

  globe = new THREE.Group();
  globe.rotation.y = 0.12;
  scene.add(globe);

  const seed = hashString(seedText);
  const cells = {
    ocean: [],
    shallow: [],
    grass: [],
    dry: [],
    snow: [],
    dirt: [],
    stone: []
  };

  // First calculate a continuous terrain radius for every direction.
  // The actual planet is then filled voxel-by-voxel, so there are no
  // latitude/longitude ring gaps and nothing can be seen through the globe.
  const dummy = new THREE.Object3D();
  const directions = new Map();
  const keyFor = (x, y, z) => `${x},${y},${z}`;

  for (let x = -GRID_RADIUS; x <= GRID_RADIUS; x++) {
    for (let y = -GRID_RADIUS; y <= GRID_RADIUS; y++) {
      for (let z = -GRID_RADIUS; z <= GRID_RADIUS; z++) {
        const distance = Math.sqrt(x * x + y * y + z * z);
        if (distance > BASE_RADIUS + TERRAIN_HEIGHT + 1.0) continue;

        const p = new THREE.Vector3(x, y, z);
        const direction = p.lengthSq() > 0 ? p.normalize() : new THREE.Vector3(0, 1, 0);
        const terrain = terrainAt(direction, seed);
        const surfaceRadius = BASE_RADIUS + terrain.height;

        if (distance > surfaceRadius + 0.55) continue;

        const key = keyFor(x, y, z);
        directions.set(key, { direction, terrain, distance, surfaceRadius });
      }
    }
  }

  const neighborOffsets = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
  ];

  for (const [key, info] of directions) {
    const [x, y, z] = key.split(',').map(Number);
    let exposed = false;
    for (const [dx, dy, dz] of neighborOffsets) {
      if (!directions.has(keyFor(x + dx, y + dy, z + dz))) {
        exposed = true;
        break;
      }
    }

    let type = 'stone';
    if (exposed) {
      type = surfaceType(info.direction, info.terrain);
    } else if (info.distance > BASE_RADIUS - 2.0) {
      type = info.terrain.ocean ? 'dirt' : 'dirt';
    }

    dummy.position.set(x * VOXEL, y * VOXEL, z * VOXEL);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1.002);
    dummy.updateMatrix();
    cells[type].push(dummy.matrix.clone());
  }

  const geometry = new THREE.BoxGeometry(VOXEL, VOXEL, VOXEL);
  let total = 0;

  for (const [type, matrices] of Object.entries(cells)) {
    if (!matrices.length) continue;

    const mesh = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: palette[type],
        roughness: 0.92,
        metalness: 0
      }),
      matrices.length
    );

    for (let i = 0; i < matrices.length; i++) {
      mesh.setMatrixAt(i, matrices[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    globe.add(mesh);
    total += matrices.length;
  }

  // Very subtle atmosphere. It does not hide the voxel surface.
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(BASE_RADIUS * VOXEL + 2.3, 64, 32),
    new THREE.MeshBasicMaterial({
      color: 0x4f9cff,
      transparent: true,
      opacity: 0.055,
      side: THREE.BackSide,
      depthWrite: false
    })
  );
  globe.add(atmosphere);

  document.querySelector('#stats').textContent =
    `Seed: ${seedText}  ·  ${total.toLocaleString()} solid globe voxels`;
}

function generate() {
  const input = document.querySelector('#seed');
  const seed = input.value.trim() || 'EARTH';
  input.value = seed;
  document.querySelector('#loading').classList.remove('hidden');
  requestAnimationFrame(() => {
    makeGlobe(seed);
    setTimeout(() => document.querySelector('#loading').classList.add('hidden'), 50);
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
  if (globe) globe.position.y = Math.sin(t * 0.4) * 0.05;
  controls.update();
  renderer.render(scene, camera);
}
animate();
