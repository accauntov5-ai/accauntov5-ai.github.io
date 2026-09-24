import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three';

/**
 * Renders up to two chapters and blends them with a transition
 * (cross-blur, white-out through clouds) plus screen-space depth of field.
 */
export class ChapterPass extends Pass {
  constructor({ samples = 4, taps = 24 } = {}) {
    super();
    const opts = { type: THREE.HalfFloatType, samples };
    this.rtA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, opts);
    this.a = null;
    this.b = null;
    this.mix = 0;
    this.kind = 0;
    this.material = new THREE.ShaderMaterial({
      defines: { TAPS: taps },
      uniforms: {
        tA: { value: this.rtA.texture },
        tB: { value: this.rtB.texture },
        uMix: { value: 0 },
        uKind: { value: 0 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uScale: { value: 1 },
        uFocusA: { value: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) },
        uFocusB: { value: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) },
        uFocusRA: { value: new THREE.Vector2(0.3, 0) },
        uFocusRB: { value: new THREE.Vector2(0.3, 0) },
        uHasB: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tA, tB;
        uniform float uMix, uKind, uScale, uHasB;
        uniform vec2 uRes;
        uniform vec4 uFocusA, uFocusB;
        uniform vec2 uFocusRA, uFocusRB;
        varying vec2 vUv;

        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

        float segDist(vec2 p, vec2 a, vec2 b){
          vec2 pa = p - a, ba = b - a;
          float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
          return length(pa - ba * h);
        }

        float focusBlur(vec4 seg, vec2 rs){
          float asp = uRes.x / uRes.y;
          vec2 p = vUv * vec2(asp, 1.0);
          float d = segDist(p, seg.xy * vec2(asp, 1.0), seg.zw * vec2(asp, 1.0));
          return smoothstep(rs.x, rs.x + 0.35, d) * rs.y;
        }

        vec3 blurTex(sampler2D t, vec2 uv, float radPx){
          if (radPx < 0.6) return texture2D(t, uv).rgb;
          vec3 acc = vec3(0.0); float wsum = 0.0;
          float rot = hash(gl_FragCoord.xy) * 6.2831;
          for (int i = 0; i < TAPS; i++){
            float fi = float(i) + 0.5;
            float r = sqrt(fi / float(TAPS)) * radPx;
            float a = fi * 2.39996 + rot;
            vec3 c = texture2D(t, uv + vec2(cos(a), sin(a)) * r / uRes).rgb;
            float w = 1.0 + dot(c, vec3(0.3, 0.59, 0.11)) * 1.5;
            acc += c * w; wsum += w;
          }
          return acc / wsum;
        }

        void main(){
          float bump = sin(3.14159 * uMix);
          float tb = bump * 26.0 * (uKind > 0.5 ? 0.6 : 1.0);
          float ra = (focusBlur(uFocusA, uFocusRA) + tb) * uScale;
          vec3 col = blurTex(tA, vUv, ra);
          if (uHasB > 0.5) {
            float rb = (focusBlur(uFocusB, uFocusRB) + tb) * uScale;
            vec3 b = blurTex(tB, vUv, rb);
            col = mix(col, b, uMix);
          }
          if (uKind > 0.5 && uKind < 1.5) {
            // Flying through clouds: white-out.
            float w = pow(bump, 0.7);
            vec3 cloud = vec3(1.25, 1.24, 1.2) * (0.95 + 0.05 * hash(floor(vUv * 40.0)));
            col = mix(col, cloud, w);
          } else if (uKind > 1.5) {
            col *= 1.0 - bump * 0.6;
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  setSize(w, h) {
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    this.material.uniforms.uRes.value.set(w, h);
    this.material.uniforms.uScale.value = h / 1080;
  }

  _focus(ch, seg, rs) {
    const f = ch.focus;
    seg.set(f.a.x, f.a.y, f.b.x, f.b.y);
    rs.set(f.r, f.s);
  }

  render(renderer, writeBuffer) {
    const u = this.material.uniforms;
    renderer.setRenderTarget(this.rtA);
    renderer.clear();
    renderer.render(this.a.scene, this.a.camera);
    this._focus(this.a, u.uFocusA.value, u.uFocusRA.value);
    u.uHasB.value = 0;
    if (this.b && this.mix > 0.001) {
      renderer.setRenderTarget(this.rtB);
      renderer.clear();
      renderer.render(this.b.scene, this.b.camera);
      this._focus(this.b, u.uFocusB.value, u.uFocusRB.value);
      u.uHasB.value = 1;
    }
    u.uMix.value = u.uHasB.value ? this.mix : 0;
    u.uKind.value = this.kind;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.rtA.dispose();
    this.rtB.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}

/** Final film look: chromatic aberration, vignette, grain, fade-in. */
export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uFade: { value: 0 },
    uCA: { value: 1 },
    uGrain: { value: 0.06 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uFade, uCA, uGrain;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * 0.012 * uCA;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv - off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv + off).b;
      float vig = smoothstep(0.95, 0.2, length(c * vec2(uRes.x / uRes.y, 1.0) * 0.85));
      col *= mix(0.55, 1.0, vig);
      float g = hash(vUv * uRes + fract(uTime * 13.37) * 100.0) - 0.5;
      col += g * uGrain * (0.6 + 0.4 * (1.0 - dot(col, vec3(0.33))));
      col *= uFade;
      gl_FragColor = vec4(col, 1.0);
    }`,
};
