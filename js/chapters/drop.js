import * as THREE from 'three';
import { Chapter, makeBackdrop, makeBokeh, makeSpecks, makeDropMaterial, makeGlint } from './shared.js';
import { NOISE } from '../glsl.js';
import { glc, pathAt, rng } from '../util.js';

/** I · Капля — 1 мм. Units: millimetres. */
export class DropChapter extends Chapter {
  constructor(app) {
    super(app, { fov: 26, near: 0.05, far: 200 });
    this.bloom = 0.55;
    this.reducedT = 0.1;
    const sun = new THREE.Vector3(-0.45, 0.2, -1).normalize();
    this.sun = sun;
    this.keyBase = new THREE.Vector3(-0.35, 0.75, 0.6).normalize();
    this.key = this.keyBase.clone();

    // Backdrop: dawn behind the blade, strongly defocused.
    this.backdrop = makeBackdrop(/* glsl */ `
      vec2 p = uv;
      vec3 top = ${glc('#0f1d33')};
      vec3 mid = ${glc('#2d4568')};
      vec3 hor = ${glc('#e48f63')};
      vec3 low = ${glc('#16290f')};
      col = mix(low, hor, smoothstep(0.18, 0.52, p.y));
      col = mix(col, mid, smoothstep(0.5, 0.75, p.y));
      col = mix(col, top, smoothstep(0.75, 1.1, p.y));
      vec2 sp = vec2(0.24, 0.6);
      float sd = length((p - sp) * vec2(uAspect, 1.0));
      col += ${glc('#ffb27a')} * exp(-sd * 3.2) * 0.9;
      col += ${glc('#fff0d0')} * exp(-sd * 14.0) * 1.6;
      float blob = fbm3lo(vec3(p * vec2(uAspect, 1.0) * 2.2, uTime * 0.02));
      col *= 0.85 + 0.3 * blob;
      float leaf = smoothstep(0.1, 0.35, fbm3lo(vec3(p * vec2(uAspect, 1.0) * 1.3 + 4.0, uTime * 0.015)));
      col = mix(col, ${glc('#0d1a0c')}, leaf * smoothstep(0.55, 0.2, p.y) * 0.8);
    `);
    this.scene.add(this.backdrop);

    // Background bokeh — distant dew catching the sun.
    this.bokeh = makeBokeh({
      count: app.low ? 40 : 70,
      box: new THREE.Box3(new THREE.Vector3(-16, -3, -30), new THREE.Vector3(16, 12, -6)),
      colors: ['#ffcf8a', '#ffb089', '#ffe3b8', '#7fb0e6', '#9fd0c8', '#f59a6a'],
      size: [0.8, 3.2],
      intensity: 0.55,
    });
    this.scene.add(this.bokeh);

    // The blade the drop rests on.
    this.blade = new THREE.Mesh(
      new THREE.PlaneGeometry(7.5, 60, 1, 1).rotateX(-Math.PI / 2).translate(0, 0, -24),
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uSun: { value: sun } },
        vertexShader: /* glsl */ `
          varying vec3 vW; varying vec2 vUv;
          void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform vec3 uSun;
          varying vec3 vW; varying vec2 vUv;
          ${NOISE}
          void main(){
            float u = vUv.x;
            vec3 col = mix(${glc('#1f3f1b')}, ${glc('#4f8434')}, smoothstep(0.0, 0.5, u) * smoothstep(1.0, 0.5, u) * 1.4);
            float veins = pow(0.5 + 0.5 * cos(u * 6.2832 * 11.0), 8.0);
            col *= 0.86 + 0.25 * veins;
            col *= 0.85 + 0.3 * snoise(vec3(vW.x * 0.4, vW.z * 0.08, 1.0));
            // warm backlight through the leaf
            col += ${glc('#b6d25a')} * 0.18 * smoothstep(-2.0, -20.0, vW.z);
            // contact shadow and caustic focused by the drop
            vec2 q = vW.xz - vec2(0.12, 0.55);
            float sh = exp(-dot(q * vec2(1.2, 0.75), q * vec2(1.2, 0.75)) * 1.6);
            col *= 1.0 - 0.55 * sh;
            vec2 k = vW.xz - vec2(0.18, 0.95);
            float caustic = exp(-dot(k * vec2(3.4, 2.2), k * vec2(3.4, 2.2)));
            col += ${glc('#ffe2a8')} * caustic * 2.2;
            // micro droplets
            vec2 g = vW.xz * vec2(3.0, 1.2);
            vec2 id = floor(g);
            float r = hash12(id);
            float dotm = step(0.93, r) * smoothstep(0.25, 0.05, length(fract(g) - 0.5));
            col += ${glc('#fff3dc')} * dotm * 1.5;
            float edge = smoothstep(0.0, 0.14, u) * smoothstep(1.0, 0.86, u);
            gl_FragColor = vec4(col * edge, edge);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      })
    );
    this.blade.renderOrder = -10;
    this.scene.add(this.blade);

    // Main drop + a few smaller neighbours further along the blade.
    const geo = new THREE.SphereGeometry(1, app.low ? 72 : 128, app.low ? 48 : 96);
    this.drop = new THREE.Mesh(geo, makeDropMaterial({ sunDir: sun, keyDir: this.key }));
    this.drop.position.set(0, 0.8, 0);
    this.scene.add(this.drop);

    this.drops = [this.drop];
    const r = rng(11);
    const spots = [[-1.9, -3.5, 0.45], [1.7, -6, 0.6], [-1.2, -11, 0.7], [2.2, -15, 0.5], [0.4, -20, 0.8], [2.4, 1.6, 0.22]];
    for (const [x, z, s] of spots) {
      const m = new THREE.Mesh(geo, makeDropMaterial({ sunDir: sun, keyDir: this.key }));
      m.scale.setScalar(s);
      m.position.set(x, 0.8 * s, z);
      m.material.uniforms.uWobble.value = 0.5 + r();
      this.scene.add(m);
      this.drops.push(m);
    }

    // Star highlight on the drop.
    this.glint = makeGlint('#fff3df', 2.2);
    this.scene.add(this.glint);

    // Dust in the light.
    this.dust = makeSpecks({
      count: app.low ? 120 : 260,
      box: new THREE.Box3(new THREE.Vector3(-5, -0.5, -8), new THREE.Vector3(5, 5, 3)),
      color: '#ffd7a0',
      size: 0.05,
      intensity: 1.4,
      rise: 0.04,
    });
    this.scene.add(this.dust);

    this.camPath = [
      [0.0, new THREE.Vector3(0.0, 1.0, 4.4)],
      [0.55, new THREE.Vector3(0.25, 1.5, 6.4)],
      [1.0, new THREE.Vector3(0.4, 3.0, 11.0)],
      [1.4, new THREE.Vector3(0.5, 5.0, 16.0)],
    ];
    this.lookPath = [
      [0.0, new THREE.Vector3(0.0, 0.78, 0)],
      [1.0, new THREE.Vector3(0.0, 0.5, -2.5)],
      [1.4, new THREE.Vector3(0.0, 0.2, -5)],
    ];
    this.nextRipple = 4;
    this._look = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
  }

  update(t, time, dt, input) {
    this.time = time;
    const cam = this.camera;
    pathAt(this.camPath, t, cam.position);
    pathAt(this.lookPath, t, this._look);
    // hand-held sway + pointer parallax
    cam.position.x += input.sx * 0.35 + Math.sin(time * 0.7) * 0.03;
    cam.position.y += input.sy * 0.18 + Math.sin(time * 0.9 + 1.0) * 0.02;
    cam.lookAt(this._look);

    // Key light follows the pointer, so the highlight glides across the drop.
    this.key.copy(this.keyBase);
    this.key.x += input.sx * 0.5;
    this.key.y += input.sy * 0.3;
    this.key.normalize();

    for (const d of this.drops) {
      const u = d.material.uniforms;
      u.uTime.value = time;
      u.uKeyDir.value.copy(this.key);
    }
    if (time > this.nextRipple) {
      this.ripple(time, 0.25);
      this.nextRipple = time + 7 + Math.random() * 3;
    }
    const ru = this.drop.material.uniforms;
    ru.uRipple.value *= Math.exp(-dt * 0.35);

    // Glint position = where the half-vector meets the sphere.
    const V = this._tmp.copy(cam.position).sub(this.drop.position).normalize();
    const H = V.add(this.key).normalize();
    this.glint.position.copy(this.drop.position).addScaledVector(H, 0.93);
    this.glint.position.y -= H.y * 0.1;
    this.glint.scale.setScalar(0.9 + 0.1 * Math.sin(time * 2.0));
    this.glint.material.uniforms.uRot.value = 0.25 + input.sx * 0.2;

    this.backdrop.material.uniforms.uTime.value = time;
    this.backdrop.material.uniforms.uAspect.value = this.app.aspect;
    this.backdrop.material.uniforms.uOffset.value.set(input.sx * 0.015, input.sy * 0.01 - Math.max(0, t) * 0.06);
    this.blade.material.uniforms.uTime.value = time;
    this.bokeh.material.uniforms.uTime.value = time;
    this.bokeh.material.uniforms.uScale.value = this.app.height * 0.9;
    const du = this.dust.material.uniforms;
    du.uTime.value = time;
    du.uScale.value = this.app.height * 0.9;
    du.uAspect.value = this.app.aspect;
    du.uPointer.value.set(input.x, input.y);

    // Focus on the drop.
    const c = this.toScreen(this.drop.position, this.focus.a);
    this.focus.b.copy(c);
    const top = this.toScreen(this._tmp.copy(this.drop.position).setY(this.drop.position.y + 1), new THREE.Vector2());
    this.focus.r = Math.abs(top.y - c.y) * 1.5 + 0.02;
    this.focus.s = 20 - Math.min(Math.max(t, 0), 1) * 6;
  }

  ripple(time, amount) {
    const u = this.drop.material.uniforms;
    u.uRippleT.value = time;
    u.uRipple.value = amount;
  }

  click(input) {
    if (this.pointerDist(this.drop.position, input) < this.app.height * 0.22) {
      this.ripple(this.time, 1);
      this.app.audio?.drip(1);
    }
  }
}
