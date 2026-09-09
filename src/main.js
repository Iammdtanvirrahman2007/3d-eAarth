import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x01040b);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 5, 58);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 34;
controls.maxDistance = 105;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.22;
controls.target.set(0, 0, 0);

scene.add(new THREE.AmbientLight(0x8eafff, 0.62));
const sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
sunLight.position.set(46, 30, 42);
scene.add(sunLight);
const blueRim = new THREE.DirectionalLight(0x3d70ff, 0.9);
blueRim.position.set(-38, -8, -48);
scene.add(blueRim);

// Lightweight star field: one draw call, no individual star objects.
const starCount = 1500;
const starPositions = new Float32Array(starCount * 3);
let starSeed = 741289;
for (let i = 0; i < starCount; i++) {
  starSeed = (starSeed * 1664525 + 1013904223) >>> 0;
  const a = (starSeed / 4294967296) * Math.PI * 2;
  starSeed = (starSeed * 1664525 + 1013904223) >>> 0;
  const u = starSeed / 4294967296;
  const r = 140 + u * 115;
  const y = (u - 0.5) * 180;
  const ring = Math.sqrt(Math.max(0, r * r - y * y));
  starPositions[i * 3] = Math.cos(a) * ring;
  starPositions[i * 3 + 1] = y;
  starPositions[i * 3 + 2] = Math.sin(a) * ring;
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.34, sizeAttenuation: true, transparent: true, opacity: 0.78 }))); 

const sunGlow = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff2b0 }));
sunGlow.position.set(57, 30, 55);
scene.add(sunGlow);
const sunPoint = new THREE.PointLight(0xffd98a, 1.5, 180);
sunPoint.position.copy(sunGlow.position);
scene.add(sunPoint);

// Performance-friendly voxel scale. The globe stays physically large while using fewer cells.
const VOXEL = 1.45;
const BASE_RADIUS = 22;
const LAND_HEIGHT = 2.7;
const GRID_RADIUS = Math.ceil(BASE_RADIUS + LAND_HEIGHT + 1.5);
const INNER_RADIUS = BASE_RADIUS - 3.0;
const MAP_W = 240;
const MAP_H = 120;
let globe = null;
let worldData = null;
let generationToken = 0;

const palette = {
  deepOcean: 0x0750a7, ocean: 0x0b69c7, shallow: 0x168bd1,
  grass: 0x3e982f, grassLight: 0x63b83a, forest: 0x176d2d,
  sand: 0xe5c477, snow: 0xf3f7fa, ice: 0xdceeff,
  dirt: 0x714a2d, stone: 0x59616d
};
const typeNames = Object.keys(palette);
const typeIndex = Object.fromEntries(typeNames.map((name, i) => [name, i]));
const mapColors = ['#0750a7','#0b69c7','#168bd1','#3e982f','#63b83a','#176d2d','#e5c477','#f3f7fa','#dceeff','#714a2d','#59616d'];

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
  const v000 = hash3(x0,y0,z0,seed), v100 = hash3(x0+1,y0,z0,seed);
  const v010 = hash3(x0,y0+1,z0,seed), v110 = hash3(x0+1,y0+1,z0,seed);
  const v001 = hash3(x0,y0,z0+1,seed), v101 = hash3(x0+1,y0,z0+1,seed);
  const v011 = hash3(x0,y0+1,z0+1,seed), v111 = hash3(x0+1,y0+1,z0+1,seed);
  const x00 = v000 + (v100-v000)*fx, x10 = v010 + (v110-v010)*fx;
  const x01 = v001 + (v101-v001)*fx, x11 = v011 + (v111-v011)*fx;
  const y0v = x00 + (x10-x00)*fy, y1v = x01 + (x11-x01)*fy;
  return y0v + (y1v-y0v)*fz;
}
function fbm(x,y,z,seed,octaves=2) {
  let value=0, amp=0.5, freq=1;
  for(let i=0;i<octaves;i++){ value += noise3(x*freq,y*freq,z*freq,seed+i*911)*amp; freq*=2; amp*=0.5; }
  return value;
}
function angularDistance(a,b) { let d=Math.abs(a-b)%(Math.PI*2); return d>Math.PI?Math.PI*2-d:d; }

const continents = [
  {lon:-1.78,lat:0.63,sx:0.82,sy:0.47},{lon:-1.05,lat:-0.18,sx:0.42,sy:0.78},
  {lon:-0.42,lat:0.10,sx:0.58,sy:0.70},{lon:0.98,lat:0.74,sx:1.65,sy:0.50},
  {lon:1.35,lat:0.15,sx:0.46,sy:0.40},{lon:2.34,lat:-0.44,sx:0.55,sy:0.30},
  {lon:-0.78,lat:1.26,sx:0.23,sy:0.22},{lon:0.05,lat:-1.18,sx:2.8,sy:0.22}
];
function continentScore(lon,lat) {
  let best=0;
  for(const c of continents){
    const dl=angularDistance(lon,c.lon), dLat=lat-c.lat;
    const q=Math.sqrt((dl/c.sx)**2+(dLat/c.sy)**2);
    best=Math.max(best,Math.max(0,1-q));
  }
  return best;
}
function classifyTerrain(direction,seed) {
  const lon=Math.atan2(direction.z,direction.x);
  const lat=Math.asin(THREE.MathUtils.clamp(direction.y,-1,1));
  const landShape=continentScore(lon,lat);
  const coastNoise=(fbm(direction.x*3+8,direction.y*3-4,direction.z*3+11,seed,2)-0.5)*0.34;
  const landScore=landShape+coastNoise;
  const polarIce=Math.abs(lat)>1.22;
  const land=polarIce || landScore>0.49;
  const heightNoise=fbm(direction.x*4.4,direction.y*4.4,direction.z*4.4,seed+100,2);
  let height=land ? 0.55+Math.max(0,landScore-0.49)*4.0+heightNoise*0.7 : 0;
  if(land){
    const mountain=fbm(direction.x*8,direction.y*8,direction.z*8,seed+200,2);
    if(mountain>0.72) height += (mountain-0.72)*5.0;
  }
  height=THREE.MathUtils.clamp(height,0.35,LAND_HEIGHT);
  const desertNoise=fbm(direction.x*2.8+30,direction.y*2.8,direction.z*2.8-20,seed+400,2);
  const forestNoise=fbm(direction.x*5.5-17,direction.y*5.5+2,direction.z*5.5+9,seed+500,2);
  let type='ocean';
  if(land){
    if(polarIce || Math.abs(lat)>1.05) type='snow';
    else if(desertNoise>0.67&&lat>-0.35&&lat<0.72) type='sand';
    else if(forestNoise>0.57&&lat>-0.65&&lat<0.75) type='forest';
    else if(landScore>0.73) type='grassLight';
    else type='grass';
  } else if(lat>1.08||lat<-1.08) type='ice';
  else {
    const shallow=Math.sin(lon*5+lat*2)*0.03+coastNoise;
    type=shallow>-0.10?'shallow':'ocean';
  }
  return { land, height, type };
}

// Generate one shared low-resolution world dataset. Both 3D and 2D read this exact data.
function buildWorld(seedText) {
  const seed=hashString(seedText);
  const types=new Uint8Array(MAP_W*MAP_H);
  const heights=new Uint8Array(MAP_W*MAP_H);
  for(let y=0;y<MAP_H;y++){
    const lat=Math.PI/2-((y+0.5)/MAP_H)*Math.PI;
    const cosLat=Math.cos(lat), sy=Math.sin(lat);
    for(let x=0;x<MAP_W;x++){
      const lon=-Math.PI+((x+0.5)/MAP_W)*Math.PI*2;
      const dir={x:Math.cos(lon)*cosLat,y:sy,z:Math.sin(lon)*cosLat};
      const t=classifyTerrain(dir,seed);
      const i=y*MAP_W+x;
      types[i]=typeIndex[t.type];
      heights[i]=Math.round((t.land?t.height:0)*25);
    }
  }
  return { types, heights, seedText };
}
function sampleWorld(direction){
  const lon=Math.atan2(direction.z,direction.x);
  const lat=Math.asin(THREE.MathUtils.clamp(direction.y,-1,1));
  let x=Math.floor(((lon+Math.PI)/(Math.PI*2))*MAP_W);
  let y=Math.floor(((Math.PI/2-lat)/Math.PI)*MAP_H);
  x=(x%MAP_W+MAP_W)%MAP_W; y=THREE.MathUtils.clamp(y,0,MAP_H-1);
  const i=y*MAP_W+x;
  const type=typeNames[worldData.types[i]];
  return { land: ['grass','grassLight','forest','sand','snow'].includes(type), height:worldData.heights[i]/25, type };
}

function makeGlobe(seedText){
  if(globe){
    scene.remove(globe);
    globe.traverse(o=>{ if(o.isInstancedMesh){o.geometry.dispose();o.material.dispose();} });
  }
  globe=new THREE.Group();
  globe.rotation.y=-0.36;
  scene.add(globe);

  const cells=Object.fromEntries(typeNames.map(k=>[k,[]]));
  const occupied=new Set();
  const surfaceInfo=new Map();
  const offset=32;
  const key=(x,y,z)=>((x+offset)*64+(y+offset))*64+(z+offset);

  // Pass 1: fill the solid core cheaply, and only sample terrain near the surface.
  for(let x=-GRID_RADIUS;x<=GRID_RADIUS;x++){
    for(let y=-GRID_RADIUS;y<=GRID_RADIUS;y++){
      for(let z=-GRID_RADIUS;z<=GRID_RADIUS;z++){
        const d2=x*x+y*y+z*z;
        if(d2>(BASE_RADIUS+LAND_HEIGHT+0.8)**2) continue;
        if(d2<=INNER_RADIUS*INNER_RADIUS){ occupied.add(key(x,y,z)); continue; }
        const len=Math.sqrt(d2);
        const dir={x:x/len,y:y/len,z:z/len};
        const terrain=sampleWorld(dir);
        const surface=BASE_RADIUS+(terrain.land?terrain.height:0);
        if(len<=surface+0.48){
          const k=key(x,y,z); occupied.add(k); surfaceInfo.set(k,terrain);
        }
      }
    }
  }

  const neighbors=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  for(const k of occupied){
    const z=(k%64)-offset;
    const q=Math.floor(k/64), y=(q%64)-offset, x=Math.floor(q/64)-offset;
    let exposed=false;
    for(const [dx,dy,dz] of neighbors){ if(!occupied.has(key(x+dx,y+dy,z+dz))){exposed=true;break;} }
    const terrain=surfaceInfo.get(k);
    let type='stone';
    if(exposed && terrain) type=terrain.type;
    else if(!exposed && terrain && terrain.land && Math.sqrt(x*x+y*y+z*z)>BASE_RADIUS-2.0) type='dirt';
    else if(exposed) type='ocean';
    cells[type].push(x,y,z);
  }

  const geometry=new THREE.BoxGeometry(VOXEL,VOXEL,VOXEL);
  const dummy=new THREE.Object3D();
  let total=0;
  for(const [type,positions] of Object.entries(cells)){
    if(!positions.length) continue;
    const material=new THREE.MeshStandardMaterial({color:palette[type],roughness:0.88,metalness:0});
    const mesh=new THREE.InstancedMesh(geometry,material,positions.length/3);
    for(let i=0,j=0;i<positions.length;i+=3,j++){
      dummy.position.set(positions[i]*VOXEL,positions[i+1]*VOXEL,positions[i+2]*VOXEL);
      dummy.scale.setScalar(1.012);
      dummy.updateMatrix();
      mesh.setMatrixAt(j,dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate=true;
    mesh.computeBoundingSphere();
    globe.add(mesh);
    total+=positions.length/3;
  }

  const atmosphere=new THREE.Mesh(
    new THREE.SphereGeometry((BASE_RADIUS+LAND_HEIGHT+0.9)*VOXEL,32,20),
    new THREE.MeshBasicMaterial({color:0x247cff,transparent:true,opacity:0.07,side:THREE.BackSide,depthWrite:false})
  );
  globe.add(atmosphere);
  document.getElementById('stats').textContent=`Seed: ${seedText} · ${total.toLocaleString()} voxel blocks · shared 2D map`;
  return total;
}

function drawMap(){
  const canvas=document.getElementById('worldMap');
  const ctx=canvas.getContext('2d',{alpha:false});
  const W=canvas.width,H=canvas.height;
  const image=ctx.createImageData(W,H);
  const rgb={
    '#0750a7':[7,80,167],'#0b69c7':[11,105,199],'#168bd1':[22,139,209],
    '#3e982f':[62,152,47],'#63b83a':[99,184,58],'#176d2d':[23,109,45],
    '#e5c477':[229,196,119],'#f3f7fa':[243,247,250],'#dceeff':[220,238,255],
    '#714a2d':[113,74,45],'#59616d':[89,97,109]
  };
  for(let py=0;py<H;py++){
    const sy=Math.min(MAP_H-1,Math.floor(py/H*MAP_H));
    for(let px=0;px<W;px++){
      const sx=Math.min(MAP_W-1,Math.floor(px/W*MAP_W));
      const type=typeNames[worldData.types[sy*MAP_W+sx]];
      const c=rgb[mapColors[typeIndex[type]]] || [11,105,199];
      const i=(py*W+px)*4;
      image.data[i]=c[0]; image.data[i+1]=c[1]; image.data[i+2]=c[2]; image.data[i+3]=255;
    }
  }
  ctx.putImageData(image,0,0);
  ctx.strokeStyle='rgba(180,220,255,.14)'; ctx.lineWidth=1;
  for(let lon=-180;lon<=180;lon+=30){const x=((lon+180)/360)*W;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  for(let lat=-60;lat<=60;lat+=30){const y=((90-lat)/180)*H;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  ctx.fillStyle='rgba(235,248,255,.9)'; ctx.font='bold 13px system-ui'; ctx.fillText('N',16,25);
  ctx.font='11px system-ui'; ctx.fillStyle='rgba(210,232,255,.7)'; ctx.fillText('Same seeded Earth • flat projection of the 3D globe',16,H-16);
  document.getElementById('mapSeed').textContent=`Seed: ${worldData.seedText}`;
}

function setView(view){
  const isGlobe=view==='globe';
  document.getElementById('globeView').classList.toggle('active',isGlobe);
  document.getElementById('mapView').classList.toggle('active',!isGlobe);
  document.getElementById('mapScreen').classList.toggle('hidden',isGlobe);
  renderer.domElement.style.display=isGlobe?'block':'none';
  controls.enabled=isGlobe;
}

const seedInput=document.getElementById('seed');
const generateButton=document.getElementById('generate');
const randomButton=document.getElementById('random');
const globeButton=document.getElementById('globeView');
const mapButton=document.getElementById('mapView');

globeButton.addEventListener('click',()=>setView('globe'));
mapButton.addEventListener('click',()=>setView('map'));
randomButton.addEventListener('click',()=>{
  seedInput.value=`EARTH-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
  generateWorld();
});
generateButton.addEventListener('click',generateWorld);
seedInput.addEventListener('keydown',e=>{if(e.key==='Enter')generateWorld();});

function generateWorld(){
  const token=++generationToken;
  const seedText=(seedInput.value.trim()||'TANVIR-2026').slice(0,32);
  seedInput.value=seedText;
  generateButton.disabled=true;
  randomButton.disabled=true;
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('loading').textContent='Generating optimized Earth…';
  // Let the browser paint the loading state before the CPU work begins.
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(token!==generationToken)return;
    worldData=buildWorld(seedText);
    makeGlobe(seedText);
    drawMap();
    generateButton.disabled=false;
    randomButton.disabled=false;
    document.getElementById('loading').classList.add('hidden');
  }));
}

window.addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
});

let lastTime=performance.now();
function animate(now){
  requestAnimationFrame(animate);
  const dt=Math.min(0.05,(now-lastTime)/1000); lastTime=now;
  if(controls.enabled){ controls.update(); }
  if(globe && controls.autoRotate) globe.rotation.y += dt*0.018;
  renderer.render(scene,camera);
}

setView('globe');
generateWorld();
animate(performance.now());
