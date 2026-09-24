import * as THREE from 'three';
import Lenis from 'lenis';
import { ChapterPass, GradeShader } from './post.js';
import { UI, CHAPTERS } from './ui.js';
import { Sound } from './audio.js';
import { damp, smoothstep, clamp, nextFrame, easeInOut } from './util.js';
import { DropChapter } from './chapters/drop.js';

// Scenes that are implemented so far, in order.
const SCENES = [DropChapter];
const TRANSITIONS = [0, 0, 0, 1, 2]; // 0 blur, 1 white-out (clouds), 2 darken
const TW = 0.028; // half-width of a transition in scroll progress

const canvas = document.getElementById('gl');
const low = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function fail() {
  document.getElementById('fallback').hidden = false;
  document.getElementById('preloader').classList.add('done');
}

async function start() {
  document.body.classList.add('loading');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 required');
  } catch (e) {
    console.error(e);
    fail();
    return;
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.72;
  renderer.setClearColor(0x000000, 1);

  const app = {
    renderer,
    low,
    reduced,
    width: innerWidth,
    height: innerHeight,
    aspect: innerWidth / innerHeight,
    audio: new Sound(),
  };

  const ui = new UI({
    onGoto: (p) => lenis.scrollTo(p * maxScroll(), { duration: reduced ? 0 : 2.6, easing: easeInOut }),
    onRewind: () => {
      app.audio.whoosh?.(4);
      lenis.scrollTo(0, { duration: reduced ? 0 : 4, easing: easeInOut });
    },
    onSound: (on) => app.audio.enable(on),
  });

  // Build scenes with a progress indicator.
  const chapters = [];
  for (let i = 0; i < SCENES.length; i++) {
    chapters.push(new SCENES[i](app));
    ui.progress((i + 0.5) / (SCENES.length + 1));
    await nextFrame();
  }

  const composer = new THREE.EffectComposer(renderer);
  const pass = new ChapterPass({ samples: low ? 0 : 4, taps: low ? 12 : 24 });
  const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 0.92);
  const output = new THREE.OutputPass();
  const grade = new THREE.ShaderPass(GradeShader);
  composer.addPass(pass);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(grade);

  function resize() {
    const w = innerWidth, h = innerHeight;
    const dpr = Math.min(devicePixelRatio, low ? 1.25 : 1.6);
    app.width = w;
    app.height = h;
    app.aspect = w / h;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    pass.setSize(Math.round(w * dpr), Math.round(h * dpr));
    bloom.resolution.set(Math.round(w * dpr / 2), Math.round(h * dpr / 2));
    grade.uniforms.uRes.value.set(w * dpr, h * dpr);
    chapters.forEach((c) => c.resize(app.aspect));
  }
  resize();
  addEventListener('resize', resize);

  // Warm up shaders.
  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i];
    c.update(0, 0, 0.016, { x: 0, y: 0, sx: 0, sy: 0 });
    renderer.compile(c.scene, c.camera);
    pass.a = c;
    pass.b = null;
    composer.render(0.016);
    ui.progress((SCENES.length + (i + 1) / chapters.length) / (SCENES.length + 1));
    await nextFrame();
  }

  const lenis = new Lenis({ lerp: reduced ? 1 : 0.07, smoothWheel: !reduced, wheelMultiplier: 0.8 });
  const maxScroll = () => Math.max(1, document.documentElement.scrollHeight - innerHeight);

  // Pointer.
  const input = { x: 0, y: 0, sx: 0, sy: 0, speed: 0, down: false, dragDX: 0, has: false };
  let lastX = 0;
  addEventListener('pointermove', (e) => {
    const nx = (e.clientX / innerWidth) * 2 - 1;
    const ny = -((e.clientY / innerHeight) * 2 - 1);
    input.speed += Math.hypot(nx - input.x, ny - input.y);
    if (input.down) input.dragDX += e.clientX - lastX;
    lastX = e.clientX;
    input.x = nx;
    input.y = ny;
    input.has = true;
  }, { passive: true });
  addEventListener('pointerdown', (e) => { input.down = true; lastX = e.clientX; });
  addEventListener('pointerup', () => { input.down = false; });
  addEventListener('click', (e) => {
    if (e.target.closest('button, a')) return;
    input.x = (e.clientX / innerWidth) * 2 - 1;
    input.y = -((e.clientY / innerHeight) * 2 - 1);
    const target = pass.b && pass.mix > 0.5 ? pass.b : pass.a;
    target?.click(input);
  });

  const clock = new THREE.Clock();
  let time = 0;
  let fade = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    lenis.raf(now);
    const dt = Math.min(clock.getDelta(), 0.1);
    time += dt;

    input.sx = damp(input.sx, input.x, 3, dt);
    input.sy = damp(input.sy, input.y, 3, dt);
    input.speed = damp(input.speed, 0, 4, dt);

    const p = clamp(lenis.scroll / maxScroll());
    const n = chapters.length;

    // Which scenes are on screen and how they blend.
    let a = 0, b = -1, mix = 0, kind = 0;
    for (let i = 0; i < n; i++) if (p >= CHAPTERS[i].start) a = i;
    const end = CHAPTERS[a].end;
    if (a + 1 < n && p > end - TW) {
      b = a + 1;
      mix = smoothstep(end - TW, end + TW, p);
      kind = TRANSITIONS[a];
    } else if (a > 0 && p < CHAPTERS[a].start + TW) {
      b = a;
      a = a - 1;
      mix = smoothstep(CHAPTERS[b].start - TW, CHAPTERS[b].start + TW, p);
      kind = TRANSITIONS[a];
    }
    const local = (i) => {
      if (reduced) return chapters[i].reducedT;
      const c = CHAPTERS[i];
      const last = i === n - 1;
      const t = (p - c.start) / (c.end - c.start);
      return last ? Math.min(t, 1.4) : t;
    };

    chapters[a].update(local(a), time, dt, input);
    if (b >= 0) chapters[b].update(local(b), time, dt, input);
    input.dragDX = 0;

    pass.a = chapters[a];
    pass.b = b >= 0 ? chapters[b] : null;
    pass.mix = b >= 0 ? mix : 0;
    pass.kind = kind;
    bloom.strength = b >= 0 ? chapters[a].bloom * (1 - mix) + chapters[b].bloom * mix : chapters[a].bloom;

    fade = damp(fade, 1, 1.2, dt);
    grade.uniforms.uTime.value = time;
    grade.uniforms.uFade.value = fade;
    composer.render(dt);

    ui.update(p);
    app.audio.update?.(p, time);
  }

  ui.progress(1);
  await nextFrame();
  ui.ready();
  requestAnimationFrame(frame);
}

start();
