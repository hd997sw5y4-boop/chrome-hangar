// Flame, smoke, explosion flash and break-apart debris.
import * as THREE from 'three';
import { disposeTree } from './parts3d.js';

const flameVS = `varying vec2 vUv; varying float vY; void main(){ vUv=uv; vY=position.y; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `;
const flameFS = `uniform float uTime; uniform float uPower; uniform vec3 uCore; uniform vec3 uEdge; varying vec2 vUv;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
void main(){ float y=1.0-vUv.y; float flick=n(vec2(vUv.x*8.0, y*6.0-uTime*14.0))*0.6+n(vec2(vUv.x*20.0,y*14.0-uTime*30.0))*0.4;
 float a=pow(1.0-y,1.6)*(0.55+0.6*flick)*uPower; float diamonds=0.5+0.5*sin(y*28.0-uTime*3.0);
 vec3 c=mix(uEdge,uCore,pow(1.0-y,3.0))+uCore*diamonds*0.25*(1.0-y);
 gl_FragColor=vec4(c*a*2.2, a); }`;

export class Flame {
  constructor(color = '#ffb347') {
    this.group = new THREE.Group();
    const mk = (r, core, edge, op) => {
      const geo = new THREE.CylinderGeometry(r * 0.55, r, 1, 24, 8, true); geo.translate(0, -0.5, 0);
      const m = new THREE.ShaderMaterial({ vertexShader: flameVS, fragmentShader: flameFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uCore: { value: new THREE.Color(core) }, uEdge: { value: new THREE.Color(edge) } } });
      m.userData.op = op; const o = new THREE.Mesh(geo, m); o.frustumCulled = false; this.group.add(o); return o;
    };
    this.outer = mk(1, '#fff2c8', color, 1); this.inner = mk(0.55, '#ffffff', '#bfe6ff', 1);
    this.light = new THREE.PointLight(0xff9a4a, 0, 120, 1.6); this.light.position.y = -2; this.group.add(this.light);
    this.group.visible = false;
  }
  update(t, power, radius, len, rho = 1.2) {
    this.group.visible = power > 0.01;
    const expand = 1 + (1 - Math.min(1, rho / 1.225)) * 1.8;
    for (const [o, l] of [[this.outer, len], [this.inner, len * 0.45]]) {
      o.material.uniforms.uTime.value = t; o.material.uniforms.uPower.value = power;
      o.scale.set(radius * expand, l * (0.85 + 0.15 * Math.sin(t * 40)), radius * expand);
    }
    this.light.intensity = power * 2500 * (0.85 + 0.15 * Math.sin(t * 53));
  }
}

function smokeTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); return t;
}

export class Smoke {
  constructor(max) { this.build(max); }
  build(max) {
    if (this.points) { this.points.removeFromParent(); this.points.geometry.dispose(); }
    this.max = max; this.n = 0; this.cursor = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.age = new Float32Array(max).fill(1e9); this.life = new Float32Array(max);
    this.size = new Float32Array(max); this.heat = new Float32Array(max); this.grow = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1); this.aAlpha = new THREE.BufferAttribute(new Float32Array(max), 1); this.aHeat = new THREE.BufferAttribute(new Float32Array(max), 1);
    geo.setAttribute('size', this.aSize); geo.setAttribute('alpha', this.aAlpha); geo.setAttribute('heat', this.aHeat);
    this.mat = this.mat || new THREE.ShaderMaterial({
      uniforms: { map: { value: smokeTex() }, scale: { value: 600 } }, transparent: true, depthWrite: false,
      vertexShader: `attribute float size; attribute float alpha; attribute float heat; varying float vA; varying float vH;
        uniform float scale; void main(){ vA=alpha; vH=heat; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=min(900.0, size*scale/-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D map; varying float vA; varying float vH; void main(){ vec4 t=texture2D(map,gl_PointCoord);
        vec3 c=mix(vec3(0.82,0.81,0.79), vec3(1.0,0.62,0.3), vH); gl_FragColor=vec4(c*(0.75+vH*1.5), t.a*vA); if(gl_FragColor.a<0.01) discard; }`,
    });
    this.points = new THREE.Points(geo, this.mat); this.points.frustumCulled = false;
  }
  emit(x, y, z, vx, vy, vz, size, life, heat = 0, grow = 1) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size; this.heat[i] = heat; this.grow[i] = grow;
  }
  update(dt, wind, viewH) {
    this.mat.uniforms.scale.value = viewH * 0.9;
    const S = this.aSize.array, A = this.aAlpha.array, H = this.aHeat.array;
    for (let i = 0; i < this.max; i++) {
      const a = this.age[i] += dt;
      if (a > this.life[i]) { A[i] = 0; continue; }
      const k = a / this.life[i], drag = Math.exp(-dt * 1.2);
      this.v[i * 3] = this.v[i * 3] * drag + wind.x * (1 - drag); this.v[i * 3 + 1] = this.v[i * 3 + 1] * drag + 0.8 * dt; this.v[i * 3 + 2] = this.v[i * 3 + 2] * drag + wind.z * (1 - drag);
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] = Math.max(0.2, this.p[i * 3 + 1] + this.v[i * 3 + 1] * dt); this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      S[i] = this.size[i] * (1 + k * 3 * this.grow[i]);
      A[i] = Math.min(1, a * 6) * (1 - k) * 0.55;
      H[i] = this.heat[i] * Math.max(0, 1 - a * 3);
    }
    this.points.geometry.attributes.position.needsUpdate = true; this.aSize.needsUpdate = this.aAlpha.needsUpdate = this.aHeat.needsUpdate = true;
  }
  clear() { this.age.fill(1e9); }
}

// Break-apart: each visible piece becomes a free body with gravity and ground bounce.
export class Debris {
  constructor(scene) { this.scene = scene; this.items = []; }
  explode(group, vel, origin) {
    group.updateMatrixWorld(true);
    const pieces = [];
    group.children.forEach(c => pieces.push(c));
    let i = 0;
    for (const c of pieces) {
      const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
      c.matrixWorld.decompose(wp, wq, ws);
      c.removeFromParent(); c.position.copy(wp); c.quaternion.copy(wq); c.scale.copy(ws); this.scene.add(c);
      const out = wp.clone().sub(origin); out.y = Math.abs(out.y) * 0.3 + 2; out.normalize();
      const a = i++ * 2.399; // golden angle spread, deterministic
      const v = new THREE.Vector3(vel.x, vel.y * 0.6, vel.z).add(out.multiplyScalar(6 + (i % 3) * 3)).add(new THREE.Vector3(Math.cos(a) * 4, 3, Math.sin(a) * 4));
      this.items.push({ o: c, v, w: new THREE.Vector3(Math.sin(a) * 3, Math.cos(a * 1.3) * 2, Math.sin(a * 0.7) * 3), rest: false });
    }
  }
  update(dt) {
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    for (const d of this.items) {
      if (d.rest) continue;
      d.v.y -= 9.81 * dt; d.o.position.addScaledVector(d.v, dt);
      e.set(d.w.x * dt, d.w.y * dt, d.w.z * dt); q.setFromEuler(e); d.o.quaternion.multiply(q);
      if (d.o.position.y < 0.3) { d.o.position.y = 0.3; d.v.y *= -0.3; d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.5); if (Math.abs(d.v.y) < 0.6 && d.v.length() < 1) d.rest = true; }
    }
  }
  clear() { for (const d of this.items) { d.o.removeFromParent(); disposeTree(d.o); } this.items.length = 0; }
}
