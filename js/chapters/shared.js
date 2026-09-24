import * as THREE from 'three';
import { NOISE, FULLSCREEN_VERT } from '../glsl.js';
import { glc, rng } from '../util.js';

/* ------------------------------------------------------------------ */
/* Base chapter                                                        */
/* ------------------------------------------------------------------ */

export class Chapter {
  constructor(app, { fov = 35, near = 0.01, far = 1000 } = {}) {
    this.app = app;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(fov, app.aspect, near, far);
    // Screen-space depth-of-field: a focus segment (uv), its radius and blur strength (px @1080p).
    this.focus = { a: new THREE.Vector2(0.5, 0.5), b: new THREE.Vector2(0.5, 0.5), r: 0.3, s: 0 };
    this.bloom = 0.6;
    this.reducedT = 0.5;
    this.time = 0;
  }
  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
  update() {}
  click() {}

  /** Project a world point to uv (0..1, y up). */
  toScreen(v, out = new THREE.Vector2()) {
    const p = _v.copy(v).project(this.camera);
    return out.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
  }
  /** Distance in px between pointer and world point. */
  pointerDist(v, input) {
    const p = _v.copy(v).project(this.camera);
    if (p.z > 1) return Infinity;
    const dx = (p.x - input.x) * 0.5 * this.app.width;
    const dy = (p.y - input.y) * 0.5 * this.app.height;
    return Math.hypot(dx, dy);
  }
}
const _v = new THREE.Vector3();

/* ------------------------------------------------------------------ */
/* Backdrop: full-screen gradient behind everything                    */
/* ------------------------------------------------------------------ */

export function makeBackdrop(fragBody, uniforms = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAspect: { value: 1 }, uOffset: { value: new THREE.Vector2() }, ...uniforms },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uAspect; uniform vec2 uOffset;
      varying vec2 vUv;
      ${NOISE}
      void main(){
        vec2 uv = vUv + uOffset;
        vec3 col = vec3(0.0);
        ${fragBody}
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* Bokeh: soft out-of-focus discs                                      */
/* ------------------------------------------------------------------ */

export function makeBokeh({ count = 60, box, colors, size = [0.6, 2.4], intensity = 0.5, seed = 3 }) {
  const r = rng(seed);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const extra = new Float32Array(count * 2);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    pos[i * 3] = box.min.x + r() * (box.max.x - box.min.x);
    pos[i * 3 + 1] = box.min.y + r() * (box.max.y - box.min.y);
    pos[i * 3 + 2] = box.min.z + r() * (box.max.z - box.min.z);
    c.set(colors[Math.floor(r() * colors.length)]);
    col.set([c.r, c.g, c.b], i * 3);
    extra[i * 2] = size[0] + r() * (size[1] - size[0]);
    extra[i * 2 + 1] = r() * 100;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aExtra', new THREE.BufferAttribute(extra, 2));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 400 }, uIntensity: { value: intensity } },
    vertexShader: /* glsl */ `
      attribute vec3 color; attribute vec2 aExtra;
      uniform float uTime; uniform float uScale;
      varying vec3 vColor; varying float vFlicker;
      void main(){
        vec3 p = position;
        float ph = aExtra.y;
        p += vec3(sin(uTime*0.13 + ph)*0.35, cos(uTime*0.11 + ph*1.3)*0.25, 0.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aExtra.x * uScale / -mv.z;
        vColor = color;
        vFlicker = 0.75 + 0.25 * sin(uTime * 0.7 + ph * 3.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uIntensity;
      varying vec3 vColor; varying float vFlicker;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float disc = smoothstep(1.0, 0.92, d);
        float ring = smoothstep(0.62, 0.95, d) * disc;
        float a = disc * (0.45 + 0.55 * ring);
        gl_FragColor = vec4(vColor * a * uIntensity * vFlicker, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

/* ------------------------------------------------------------------ */
/* Floating specks (dust / pollen) that avoid the pointer              */
/* ------------------------------------------------------------------ */

export function makeSpecks({ count = 300, box, color = '#ffd9a0', size = 0.04, seed = 7, intensity = 1.2, rise = 0.05 }) {
  const r = rng(seed);
  const pos = new Float32Array(count * 3);
  const ph = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = box.min.x + r() * (box.max.x - box.min.x);
    pos[i * 3 + 1] = box.min.y + r() * (box.max.y - box.min.y);
    pos[i * 3 + 2] = box.min.z + r() * (box.max.z - box.min.z);
    ph[i] = r();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPointer: { value: new THREE.Vector2(9, 9) },
      uAspect: { value: 1 },
      uScale: { value: 400 },
      uSize: { value: size },
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      uBoxMin: { value: box.min.clone() },
      uBoxSize: { value: box.max.clone().sub(box.min) },
      uRise: { value: rise },
    },
    vertexShader: /* glsl */ `
      attribute float aPh;
      uniform float uTime, uAspect, uScale, uSize, uRise;
      uniform vec2 uPointer; uniform vec3 uBoxMin, uBoxSize;
      varying float vA;
      void main(){
        vec3 p = position;
        float t = uTime;
        p.y = uBoxMin.y + mod(p.y - uBoxMin.y + t * uRise * (0.5 + aPh), uBoxSize.y);
        p.x += sin(t * 0.3 + aPh * 40.0) * 0.15 * uBoxSize.x * 0.05;
        p.z += cos(t * 0.23 + aPh * 30.0) * 0.1 * uBoxSize.z * 0.05;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vec4 cp = projectionMatrix * mv;
        // Push away from the pointer in screen space.
        vec2 ndc = cp.xy / cp.w;
        vec2 d = (ndc - uPointer) * vec2(uAspect, 1.0);
        float l = length(d);
        float push = 0.22 * exp(-l * l * 18.0);
        ndc += normalize(d + 1e-5) / vec2(uAspect, 1.0) * push;
        cp.xy = ndc * cp.w;
        gl_Position = cp;
        gl_PointSize = uSize * uScale / -mv.z;
        float edge = smoothstep(0.0, 0.1, (p.y - uBoxMin.y) / uBoxSize.y) * smoothstep(1.0, 0.9, (p.y - uBoxMin.y) / uBoxSize.y);
        vA = edge * (0.5 + 0.5 * sin(t * 1.3 + aPh * 60.0));
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uIntensity;
      varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = exp(-d * d * 4.0) * vA;
        gl_FragColor = vec4(uColor * a * uIntensity, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

/* ------------------------------------------------------------------ */
/* Water drop: ball-lens refraction of a dawn environment              */
/* ------------------------------------------------------------------ */

export const DAWN_ENV = /* glsl */ `
uniform vec3 uSunDir;
vec3 env(vec3 d){
  d = normalize(d);
  float h = d.y;
  vec3 sky = mix(${glc('#f4a67c')}, ${glc('#3f639c')}, smoothstep(-0.02, 0.65, h));
  sky = mix(sky, ${glc('#1d2d52')}, smoothstep(0.6, 1.0, h));
  float sd = max(dot(d, uSunDir), 0.0);
  sky += ${glc('#ffc98f')} * pow(sd, 6.0) * 0.9;
  sky += ${glc('#fff1d6')} * (pow(sd, 300.0) * 6.0 + smoothstep(0.9990, 0.9996, sd) * 40.0);
  float az = atan(d.x, d.z);
  float sil = 0.04 + 0.05 * (0.5 + 0.5 * sin(az * 5.0 + 1.0)) + 0.03 * snoise(vec3(az * 3.0, 0.5, 2.0));
  float ground = smoothstep(sil + 0.01, sil - 0.01, h);
  vec3 g = mix(${glc('#2b4a20')}, ${glc('#0c170a')}, smoothstep(0.0, -0.6, h));
  return mix(sky, g, ground);
}
`;

export function makeDropMaterial({ sunDir, keyDir }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: sunDir.clone() },
      uKeyDir: { value: keyDir.clone() },
      uRippleT: { value: -100 },
      uRipple: { value: 0 },
      uWobble: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime, uRippleT, uRipple, uWobble;
      varying vec3 vObj; varying vec3 vCamObj; varying float vRip;
      ${NOISE}
      void main(){
        vec3 p = position;
        float sag = smoothstep(0.2, -1.0, p.y);
        p.xz *= 1.0 + 0.1 * sag;
        p.y *= 0.88;
        p.y = max(p.y, -0.8);
        float n = snoise(position * 1.6 + uTime * 0.35) * 0.012 * uWobble;
        float ang = acos(clamp(normalize(position).y, -1.0, 1.0));
        float age = uTime - uRippleT;
        float rip = sin(ang * 14.0 - age * 16.0) * exp(-age * 2.2) * step(0.0, age) * uRipple;
        vRip = rip;
        p += normal * (n + rip * 0.025);
        vObj = position;
        float sc = length(modelMatrix[0].xyz);
        vCamObj = (cameraPosition - modelMatrix[3].xyz) / sc;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uKeyDir;
      varying vec3 vObj; varying vec3 vCamObj; varying float vRip;
      ${NOISE}
      ${DAWN_ENV}
      void main(){
        vec3 P = normalize(vObj);
        vec3 N = normalize(P + vRip * 0.12 * vec3(P.x, 0.0, P.z));
        vec3 V = normalize(vCamObj - vObj);
        float cosT = clamp(dot(N, V), 0.0, 1.0);
        float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
        vec3 d = refract(-V, N, 1.0 / 1.333);
        float tt = -2.0 * dot(P, d);
        vec3 Q = normalize(P + d * tt);
        vec3 d2 = refract(d, -Q, 1.333);
        if (dot(d2, d2) < 1e-4) d2 = reflect(d, -Q);
        vec3 refr = env(d2) * ${glc('#eef8ff')};
        vec3 refl = env(reflect(-V, N));
        vec3 col = mix(refr, refl, F);
        col *= mix(0.25, 1.0, smoothstep(0.02, 0.5, cosT));
        vec3 H = normalize(uKeyDir + V);
        float nh = max(dot(N, H), 0.0);
        col += ${glc('#fff4e2')} * (pow(nh, 1200.0) * 70.0 + pow(nh, 90.0) * 0.5);
        float back = max(dot(-V, uSunDir), 0.0);
        col += ${glc('#ffb07a')} * pow(1.0 - cosT, 4.0) * (0.25 + 0.9 * back);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

/* ------------------------------------------------------------------ */
/* Blade of grass (macro scale)                                        */
/* ------------------------------------------------------------------ */

/** Local frame of a blade: s in 0..1 along its length. */
export function bladeCenter(opts, s, out = new THREE.Vector3()) {
  const { length, bend = 0.2, sway = 0 } = opts;
  return out.set(sway * s * s * length, s * length, -bend * s * s * length);
}

export function makeBladeGeometry(opts) {
  const { length, width, segs = 40, fold = 0.25 } = opts;
  const pos = [];
  const uv = [];
  const idx = [];
  const c = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const s = i / segs;
    bladeCenter(opts, s, c);
    const w = width * (0.75 + 0.25 * Math.sin(Math.min(s * 3, 1) * Math.PI * 0.5)) * (1 - Math.pow(Math.max(0, (s - 0.45) / 0.55), 1.6));
    for (let k = 0; k <= 4; k++) {
      const u = k / 4;
      const x = (u - 0.5) * w;
      const zf = (1 - Math.abs(u - 0.5) * 2) * fold * w;
      pos.push(c.x + x, c.y, c.z + zf);
      uv.push(u, s);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let k = 0; k < 4; k++) {
      const a = i * 5 + k, b = a + 1, d = a + 5, e = d + 1;
      idx.push(a, b, d, b, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function makeBladeMaterial({ sunDir, base = '#244a1f', tip = '#7fb04e', soft = 0, fog = 0, fogColor = '#9fbf7a', opacity = 1 }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: sunDir.clone() },
      uBase: { value: new THREE.Color(base) },
      uTip: { value: new THREE.Color(tip) },
      uSoft: { value: soft },
      uFog: { value: fog },
      uFogColor: { value: new THREE.Color(fogColor) },
      uOpacity: { value: opacity },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vW; varying vec2 vUv;
      void main(){
        vUv = uv;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun, uBase, uTip, uFogColor;
      uniform float uSoft, uFog, uOpacity;
      varying vec3 vN; varying vec3 vW; varying vec2 vUv;
      void main(){
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        if (dot(N, V) < 0.0) N = -N;
        float u = vUv.x, s = vUv.y;
        vec3 base = mix(uBase, uTip, smoothstep(0.0, 1.0, s));
        float veins = pow(0.5 + 0.5 * cos(u * 6.2832 * 7.0), 6.0);
        base *= 0.9 + 0.18 * veins;
        float mid = exp(-pow((u - 0.5) * 12.0, 2.0));
        base = mix(base, base * 1.3 + vec3(0.02, 0.03, 0.0), mid * 0.5);
        float diff = max(dot(N, uSun), 0.0) * 0.75 + 0.3;
        float trans = pow(max(dot(-V, uSun), 0.0), 2.0);
        vec3 col = base * diff + uTip * trans * 0.9;
        vec3 H = normalize(uSun + V);
        col += vec3(1.0, 0.95, 0.8) * pow(max(dot(N, H), 0.0), 60.0) * 0.35 * (1.0 - uSoft);
        col = mix(col, uFogColor, uFog);
        float edge = min(u, 1.0 - u) * 2.0;
        float a = uOpacity * mix(1.0, smoothstep(0.0, 0.9, edge) * smoothstep(1.0, 0.85, s), uSoft);
        gl_FragColor = vec4(col * a, a);
      }`,
    side: THREE.DoubleSide,
    transparent: soft > 0 || opacity < 1,
    depthWrite: soft === 0,
    blending: soft > 0 || opacity < 1 ? THREE.CustomBlending : THREE.NormalBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}

/* ------------------------------------------------------------------ */
/* Sky dome                                                            */
/* ------------------------------------------------------------------ */

export function makeSky({ radius = 500, sunDir, horizon, zenith, sunGlow = '#ffd9a0', clouds = 0.5, ground = '#3a4a30' }) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSun: { value: sunDir.clone() },
      uHorizon: { value: new THREE.Color(horizon) },
      uZenith: { value: new THREE.Color(zenith) },
      uGlow: { value: new THREE.Color(sunGlow) },
      uGround: { value: new THREE.Color(ground) },
      uClouds: { value: clouds },
      uSunSize: { value: 1 },
      uStars: { value: 0 },
      uWhite: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uClouds, uSunSize, uStars, uWhite;
      uniform vec3 uSun, uHorizon, uZenith, uGlow, uGround;
      varying vec3 vDir;
      ${NOISE}
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.9, h), 0.6));
        float sd = max(dot(d, uSun), 0.0);
        col += uGlow * (pow(sd, 8.0) * 0.6 + pow(sd, 64.0) * 0.8);
        col += uGlow * 1.5 * (pow(sd, 2000.0 / uSunSize) * 8.0 + smoothstep(1.0 - 0.00012 * uSunSize, 1.0 - 0.00006 * uSunSize, sd) * 30.0);
        if (uClouds > 0.0 && h > 0.0) {
          vec2 cp = d.xz / (h + 0.15) * 1.4 + vec2(uTime * 0.004, 0.0);
          float c = fbm3lo(vec3(cp, uTime * 0.01));
          c = smoothstep(0.05, 0.55, c) * smoothstep(0.0, 0.25, h);
          vec3 cc = mix(vec3(1.0, 0.98, 0.95), uGlow * 1.2, pow(sd, 4.0));
          col = mix(col, cc, c * uClouds);
        }
        if (uStars > 0.0) {
          vec3 q = d * 300.0;
          vec3 cell = floor(q);
          float r = hash12(cell.xy + cell.z * 17.0);
          float star = step(0.985, r) * smoothstep(0.5, 0.05, length(fract(q) - 0.5));
          col += vec3(star) * uStars * (0.6 + 0.4 * sin(uTime * 2.0 + r * 60.0));
        }
        col = mix(col, uGround, smoothstep(0.0, -0.05, h));
        col = mix(col, vec3(1.3), uWhite);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -50;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* Star glint sprite (4-ray)                                           */
/* ------------------------------------------------------------------ */

export function makeGlint(color = '#fff2dc', intensity = 3) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uI: { value: intensity }, uRot: { value: 0.3 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){
        vUv = uv - 0.5;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float s = length(modelMatrix[0].xyz);
        mv.xy += position.xy * s;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uI; uniform float uRot;
      varying vec2 vUv;
      void main(){
        float c = cos(uRot), s = sin(uRot);
        vec2 p = mat2(c, -s, s, c) * vUv;
        float r = length(p);
        float core = exp(-r * 40.0) * 3.0 + exp(-r * 9.0) * 0.4;
        float rays = exp(-abs(p.x) * 160.0) * exp(-abs(p.y) * 5.0) + exp(-abs(p.y) * 160.0) * exp(-abs(p.x) * 5.0);
        vec2 q = mat2(0.7071, -0.7071, 0.7071, 0.7071) * p;
        rays += 0.35 * (exp(-abs(q.x) * 200.0) * exp(-abs(q.y) * 10.0) + exp(-abs(q.y) * 200.0) * exp(-abs(q.x) * 10.0));
        float a = (core + rays) * smoothstep(0.5, 0.3, r);
        gl_FragColor = vec4(uColor * a * uI, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.frustumCulled = false;
  m.renderOrder = 20;
  return m;
}
