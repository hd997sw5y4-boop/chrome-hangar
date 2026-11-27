// PBR texture sets (Poly Haven, CC0) packed as WebP: <name>_{diff,nor,arm}_{1k,2k}.webp.
// Phone/Low: 1K colour + ARM only (no normal maps). Medium: 1K with normals. High/Ultra: 2K where shipped.
import * as THREE from 'three';

const HAS2K = new Set(['hangar_concrete_floor', 'corrugated_iron_02', 'concrete_floor_worn_001']);
const loader = new THREE.TextureLoader();
const cache = new Map();
let tier = 'high', maxAniso = 8;

export function setTexTier(q, renderer) { tier = q; maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy()); }
const useNormals = () => tier !== 'phone' && tier !== 'low';
const resFor = n => (tier === 'high' || tier === 'ultra') && HAS2K.has(n) ? '2k' : '1k';

function load(url, srgb) {
  if (cache.has(url)) return cache.get(url);
  const p = loader.loadAsync(url).then(t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return t;
  });
  cache.set(url, p); return p;
}

// Applies a PBR set to a material. repeat = [u, v] tiles across the mesh's UVs.
export async function applyPBR(mat, name, repeat = [1, 1], opts = {}) {
  const res = resFor(name), base = `assets/tex/${name}_`;
  const jobs = [load(`${base}diff_${res}.webp`, true), load(`${base}arm_${res}.webp`, false)];
  if (useNormals() && opts.normal !== false) jobs.push(load(`${base}nor_${res}.webp`, false));
  const [diff, arm, nor] = await Promise.all(jobs);
  const rep = t => { const c = t.clone(); c.repeat.set(repeat[0], repeat[1]); if (opts.rotate) { c.rotation = opts.rotate; } c.needsUpdate = true; return c; };
  mat.map = rep(diff);
  const a = rep(arm); mat.aoMap = opts.ao === false ? null : a; mat.roughnessMap = a; mat.metalnessMap = opts.metal ? a : null;
  if (nor) { mat.normalMap = rep(nor); mat.normalScale = new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1); }
  mat.needsUpdate = true;
  return mat;
}
