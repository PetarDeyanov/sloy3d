// 3D преглед на модели (three.js): въртене, мащабиране, смяна на цвят и повърхност.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---------- STL ----------
// Връща позициите на триъгълниците (мм, Z нагоре) и обем, площ и размери на модела.
export function parseSTL(buffer) {
  const dv = new DataView(buffer);
  let positions;
  const count = buffer.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  if (count > 0 && 84 + count * 50 === buffer.byteLength) {
    positions = new Float32Array(count * 9);
    for (let i = 0; i < count; i++) {
      const o = 84 + i * 50 + 12;
      for (let j = 0; j < 9; j++) positions[i * 9 + j] = dv.getFloat32(o + j * 4, true);
    }
  } else {
    const text = new TextDecoder().decode(buffer);
    const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
    const out = [];
    let m;
    while ((m = re.exec(text))) out.push(+m[1], +m[2], +m[3]);
    if (!out.length || out.length % 9) throw new Error('Файлът не е валиден STL.');
    positions = new Float32Array(out);
  }
  return { positions, ...measure(positions) };
}

// ---------- GLB ----------
// 3D прегледите от MakerWorld (Draco компресия). Връща същото като parseSTL — позиции със Z нагоре.
const DRACO_PATH = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/';
export async function parseGLB(buffer) {
  const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/loaders/DRACOLoader.js'),
  ]);
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_PATH);
  loader.setDRACOLoader(draco);
  const gltf = await new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
  draco.dispose();
  gltf.scene.updateMatrixWorld(true);
  const parts = [];
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    parts.push(g.attributes.position.array);
    g.dispose();
  });
  if (!parts.length) throw new Error('Празен GLB.');
  const positions = new Float32Array(parts.reduce((s, a) => s + a.length, 0));
  let off = 0;
  for (const a of parts) { positions.set(a, off); off += a.length; }
  // glTF по правило е с Y нагоре. Ако моделът не стои върху Z = 0, а върху Y = 0, го обръщаме към Z нагоре.
  let minY = Infinity, minZ = Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i + 1] < minY) minY = positions[i + 1];
    if (positions[i + 2] < minZ) minZ = positions[i + 2];
  }
  const zUp = Math.abs(minZ) < 0.5 && Math.abs(minY) > 0.5;
  if (!zUp) {
    for (let i = 0; i < positions.length; i += 3) {
      const y = positions[i + 1];
      positions[i + 1] = -positions[i + 2];
      positions[i + 2] = y;
    }
  }
  return { positions, ...measure(positions) };
}

export function measure(p) {
  let volume = 0;
  let area = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i], ay = p[i + 1], az = p[i + 2];
    const bx = p[i + 3], by = p[i + 4], bz = p[i + 5];
    const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    area += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
    for (let k = 0; k < 9; k += 3) {
      for (let a = 0; a < 3; a++) {
        const v = p[i + k + a];
        if (v < min[a]) min[a] = v;
        if (v > max[a]) max[a] = v;
      }
    }
  }
  return {
    volume: Math.abs(volume),
    area,
    size: { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] },
  };
}

// ---------- Сцена ----------
export function createViewer(container) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = !reduceMotion;
  controls.autoRotateSpeed = 1.4;
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b6577, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(1, 2, 1.4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffb27a, 0.9);
  rim.position.set(-1.5, 0.6, -1.2);
  scene.add(rim);

  const material = new THREE.MeshStandardMaterial({ color: 0xff6b1a, roughness: 0.55, metalness: 0 });
  let glow = false;
  let mesh = null;
  let grid = null;
  let baseSize = new THREE.Vector3(1, 1, 1);
  let scale = 1;

  const fit = () => {
    const s = baseSize.clone().multiplyScalar(scale);
    const radius = Math.max(s.length() / 2, 1);
    const dist = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.15;
    controls.target.set(0, s.y / 2, 0);
    camera.position.set(dist * 0.72, s.y / 2 + dist * 0.5, dist * 0.72);
    camera.near = dist / 100;
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.update();

    if (grid) { scene.remove(grid); grid.geometry.dispose(); }
    const footprint = Math.max(s.x, s.z);
    const cell = footprint > 120 ? 20 : footprint > 40 ? 10 : 5;
    const size = Math.max(Math.ceil((footprint * 1.6) / cell) * cell, cell * 6);
    grid = new THREE.GridHelper(size, size / cell, 0x8a8494, 0xcfc6b3);
    scene.add(grid);
  };

  const load = positions => {
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
    geo.rotateX(-Math.PI / 2);          // STL е със Z нагоре, three.js — с Y нагоре
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    bb.getSize(baseSize);
    mesh = new THREE.Mesh(geo, material);
    mesh.scale.setScalar(scale);
    scene.add(mesh);
    controls.autoRotate = !reduceMotion;
    fit();
  };

  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  let running = false;
  const setRunning = on => {
    if (on === running) return;
    running = on;
    renderer.setAnimationLoop(on ? () => { controls.update(); renderer.render(scene, camera); } : null);
  };
  const io = new IntersectionObserver(([e]) => setRunning(e.isIntersecting));
  io.observe(container);

  return {
    load,
    setColor: hex => {
      material.color.set(hex);
      material.emissive.set(glow ? hex : 0x000000);
    },
    setFinish: ({ roughness = 0.55, metalness = 0, opacity = 1, glow: g = false } = {}) => {
      material.roughness = roughness;
      material.metalness = metalness;
      material.transparent = opacity < 1;
      material.opacity = opacity;
      material.depthWrite = opacity >= 1;
      material.emissiveIntensity = 0.55;
      glow = g;
      material.emissive.set(glow ? material.color : 0x000000);
      material.needsUpdate = true;
    },
    setScale: s => { scale = s; if (mesh) { mesh.scale.setScalar(s); fit(); } },
    reset: () => { controls.autoRotate = !reduceMotion; fit(); },
    dispose: () => {
      setRunning(false);
      ro.disconnect();
      io.disconnect();
      if (mesh) mesh.geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
