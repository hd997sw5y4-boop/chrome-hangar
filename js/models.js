// CC0 glTF models (Poly Haven), shipped as meshopt-compressed GLB with 512–1024 px WebP textures.
// Everything loaded here is shared: geometries are flagged `keep` so disposeTree() never frees them.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import { MeshoptDecoder } from '../vendor/meshopt/meshopt_decoder.mjs';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();
let lite = false;
// dequantize (meshopt / KHR_mesh_quantization) to plain Float32 so transforms can be baked and merged safely
function toF32(g) {
  for (const k of Object.keys(g.attributes)) {
    const a = g.attributes[k];
    if (a.array instanceof Float32Array && !a.isInterleavedBufferAttribute && !a.normalized) continue;
    const n = a.itemSize, f = new Float32Array(a.count * n), get = [a.getX, a.getY, a.getZ, a.getW];
    for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) f[i * n + c] = get[c].call(a, i);
    g.setAttribute(k, new THREE.BufferAttribute(f, n));
  }
  return g;
} // phone/low: drop normal maps to save GPU memory

export function setModelTier(q) { lite = q === 'phone' || q === 'low'; }

export function loadModel(name) {
  if (cache.has(name)) return cache.get(name);
  const p = loader.loadAsync(`assets/models/${name}.glb`).then(g => {
    const root = g.scene; root.updateMatrixWorld(true);
    root.traverse(o => {
      if (!o.isMesh) return;
      o.geometry.userData.keep = true; o.castShadow = true; o.receiveShadow = true;
      const m = o.material;
      if (lite && m.normalMap) { m.normalMap.dispose(); m.normalMap = null; m.needsUpdate = true; }
      if (m.map) m.map.anisotropy = 4;
      if (m.transparent && m.alphaTest === 0) { m.alphaTest = 0.4; m.transparent = false; }
      // transmissive glass forces three.js to re-render every opaque object into an extra target each frame: use plain see-through glass
      if (m.transmission > 0) { m.transmission = 0; m.transparent = true; m.opacity = 0.35; m.depthWrite = false; m.needsUpdate = true; }
    });
    return root;
  });
  cache.set(name, p);
  return p;
}

// Collect mesh nodes (optionally filtered by name), bake their transforms, merge by material,
// and recentre so the union sits on y=0 at the origin. Returns [{ geometry, material }].
export async function pieces(name, filter = null, opts = {}) {
  const root = await loadModel(name);
  const byMat = new Map(), box = new THREE.Box3();
  root.traverse(o => {
    if (!o.isMesh || (filter && !filter(o.name))) return;
    const g = toF32(o.geometry.clone()); g.applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'tangent'].includes(k)) g.deleteAttribute(k);
    g.computeBoundingBox(); box.union(g.boundingBox);
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g);
  });
  const c = box.getCenter(new THREE.Vector3());
  const s = opts.scale ?? 1;
  const out = [];
  for (const [mat, gs] of byMat) {
    const sig = g => Object.keys(g.attributes).sort().join();
    const groups = new Map(); for (const g of gs) { const k = sig(g); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(g); }
    for (const list of groups.values()) {
      const g = list.length > 1 ? mergeGeometries(list, false) : list[0];
      if (!g) continue;
      g.translate(opts.keepOrigin ? 0 : -c.x, opts.keepOrigin ? 0 : -box.min.y, opts.keepOrigin ? 0 : -c.z);
      if (s !== 1) g.scale(s, s, s);
      g.computeBoundingSphere(); g.userData.keep = true;
      out.push({ geometry: g, material: mat });
    }
  }
  out.size = box.getSize(new THREE.Vector3()).multiplyScalar(s);
  return out;
}

// A plain (non-instanced) prop: a group of meshes sharing the cached geometry.
export async function prop(name, filter = null, opts = {}) {
  const ps = await pieces(name, filter, opts), g = new THREE.Group();
  for (const p of ps) { const m = new THREE.Mesh(p.geometry, p.material); m.castShadow = opts.shadow !== false; m.receiveShadow = true; g.add(m); }
  g.userData.size = ps.size;
  return g;
}

// Instanced copies: transforms = [{ x, y, z, ry, s }] → group of InstancedMesh (one per material).
export async function instanced(name, transforms, filter = null, opts = {}) {
  const ps = await pieces(name, filter, opts), g = new THREE.Group();
  const o = new THREE.Object3D();
  for (const p of ps) {
    const im = new THREE.InstancedMesh(p.geometry, p.material, transforms.length);
    transforms.forEach((t, i) => {
      o.position.set(t.x, t.y ?? 0, t.z); o.rotation.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0);
      const sc = t.s ?? 1; o.scale.set(sc, t.sy ?? sc, sc); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
    });
    im.castShadow = opts.shadow !== false; im.receiveShadow = true;
    im.computeBoundingSphere();
    g.add(im);
  }
  return g;
}
