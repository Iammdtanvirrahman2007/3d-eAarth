import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x01040b);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 500);
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
scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.38, sizeAttenuation: true, transparent: true, opacity: 0.84 })));

const sunGlow = new THREE.Mesh(new THREE.SphereGeometry(2.35, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff2b0 }));
sunGlow.position.set(57, 30, 55);
scene.add(sunGlow);
const sunPoint = new THREE.PointLight(0xffd98a, 1.8, 180);
sunPoint.position.copy(sunGlow.position);
scene.add(sunPoint);

const VOXEL = 1.20;
const BASE_RADIUS = 25.5;
const LAND_HEIGHT = 3.0;
const GRID_RADIUS = Math.ceil(BASE_RADIUS + LAND_HEIGHT + 2);
const GLOBE_SCALE = VOXEL;
let globe = null;

const palette = {
  deepOcean: 0x0750a7, ocean: 0x0b69c7, shallow: 0x168bd1,
  grass: 0x3e982f, grassLight: 0x63b83a, forest: 0x176d2d,
  sand: 0xe5c477, snow: 0xf3f7fa, ice: 0xdceeff,
  dirt: 0x714a2d, stone: 0x59616d
};

const mapColors = {
  deepOcean: '#0750a7', ocean: '#0b69c7', shallow: '#168bd1',
  grass: '#3e982f', grassLight: '#63b83a', forest: '#176d2d',
  sand: '#e5c477', snow: '#f3f7fa', ice: '#dceeff'
};

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
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
function fade(t) { return t * t * (3 - 2 * t); }
function noise3(x, y, z, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fx = fade(x - x0), fy = fade(y - y0), fz = fade(z - z0);
  const v = (dx, dy, dz) => hash3(x0 + dx, y0 + dy, z0 + dz, seed);
  const a = THREE.MathUtils.lerp(v(0,0,0), v(1,0,0), fx);
  const b = THREE.MathUtils.lerp(v(0,1,0), v(1,1,0), fx);
  const c = THREE.MathUtils.lerp(v(0,0,1), v(1,0,1), fx);
  const d = THREE.MathUtils.lerp(v(0,1,1), v(1,1,1), fx);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a,b,fy), THREE.MathUtils.lerp(c,d,fy), fz);
}
function fbm(x, y, z, seed, octaves = 4) {
  let value = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) { value += noise3(x*freq,y*freq,z*freq,seed+i*911)*amp; freq*=2; amp*=0.5; }
  return value;
}
function angularDistance(a,b) { let d=Math.abs(a-b)%(Math.PI*2); return d>Math.PI?Math.PI*2-d:d; }

// One terrain function powers both views. Therefore the 2D map is the flat projection
// of the same seeded globe, not a separate random map.
const continents = [
  {lon:-1.78,lat:0.63,sx:0.82,sy:0.47},{lon:-1.05,lat:-0.18,sx:0.42,sy:0.78},
  {lon:-0.42,lat:0.10,sx:0.58,sy:0.70},{lon:0.98,lat:0.74,sx:1.65,sy:0.50},
  {lon:1.35,lat:0.15,sx:0.46,sy:0.40},{lon:2.34,lat:-0.44,sx:0.55,sy:0.30},
  {lon:-0.78,lat:1.26,sx:0.23,sy:0.22},{lon:0.05,lat:-1.18,sx:2.8,sy:0.22}
];
function continentScore(lon,lat) {
  let best=0;
  for(const c of continents){ const dl=angularDistance(lon,c.lon), dLat=lat-c.lat; const q=Math.sqrt((dl/c.sx)**2+(dLat/c.sy)**2); best=Math.max(best,Math.max(0,1-q)); }
  return best;
}
function earthTerrain(direction,seed) {
  const lon=Math.atan2(direction.z,direction.x), lat=Math.asin(THREE.MathUtils.clamp(direction.y,-1,1));
  const landShape=continentScore(lon,lat);
  const coastNoise=(fbm(direction.x*3+8,direction.y*3-4,direction.z*3+11,seed,3)-0.5)*0.42;
  const landScore=landShape+coastNoise;
  const polarIce=Math.abs(lat)>1.22;
  const land=polarIce||landScore>0.49;
  const heightNoise=fbm(direction.x*4.4,direction.y*4.4,direction.z*4.4,seed+100,4);
  const mountainNoise=fbm(direction.x*9,direction.y*9,direction.z*9,seed+200,3);
  let height=land?0.65+Math.max(0,landScore-0.49)*4.5+heightNoise*0.9:0;
  if(land&&mountainNoise>0.68) height+=(mountainNoise-0.68)*7;
  height=THREE.MathUtils.clamp(height,0.4,LAND_HEIGHT);
  const desertNoise=fbm(direction.x*2.8+30,direction.y*2.8,direction.z*2.8-20,seed+400,3);
  const forestNoise=fbm(direction.x*5.5-17,direction.y*5.5+2,direction.z*5.5+9,seed+500,3);
  let type='ocean';
  if(land){
    if(polarIce||Math.abs(lat)>1.05) type='snow';
    else if(desertNoise>0.68&&lat>-0.35&&lat<0.72) type='sand';
    else if(forestNoise>0.57&&lat>-0.65&&lat<0.75) type='forest';
    else if(landScore>0.73) type='grassLight'; else type='grass';
  }else if(lat>1.08||lat<-1.08) type='ice';
  else { const shallow=Math.sin(lon*5+lat*2)*0.03+coastNoise; type=shallow>-0.10?(landShape<0.04?'shallow':'shallow'):(landShape<0.04?'deepOcean':'ocean'); }
  return {lon,lat,land,height,type};
}

function makeGlobe(seedText) {
  if(globe){
    scene.remove(globe);
    globe.traverse(obj=>{ if(obj.isInstancedMesh)obj.dispose(); if(obj.material)obj.material.dispose?.(); if(obj.geometry)obj.geometry.dispose?.(); });
  }
  globe=new THREE.Group(); globe.rotation.y=-0.36; scene.add(globe);
  const seed=hashString(seedText);
  const cells=Object.fromEntries(Object.keys(palette).map(k=>[k,[]]));
  const occupied=new Map(), infoMap=new Map();
  const keyFor=(x,y,z)=>`${x},${y},${z}`;

  for(let x=-GRID_RADIUS;x<=GRID_RADIUS;x++) for(let y=-GRID_RADIUS;y<=GRID_RADIUS;y++) for(let z=-GRID_RADIUS;z<=GRID_RADIUS;z++){
    const distance=Math.sqrt(x*x+y*y+z*z);
    if(distance>BASE_RADIUS+LAND_HEIGHT+0.95) continue;
    const raw=new THREE.Vector3(x,y,z);
    const direction=raw.lengthSq()?raw.normalize():new THREE.Vector3(0,1,0);
    const terrain=earthTerrain(direction,seed);
    const surfaceRadius=BASE_RADIUS+(terrain.land?terrain.height:0);
    if(distance>surfaceRadius+0.52) continue;
    const key=keyFor(x,y,z); occupied.set(key,true); infoMap.set(key,{terrain,distance});
  }

  const neighbors=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  const dummy=new THREE.Object3D();
  for(const [key,info] of infoMap){
    const [x,y,z]=key.split(',').map(Number); let exposed=false;
    for(const [dx,dy,dz] of neighbors){ if(!occupied.has(keyFor(x+dx,y+dy,z+dz))){exposed=true;break;} }
    let type='stone';
    if(exposed) type=info.terrain.type; else if(info.distance>BASE_RADIUS-2.5) type=info.terrain.land?'dirt':'ocean';
    dummy.position.set(x*GLOBE_SCALE,y*GLOBE_SCALE,z*GLOBE_SCALE); dummy.rotation.set(0,0,0); dummy.scale.setScalar(1.012); dummy.updateMatrix();
    cells[type]?.push(dummy.matrix.clone());
  }

  const geometry=new THREE.BoxGeometry(VOXEL,VOXEL,VOXEL), materials={};
  for(const [type,color] of Object.entries(palette)) materials[type]=new THREE.MeshStandardMaterial({color,roughness:['deepOcean','ocean','shallow'].includes(type)?0.68:0.9,metalness:0});
  let total=0;
  for(const type of Object.keys(cells)){
    if(!cells[type].length) continue;
    const mesh=new THREE.InstancedMesh(geometry,materials[type],cells[type].length);
    for(let i=0;i<cells[type].length;i++) mesh.setMatrixAt(i,cells[type][i]);
    mesh.instanceMatrix.needsUpdate=true; mesh.computeBoundingSphere(); globe.add(mesh); total+=cells[type].length;
  }
  const atmosphere=new THREE.Mesh(new THREE.SphereGeometry((BASE_RADIUS+LAND_HEIGHT+1.1)*VOXEL,64,40),new THREE.MeshBasicMaterial({color:0x247cff,transparent:true,opacity:0.075,side:THREE.BackSide,depthWrite:false}));
  globe.add(atmosphere);
  document.getElementById('stats').textContent=`Seed: ${seedText} · ${total.toLocaleString()} voxel blocks · shared 2D map`;
  return total;
}

function drawMap(seedText){
  const canvas=document.getElementById('worldMap'), ctx=canvas.getContext('2d'), W=canvas.width, H=canvas.height, seed=hashString(seedText);
  ctx.clearRect(0,0,W,H); ctx.fillStyle=mapColors.deepOcean; ctx.fillRect(0,0,W,H);
  const cols=360, rows=180, cw=W/cols, ch=H/rows;
  for(let y=0;y<rows;y++){
    const lat=Math.PI/2-((y+0.5)/rows)*Math.PI, cosLat=Math.cos(lat);
    for(let x=0;x<cols;x++){
      const lon=-Math.PI+((x+0.5)/cols)*Math.PI*2;
      const direction=new THREE.Vector3(Math.cos(lon)*cosLat,Math.sin(lat),Math.sin(lon)*cosLat);
      const terrain=earthTerrain(direction,seed);
      ctx.fillStyle=mapColors[terrain.type]||mapColors.ocean;
      ctx.fillRect(Math.floor(x*cw),Math.floor(y*ch),Math.ceil(cw+0.35),Math.ceil(ch+0.35));
    }
  }
  ctx.strokeStyle='rgba(180,220,255,.14)'; ctx.lineWidth=1;
  for(let lon=-180;lon<=180;lon+=30){const x=((lon+180)/360)*W;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  for(let lat=-60;lat<=60;lat+=30){const y=((90-lat)/180)*H;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  ctx.fillStyle='rgba(235,248,255,.9)'; ctx.font='bold 13px system-ui'; ctx.fillText('N',16,25);
  ctx.font='11px system-ui'; ctx.fillStyle='rgba(210,232,255,.7)'; ctx.fillText('Same seeded Earth • flat projection of the 3D globe',16,H-16);
  document.getElementById('mapSeed').textContent=`Seed: ${seedText}`;
}

const seedInput=document.getElementById('seed');
const generateButton=document.getElementById('generate');
const randomButton=document.getElementById('random');
const globeButton=document.getElementById('globeView');
const mapButton=document.getElementById('mapView');
const mapScreen=document.getElementById('mapScreen');

function generate(){
  const seedText=seedInput.value.trim()||'TANVIR-2026'; seedInput.value=seedText;
  document.getElementById('loading').classList.remove('hidden-loading');
  requestAnimationFrame(()=>{makeGlobe(seedText);drawMap(seedText);document.getElementById('loading').classList.add('hidden-loading');});
}
function setView(view){
  const isMap=view==='map'; renderer.domElement.style.display=isMap?'none':'block'; mapScreen.classList.toggle('hidden',!isMap);
  globeButton.classList.toggle('active',!isMap); mapButton.classList.toggle('active',isMap); controls.enabled=!isMap;
}
generateButton.addEventListener('click',generate);
randomButton.addEventListener('click',()=>{seedInput.value=Math.floor(Math.random()*1000000000).toString();generate();});
globeButton.addEventListener('click',()=>setView('globe'));
mapButton.addEventListener('click',()=>setView('map'));
seedInput.addEventListener('keydown',event=>{if(event.key==='Enter')generate();});
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});

function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera);}
setView('globe'); generate(); animate();
