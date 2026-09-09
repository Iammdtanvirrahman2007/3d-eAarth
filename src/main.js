import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x01040b);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 500);
// Make Earth feel enormous in frame. The closer, larger globe reduces the visible curvature.
camera.position.set(0, 6, 62);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.enablePan = false;
controls.minDistance = 38;
controls.maxDistance = 115;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.28;
controls.target.set(0, 0, 0);

scene.add(new THREE.AmbientLight(0x8eafff, 0.58));
const sunLight = new THREE.DirectionalLight(0xffffff, 3.45);
sunLight.position.set(46, 30, 42);
scene.add(sunLight);
const blueRim = new THREE.DirectionalLight(0x3d70ff, 1.15);
blueRim.position.set(-38, -8, -48);
scene.add(blueRim);

// Deep space backdrop.
const starGeo = new THREE.BufferGeometry();
const starCount = 2800;
const starPositions = new Float32Array(starCount * 3);
let starSeed = 741289;
for (let i = 0; i < starCount; i++) {
  starSeed = (starSeed * 1664525 + 1013904223) >>> 0;
  const a = (starSeed / 4294967296) * Math.PI * 2;
  starSeed = (starSeed * 1664525 + 1013904223) >>> 0;
  const u = starSeed / 4294967296;
  const r = 135 + u * 130;
  const y = (u - 0.5) * 190;
  const ring = Math.sqrt(Math.max(0, r * r - y * y));
  starPositions[i * 3] = Math.cos(a) * ring;
  starPositions[i * 3 + 1] = y;
  starPositions[i * 3 + 2] = Math.sin(a) * ring;
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
  color: 0xffffff,
  size: 0.38,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0.84
})));

// A soft sun in the distance, purely visual.
const sunGlow = new THREE.Mesh(
  new THREE.SphereGeometry(2.35, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0xfff2b0 })
);
sunGlow.position.set(57, 30, 55);
scene.add(sunGlow);
const sunPoint = new THREE.PointLight(0xffd98a, 1.8, 180);
sunPoint.position.copy(sunGlow.position);
scene.add(sunPoint);

// Stage 1: the globe only. No player, caves, buildings or gameplay yet.
// Larger planet + slightly smaller blocks = a much denser, closer Earth.
const VOXEL = 1.20;
const BASE_RADIUS = 25.5;
const LAND_HEIGHT = 3.0;
const GRID_RADIUS = Math.ceil(BASE_RADIUS + LAND_HEIGHT + 2);
const GLOBE_SCALE = VOXEL;
let globe = null;

const palette = {
  deepOcean: 0x0750a7,
  ocean: 0x0b69c7,
  shallow: 0x168bd1,
  grass: 0x3e982f,
  grassLight: 0x63b83a,
  forest: 0x176d2d,
  dry: 0xc7a15a,
  sand: 0xe5c477,
  snow: 0xf3f7fa,
  ice: 0xdceeff,
  dirt: 0x714a2d,
  stone: 0x59616d,
  cloud: 0xffffff
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

function fbm(x, y, z, seed, octaves = 4) {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    value += noise3(x * freq, y * freq, z * freq, seed + i * 911) * amp;
    freq *= 2;
    amp *= 0.5;
  }
  return value;
}

function angularDistance(a, b) {
  let d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

// Earth-like continent layout. The seed changes coast detail, terrain and biome
// variation while the broad continental silhouette remains recognisable.
const continents = [
  { lon: -1.78, lat: 0.63, sx: 0.82, sy: 0.47, power: 1.0 },
  { lon: -1.05, lat: -0.18, sx: 0.42, sy: 0.78, power: 1.05 },
  { lon: -0.42, lat: 0.10, sx: 0.58, sy: 0.70, power: 1.0 },
  { lon: 0.98, lat: 0.74, sx: 1.65, sy: 0.50, power: 1.0 },
  { lon: 1.35, lat: 0.15, sx: 0.46, sy: 0.40, power: 0.95 },
  { lon: 2.34, lat: -0.44, sx: 0.55, sy: 0.30, power: 1.0 },
  { lon: -0.78, lat: 1.26, sx: 0.23, sy: 0.22, power: 1.0 },
  { lon: 0.05, lat: -1.18, sx: 2.8, sy: 0.22, power: 1.0 }
];

function continentScore(lon, lat) {
  let best = 0;
  for (const c of continents) {
    const dl = angularDistance(lon, c.lon);
    const dLat = lat - c.lat;
    const q = Math.sqrt((dl / c.sx) ** 2 + (dLat / c.sy) ** 2);
    const score = Math.max(0, 1 - q) ** c.power;
    best = Math.max(best, score);
  }
  return best;
}

function earthTerrain(direction, seed) {
  const lon = Math.atan2(direction.z, direction.x);
  const lat = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
  const landShape = continentScore(lon, lat);
  const coastNoise = (fbm(direction.x * 3.0 + 8, direction.y * 3.0 - 4, direction.z * 3.0 + 11, seed, 3) - 0.5) * 0.42;
  const landScore = landShape + coastNoise;
  const polarIce = Math.abs(lat) > 1.22;
  const land = polarIce || landScore > 0.49;

  const heightNoise = fbm(direction.x * 4.4, direction.y * 4.4, direction.z * 4.4, seed + 100, 4);
  const mountainNoise = fbm(direction.x * 9, direction.y * 9, direction.z * 9, seed + 200, 3);
  let height = land ? 0.65 + Math.max(0, landScore - 0.49) * 4.5 + heightNoise * 0.9 : 0;
  if (land && mountainNoise > 0.68) height += (mountainNoise - 0.68) * 7;
  height = THREE.MathUtils.clamp(height, 0.4, LAND_HEIGHT);

  const desertNoise = fbm(direction.x * 2.8 + 30, direction.y * 2.8, direction.z * 2.8 - 20, seed + 400, 3);
  const forestNoise = fbm(direction.x * 5.5 - 17, direction.y * 5.5 + 2, direction.z * 5.5 + 9, seed + 500, 3);

  let type = 'ocean';
  if (land) {
    if (polarIce || Math.abs(lat) > 1.05) type = 'snow';
    else if (desertNoise > 0.68 && lat > -0.35 && lat < 0.72) type = 'sand';
    else if (forestNoise > 0.57 && lat > -0.65 && lat < 0.75) type = 'forest';
    else if (landScore > 0.73) type = 'grassLight';
    else type = 'grass';
  } else if (lat > 1.08 || lat < -1.08) {
    type = 'ice';
  } else {
    const shallow = Math.sin(lon * 5.0 + lat * 2.0) * 0.03 + coastNoise;
    type = shallow > -0.10 ? 'shallow' : (landShape < 0.04 ? 'deepOcean' : 'ocean');
  }

  return { lon, lat, land, height, type, landScore };
}

function addInstancedGroup(parent, geometry, materialCache, type, matrices) {
  if (!matrices.length) return 0;
  const mesh = new THREE.InstancedMesh(geometry, materialCache[type], matrices.length);
  for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  parent.add(mesh);
  return matrices.length;
}

function makeGlobe(seedText) {
  if (globe) {
    scene.remove(globe);
    globe.traverse(obj => {
      if (obj.isInstancedMesh) obj.dispose();
      if (obj.material) obj.material.dispose?.();
      if (obj.geometry && obj.geometry !== globe?.userData?.sharedGeometry) obj.geometry.dispose?.();
    });
  }

  globe = new THREE.Group();
  globe.rotation.y = -0.36;
  scene.add(globe);

  const seed = hashString(seedText);
  const cells = Object.fromEntries(Object.keys(palette).map(k => [k, []]));
  const occupied = new Map();
  const infoMap = new Map();
  const keyFor = (x, y, z) => `${x},${y},${z}`;

  // Fill a solid voxel planet. Land rises above the ocean by several block layers.
  for (let x = -GRID_RADIUS; x <= GRID_RADIUS; x++) {
    for (let y = -GRID_RADIUS; y <= GRID_RADIUS; y++) {
      for (let z = -GRID_RADIUS; z <= GRID_RADIUS; z++) {
        const distance = Math.sqrt(x * x + y * y + z * z);
        if (distance > BASE_RADIUS + LAND_HEIGHT + 0.95) continue;

        const raw = new THREE.Vector3(x, y, z);
        const direction = raw.lengthSq() ? raw.normalize() : new THREE.Vector3(0, 1, 0);
        const terrain = earthTerrain(direction, seed);
        const surfaceRadius = BASE_RADIUS + (terrain.land ? terrain.height : 0);
        if (distance > surfaceRadius + 0.52) continue;

        const key = keyFor(x, y, z);
        occupied.set(key, true);
        infoMap.set(key, { direction, terrain, distance });
      }
    }
  }

  const neighbors = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
  ];
  const dummy = new THREE.Object3D();

  for (const [key, info] of infoMap) {
    const [x, y, z] = key.split(',').map(Number);
    let exposed = false;
    for (const [dx, dy, dz] of neighbors) {
      if (!occupied.has(keyFor(x + dx, y + dy, z + dz))) {
        exposed = true;
        break;
      }
    }

    let type = 'stone';
    if (exposed) {
      type = info.terrain.type;
    } else if (info.distance > BASE_RADIUS - 2.5) {
      type = info.terrain.land ? 'dirt' : 'ocean';
    }

    dummy.position.set(x * GLOBE_SCALE, y * GLOBE_SCALE, z * GLOBE_SCALE);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1.012);
    dummy.updateMatrix();
    cells[type].push(dummy.matrix.clone());
  }

  const geometry = new THREE.BoxGeometry(VOXEL, VOXEL, VOXEL);
  const materialCache = {};
  for (const [type, color] of Object.entries(palette)) {
    materialCache[type] = new THREE.MeshStandardMaterial({
      color,
      roughness: type.includes('Ocean') || type === 'ocean' || type === 'shallow' ? 0.68 : 0.9,
      metalness: 0
    });
  }

  let total = 0;
  for (const type of Object.keys(cells)) {
    total += addInstancedGroup(globe, geometry, materialCache, type, cells[type]);
  }

  // Blocky cloud layer hovering just above the surface.
  const cloudDummy = new THREE.Object3D();
  const cloudMatrices = [];
  for (let x = -GRID_RADIUS - 1; x <= GRID_RADIUS + 1; x++) {
    for (let y = -GRID_RADIUS - 1; y <= GRID_RADIUS + 1; y++) {
      for (let z = -GRID_RADIUS - 1; z <= GRID_RADIUS + 1; z++) {
        const distance = Math.sqrt(x * x + y * y + z * z);
        if (distance < BASE_RADIUS + 2.0 || distance > BASE_RADIUS + 3.4) continue;
        const p = new THREE.Vector3(x, y, z).normalize();
        const cloudNoise = fbm(p.x * 3.6 + 41, p.y * 3.6 - 17, p.z * 3.6 + 23, seed + 900, 3);
        const lat = Math.asin(p.y);
        if (cloudNoise > 0.64 && Math.abs(lat) < 1.18) {
          cloudDummy.position.set(x * GLOBE_SCALE, y * GLOBE_SCALE, z * GLOBE_SCALE);
          cloudDummy.scale.setScalar(0.82);
          cloudDummy.updateMatrix();
          cloudMatrices.push(cloudDummy.matrix.clone());
        }
      }
    }
  }
  if (cloudMatrices.length) {
    const cloudMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(VOXEL * 0.95, VOXEL * 0.95, VOXEL * 0.95),
      materialCache.cloud,
      cloudMatrices.length
    );
    for (let i = 0; i < cloudMatrices.length; i++) cloudMesh.setMatrixAt(i, cloudMatrices[i]);
    cloudMesh.instanceMatrix.needsUpdate = true;
    cloudMesh.computeBoundingSphere();
    cloudMesh.material.transparent = true;
    cloudMesh.material.opacity = 0.88;
    globe.add(cloudMesh);
  }

  // Thin blue atmosphere ring around the voxel planet.
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(BASE_RADIUS * GLOBE_SCALE + 3.0, 64, 32),
    new THREE.MeshBasicMaterial({
      color: 0x4ea0ff,
      transparent: true,
      opacity: 0.045,
      side: THREE.BackSide,
      depthWrite: false
    })
  );
  globe.add(atmosphere);

  document.querySelector('#stats').textContent =
    `Seed: ${seedText}  ·  ${total.toLocaleString()} voxel blocks  ·  Giant Earth Globe`;
}

function generate() {
  const input = document.querySelector('#seed');
  const seed = input.value.trim() || 'EARTH';
  input.value = seed;
  document.querySelector('#loading').classList.remove('hidden');
  requestAnimationFrame(() => {
    makeGlobe(seed);
    setTimeout(() => document.querySelector('#loading').classList.add('hidden'), 80);
  });
}

document.querySelector('#generate').addEventListener('click', generate);
document.querySelector('#random').addEventListener('click', () => {
  const names = ['TERRA', 'GAIA', 'BLUE', 'EARTH', 'NOVA', 'AURORA', 'ORBIT', 'WORLD'];
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
  if (globe) {
    globe.position.y = Math.sin(t * 0.38) * 0.035;
    globe.children.forEach((child, index) => {
      if (child.isInstancedMesh && child.material?.transparent && child.material.opacity < 1) {
        child.position.y = Math.sin(t * 0.16 + index) * 0.025;
      }
    });
  }
  controls.update();
  renderer.render(scene, camera);
}
animate();
