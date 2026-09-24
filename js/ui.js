import { keyframes, smoothstep, clamp } from './util.js';

// Scroll ranges of the six scenes (global progress 0..1).
export const CHAPTERS = [
  { start: 0.0, end: 0.12, num: 'I', name: 'Капля', go: 0 },
  { start: 0.12, end: 0.28, num: 'II', name: 'Травинка', go: 0.2 },
  { start: 0.28, end: 0.45, num: 'III', name: 'Луг', go: 0.365 },
  { start: 0.45, end: 0.62, num: 'IV', name: 'Лес и река', go: 0.535 },
  { start: 0.62, end: 0.8, num: 'V', name: 'Горы', go: 0.71 },
  { start: 0.8, end: 1.0, num: 'VI', name: 'Планета', go: 0.975 },
];

// Progress -> log10(metres) on screen.
const SCALE_KEYS = [
  [0.0, -3.0], [0.07, -2.9], [0.12, -2.2], [0.2, -1.0], [0.28, 0.0], [0.365, 1.0],
  [0.45, 2.0], [0.535, 3.0], [0.62, 4.0], [0.71, 5.0], [0.8, 6.0], [0.9, 7.0], [0.95, 7.1052], [1.0, 7.1052],
];

// Caption visibility windows: [fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd].
const CAPTIONS = {
  hero: [-1, -0.5, 0.012, 0.045],
  0: [0.05, 0.065, 0.1, 0.115],
  1: [0.15, 0.165, 0.245, 0.265],
  2: [0.31, 0.325, 0.41, 0.43],
  3: [0.48, 0.495, 0.585, 0.605],
  4: [0.65, 0.665, 0.765, 0.785],
  5: [0.83, 0.845, 0.9, 0.915],
  final: [0.935, 0.96, 2, 3],
};

const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sup = (n) => String(n).split('').map((c) => SUP[c] ?? c).join('');

const fmt = (x, digits) => x.toFixed(digits).replace('.', ',');
const group = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export function scaleAt(p) {
  return keyframes(SCALE_KEYS, p);
}

export function formatScale(L) {
  const m = Math.pow(10, L);
  if (m < 0.01) return `${fmt(m * 1000, 1)} мм`;
  if (m < 1) { const cm = m * 100; return `${fmt(cm, cm < 10 ? 1 : 0)} см`; }
  if (m < 1000) return `${m < 10 ? fmt(m, 1) : group(m)} м`;
  const km = m / 1000;
  return `${km < 10 ? fmt(km, 1) : group(km)} км`;
}

export function chapterAt(p) {
  for (let i = CHAPTERS.length - 1; i >= 0; i--) if (p >= CHAPTERS[i].start) return i;
  return 0;
}

export class UI {
  constructor({ onGoto, onRewind, onSound }) {
    this.el = {
      value: document.getElementById('scaleValue'),
      exp: document.getElementById('scaleExp'),
      ticks: document.getElementById('rulerTicks'),
      cursor: document.getElementById('rulerCursor'),
      name: document.getElementById('chapterName'),
      dots: [...document.querySelectorAll('#dots button')],
      caps: [...document.querySelectorAll('.cap')],
      preFill: document.getElementById('preFill'),
      preNum: document.getElementById('preNum'),
      preloader: document.getElementById('preloader'),
      sound: document.getElementById('sound'),
    };
    this.minL = -3;
    this.maxL = 7.2;
    // Ruler ticks, one per order of magnitude.
    for (let l = -3; l <= 7; l++) {
      const i = document.createElement('i');
      i.style.left = `${((l - this.minL) / (this.maxL - this.minL)) * 100}%`;
      if (l % 2 === 1 || l === -3) {
        i.className = 'major';
        i.dataset.l = { '-3': '1 мм', '-1': '10 см', 1: '10 м', 3: '1 км', 5: '100 км', 7: '10⁴ км' }[l] ?? '';
      }
      this.el.ticks.appendChild(i);
    }
    this.chapter = -1;
    this.lastValue = '';

    document.querySelectorAll('[data-goto]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        onGoto(CHAPTERS[+b.dataset.goto].go);
      });
    });
    document.getElementById('rewind').addEventListener('click', onRewind);
    this.el.sound.addEventListener('click', () => {
      const on = this.el.sound.getAttribute('aria-pressed') !== 'true';
      this.el.sound.setAttribute('aria-pressed', String(on));
      this.el.sound.setAttribute('aria-label', on ? 'Выключить звук' : 'Включить звук');
      onSound(on);
    });
  }

  progress(f) {
    const pct = Math.round(clamp(f) * 100);
    this.el.preNum.textContent = pct;
    this.el.preFill.style.strokeDashoffset = String(289 * (1 - clamp(f)));
  }

  ready() {
    this.el.preloader.classList.add('done');
    document.body.classList.remove('loading');
    document.body.classList.add('ready');
  }

  update(p) {
    const L = scaleAt(p);
    const v = formatScale(L);
    if (v !== this.lastValue) {
      this.el.value.textContent = v;
      this.el.exp.textContent = `10${sup(Math.round(L))} м`;
      this.lastValue = v;
    }
    this.el.cursor.style.left = `${clamp((L - this.minL) / (this.maxL - this.minL)) * 100}%`;

    const c = chapterAt(p);
    if (c !== this.chapter) {
      const first = this.chapter === -1;
      this.chapter = c;
      this.el.dots.forEach((d, i) => d.classList.toggle('active', i === c));
      const set = () => {
        this.el.name.querySelector('.num').textContent = CHAPTERS[c].num;
        this.el.name.querySelector('.name').textContent = CHAPTERS[c].name;
        this.el.name.classList.remove('swap');
      };
      if (first) set();
      else {
        this.el.name.classList.add('swap');
        clearTimeout(this._swap);
        this._swap = setTimeout(set, 350);
      }
    }

    for (const cap of this.el.caps) {
      const [a, b, c2, d] = CAPTIONS[cap.dataset.cap];
      const o = smoothstep(a, b, p) * (1 - smoothstep(c2, d, p));
      const shift = (1 - smoothstep(a, b, p)) * 24 - smoothstep(c2, d, p) * 24;
      if (o <= 0.001) {
        if (cap.style.visibility !== 'hidden') cap.style.visibility = 'hidden';
        continue;
      }
      cap.style.visibility = 'visible';
      cap.style.opacity = o.toFixed(3);
      const base = cap.classList.contains('cap-final') ? 'translateY(-50%) ' : '';
      cap.style.transform = `${base}translateY(${shift.toFixed(1)}px)`;
      cap.style.filter = o < 0.98 ? `blur(${((1 - o) * 8).toFixed(1)}px)` : 'none';
    }
  }
}
