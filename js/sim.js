/* 가상 담배 시뮬레이터 — 캔버스에 전부 절차적으로 그립니다(이미지 에셋 없음). */
(() => {
  'use strict';

  const canvas = document.getElementById('sim');
  const ctx = canvas.getContext('2d');
  const TAU = Math.PI * 2;

  const HOLD_BURN_TIME = 38.5;   // 계속 빨았을 때 한 개비가 다 타는 시간(초)
  const IDLE_BURN_TIME = 294;  // 그냥 뒀을 때 다 타는 시간(초)
  const MAX_PARTICLES = 700;

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  let W = 0, H = 0, dpr = 1;
  let G = null;            // 기하 정보
  let cigSprite = null;    // 담배 본체(종이+필터)
  let bgSprite = null;     // 배경 연기 무늬
  const puffSprites = [];
  let ashBlobs = [];
  const smoke = [];
  const flakes = [];

  const S = {
    burn: 0, glow: 0, holding: false, holdStart: 0, done: false, doneT: 0,
    ashLen: 0.45, ashMax: 1.1, t: 0, running: false, emitAcc: 0, raf: 0, last: 0,
  };
  const opts = { sound: true, haptics: true };
  const listeners = { finish: [], hold: [] };
  const emit = (name, ...a) => listeners[name].forEach((f) => f(...a));

  /* ---------- 스프라이트 생성 ---------- */

  function makePuff(seed) {
    const s = 128;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const x = c.getContext('2d');
    const r = rng(seed);
    for (let i = 0; i < 20; i++) {
      const a = r() * TAU, d = Math.pow(r(), 0.6) * s * 0.33;
      const px = s / 2 + Math.cos(a) * d, py = s / 2 + Math.sin(a) * d;
      const rad = s * (0.05 + r() * 0.11);
      const al = 0.16 + r() * 0.4;
      const g = x.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, `rgba(255,255,255,${al})`);
      g.addColorStop(0.55, `rgba(244,244,248,${al * 0.45})`);
      g.addColorStop(1, 'rgba(238,238,244,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(px, py, rad, 0, TAU); x.fill();
    }
    return c;
  }

  function buildAsh(seed) {
    const r = rng(seed);
    const cols = ['#5f595c', '#8b8487', '#b3aaad', '#2b2527', '#a39196', '#77706f', '#c9c0c2', '#453c3f', '#1c1718'];
    ashBlobs = [];
    for (let i = 0; i < 130; i++) {
      const v = Math.pow(r(), 1.25);
      ashBlobs.push({
        u: (r() - 0.5) * (1 - 0.5 * v) * 0.95,
        v,
        r: 0.035 + r() * 0.06,
        col: cols[(r() * cols.length) | 0],
        hot: v < 0.45 && r() < 0.4,
        ph: r() * TAU,
      });
    }
    ashBlobs.sort((a, b) => b.v - a.v);
  }

  function buildCig() {
    const { cw, bottom, top0, filterTop } = G;
    const h = bottom - top0, ph = filterTop - top0;
    const c = document.createElement('canvas');
    c.width = Math.ceil(cw * dpr); c.height = Math.ceil(h * dpr);
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    const r = rng(7);
    const e = cw * 0.055;

    x.beginPath();
    x.moveTo(0, 0); x.lineTo(cw, 0); x.lineTo(cw, h - e);
    x.ellipse(cw / 2, h - e, cw / 2, e, 0, 0, Math.PI);
    x.closePath(); x.clip();

    // 종이
    let g = x.createLinearGradient(0, 0, cw, 0);
    g.addColorStop(0, '#9a97a1'); g.addColorStop(0.12, '#cdcad3');
    g.addColorStop(0.4, '#f4f2f6'); g.addColorStop(0.62, '#eeecf1');
    g.addColorStop(0.88, '#c2bfc8'); g.addColorStop(1, '#8d8a95');
    x.fillStyle = g; x.fillRect(0, 0, cw, ph);
    x.lineWidth = 0.6;
    for (let y = 2; y < ph; y += 2.6) {
      x.strokeStyle = `rgba(110,105,125,${0.05 + r() * 0.09})`;
      x.beginPath(); x.moveTo(cw * 0.06, y); x.lineTo(cw * (0.55 + r() * 0.4), y + (r() - 0.5)); x.stroke();
    }

    // 필터
    g = x.createLinearGradient(0, 0, cw, 0);
    g.addColorStop(0, '#8a4f10'); g.addColorStop(0.15, '#c67a1e');
    g.addColorStop(0.45, '#e49b36'); g.addColorStop(0.7, '#d98d2b'); g.addColorStop(1, '#85490d');
    x.fillStyle = g; x.fillRect(0, ph, cw, h - ph);
    for (let i = 0; i < 1400; i++) {
      x.fillStyle = r() < 0.5 ? 'rgba(120,60,5,0.18)' : 'rgba(255,205,120,0.16)';
      x.fillRect(r() * cw, ph + r() * (h - ph), 1, 1);
    }
    const n = Math.round(clamp((h - ph) / cw, 1, 4) * 16);
    for (let i = 0; i < n; i++) {
      const px = cw * (0.08 + r() * 0.84), py = ph + (h - ph) * (0.04 + r() * 0.92);
      const rad = cw * (0.02 + r() * r() * 0.07);
      x.fillStyle = `rgba(246,${195 + (r() * 25 | 0)},${105 + (r() * 30 | 0)},${0.55 + r() * 0.35})`;
      x.beginPath();
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * TAU, rr = rad * (0.6 + r() * 0.7);
        const qx = px + Math.cos(a) * rr, qy = py + Math.sin(a) * rr * 1.2;
        k ? x.lineTo(qx, qy) : x.moveTo(qx, qy);
      }
      x.closePath(); x.fill();
    }
    // 종이-필터 경계
    x.fillStyle = 'rgba(70,35,5,0.45)'; x.fillRect(0, ph - 0.5, cw, 1.5);
    x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(0, ph + 1, cw, 1);

    // 원통 음영
    g = x.createLinearGradient(0, 0, cw, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.28)'); g.addColorStop(0.2, 'rgba(0,0,0,0)');
    g.addColorStop(0.75, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.34)');
    x.fillStyle = g; x.fillRect(0, 0, cw, h);
    cigSprite = c;
  }

  function buildBg() {
    const sc = 9;
    const bw = Math.ceil(W / sc), bh = Math.ceil(H / sc);
    const c = document.createElement('canvas');
    c.width = bw; c.height = bh;
    const x = c.getContext('2d');
    x.fillStyle = '#020306'; x.fillRect(0, 0, bw, bh);
    const r = rng(42);
    x.globalCompositeOperation = 'lighter';
    x.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const p = [];
      const sx = r() * bw, sy = bh * (0.2 + r() * 0.9);
      for (let k = 0; k < 4; k++) p.push([sx + (r() - 0.5) * bw * 1.1 * (k ? 1 : 0), sy - k * bh * (0.15 + r() * 0.2) + (r() - 0.5) * bh * 0.2]);
      const strands = 6 + (r() * 9 | 0);
      const spread = 2 + r() * 9;
      for (let s = 0; s < strands; s++) {
        const o = (s / strands - 0.5) * spread;
        const tw = r() * 0.6 + 0.7;
        x.strokeStyle = `rgba(${95 + (r() * 30 | 0)},${120 + (r() * 30 | 0)},${150 + (r() * 30 | 0)},${0.012 + r() * 0.02})`;
        x.lineWidth = 0.6 + r() * 3;
        x.beginPath();
        x.moveTo(p[0][0] + o, p[0][1]);
        x.bezierCurveTo(p[1][0] + o * tw, p[1][1] + o, p[2][0] - o * tw, p[2][1], p[3][0] + o * 1.6, p[3][1] - o);
        x.stroke();
      }
    }
    x.globalCompositeOperation = 'source-over';
    // 위쪽·오른쪽 위는 더 어둡게
    let g = x.createLinearGradient(0, 0, 0, bh);
    g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.5, 'rgba(0,0,0,0.15)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, bw, bh);
    bgSprite = c;
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    W = r.width; H = r.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const cw = clamp(W * 0.175, 50, 120);
    const bottom = H - Math.max(10, H * 0.018);
    const filterTop = bottom - H * 0.235;
    const top0 = H * 0.17;
    G = { cw, cx: W / 2, bottom, filterTop, top0, paperLen: filterTop - top0 - cw * 0.15 };
    buildCig(); buildBg();
    if (!S.running) draw();
  }

  /* ---------- 소리 ---------- */

  let ac = null, noiseBuf = null, hissGain = null;
  function initAudio() {
    if (ac || !opts.sound) { if (ac && ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ac = new AC();
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 5200; f.Q.value = 0.6;
      hissGain = ac.createGain(); hissGain.gain.value = 0;
      src.connect(f); f.connect(hissGain); hissGain.connect(ac.destination);
      src.start();
    } catch (e) { ac = null; }
  }
  function pop(level) {
    if (!ac || !opts.sound || ac.state !== 'running') return;
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = rand(1400, 6500); f.Q.value = rand(2, 6);
    const g = ac.createGain();
    const t = ac.currentTime, dur = rand(0.012, 0.05);
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(ac.destination);
    src.start(t, Math.random() * 0.9, dur + 0.02);
  }
  function updateAudio(dt) {
    if (!ac) return;
    const on = opts.sound && S.running && !S.done;
    hissGain.gain.setTargetAtTime(on ? S.glow * 0.03 : 0, ac.currentTime, 0.08);
    if (on && Math.random() < dt * (1.2 + S.glow * 26)) pop((0.02 + Math.random() * 0.1) * (0.25 + S.glow));
  }

  /* ---------- 시뮬레이션 ---------- */

  const tipY = () => G.top0 + S.burn * G.paperLen;

  function spawnSmoke(k) {
    if (smoke.length >= MAX_PARTICLES) return;
    const { cw, cx } = G;
    smoke.push({
      x: cx + rand(-0.28, 0.28) * cw,
      y: tipY() - S.ashLen * cw * rand(0.3, 0.9),
      vx: cw * rand(0.3, 1.2), vy: -H * rand(0.09, 0.15) * (1 + 0.3 * k),
      ax: cw * rand(0.2, 0.6), drag: 0, turb: cw * 0.25, ph: rand(0, TAU),
      size: cw * rand(0.4, 0.7) * (1 + 0.4 * k), grow: cw * rand(0.5, 1.0) * (1 + 0.9 * k),
      rot: rand(0, TAU), rv: rand(-0.5, 0.5),
      age: 0, life: rand(2.4, 3.8) * (1 + 0.2 * k),
      a: rand(0.2, 0.34) + k * 0.2,
      sp: puffSprites[(Math.random() * puffSprites.length) | 0],
    });
  }

  // 손을 떼면 화면 아래에서 내뿜는 연기
  function exhale(dur) {
    const n = Math.round(clamp(dur * 9, 6, 38));
    for (let i = 0; i < n; i++) {
      smoke.push({
        x: G.cx + rand(-0.2, 0.2) * W, y: H + rand(10, 60),
        vx: rand(-0.22, 0.22) * W, vy: -H * rand(0.45, 0.95),
        ax: 0, drag: 0.9, turb: G.cw * 0.4, ph: rand(0, TAU),
        size: W * rand(0.22, 0.4), grow: W * rand(0.12, 0.28),
        rot: rand(0, TAU), rv: rand(-0.3, 0.3),
        age: -i * 0.035, life: rand(2.4, 4.2),
        a: rand(0.07, 0.15),
        sp: puffSprites[(Math.random() * puffSprites.length) | 0],
      });
    }
  }

  function dropAsh() {
    const { cw, cx } = G, y = tipY();
    for (let i = 0; i < 16; i++) {
      flakes.push({
        x: cx + rand(-0.4, 0.4) * cw, y: y - rand(0.1, S.ashLen) * cw,
        vx: rand(-0.5, 0.5) * cw, vy: rand(-0.3, 0.6) * cw,
        s: rand(0.04, 0.13) * cw, rot: rand(0, TAU), rv: rand(-5, 5),
        col: ['#8a7f84', '#b9aab0', '#4a4044', '#d0c4c8'][(Math.random() * 4) | 0], age: 0,
      });
    }
    S.ashLen = 0.3; S.ashMax = rand(0.9, 1.4);
    buildAsh((Math.random() * 1e9) | 0);
  }

  // 다 탔거나(early=false) 중간에 비벼 껐을 때(early=true)
  function finish(early) {
    if (S.done) return;
    S.done = true; S.doneT = 0;
    if (S.holding) { S.holding = false; emit('hold', false, 0); }
    if (early) { dropAsh(); S.glow = 0; }
    if (opts.haptics && navigator.vibrate) navigator.vibrate(early ? 40 : [30, 60, 30]);
    emit('finish', early);
  }

  function update(dt) {
    S.t += dt;
    const target = S.done ? 0 : S.holding ? 1 : 0.1;
    S.glow += (target - S.glow) * Math.min(1, dt * (target > S.glow ? 5 : 1.8));

    if (!S.done) {
      const rate = S.holding ? 1 / HOLD_BURN_TIME : 1 / IDLE_BURN_TIME;
      S.burn += rate * dt;
      S.ashLen += (rate * dt * G.paperLen / G.cw) * 0.85;
      if (S.ashLen > S.ashMax) dropAsh();
      if (S.burn >= 1) { S.burn = 1; finish(false); }
    } else S.doneT += dt;

    const rate = S.done ? Math.max(0, 12 - S.doneT * 3) : 20 + S.glow * 42;
    S.emitAcc += rate * dt;
    while (S.emitAcc > 1) { S.emitAcc -= 1; spawnSmoke(S.glow); }

    for (let i = smoke.length - 1; i >= 0; i--) {
      const p = smoke[i];
      p.age += dt;
      if (p.age < 0) continue;
      if (p.age > p.life) { smoke.splice(i, 1); continue; }
      p.vx += p.ax * dt;
      if (p.drag) { const d = Math.max(0, 1 - p.drag * dt); p.vx *= d; p.vy *= d; }
      p.x += (p.vx + Math.sin(p.y * 0.012 + S.t * 1.3 + p.ph) * p.turb) * dt;
      p.y += p.vy * dt;
      p.size += p.grow * dt; p.rot += p.rv * dt;
    }
    for (let i = flakes.length - 1; i >= 0; i--) {
      const f = flakes[i];
      f.age += dt; f.vy += H * 1.1 * dt;
      f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.rv * dt;
      if (f.y > H + 20) flakes.splice(i, 1);
    }
    updateAudio(dt);
  }

  function draw() {
    if (!G) return;
    const { cw, cx, bottom, top0 } = G;
    const y = tipY(), x0 = cx - cw / 2, g = S.glow;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 배경
    const m = 14;
    ctx.drawImage(bgSprite, -m + Math.sin(S.t * 0.07) * m, -m + Math.cos(S.t * 0.05) * m, W + 2 * m, H + 2 * m);

    // 담배 본체
    const sy = (y - top0) * dpr;
    ctx.drawImage(cigSprite, 0, sy, cigSprite.width, cigSprite.height - sy, x0, y, cw, bottom - y);

    // 그을린 띠
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y - 1, cw, cw * 0.4); ctx.clip();
    const N = 14;
    for (let i = 0; i < N; i++) {
      const hh = cw * (0.24 + 0.08 * Math.sin(i * 2.3 + y * 0.09) + 0.04 * Math.sin(i * 5.1 + 1.7));
      const sg = ctx.createLinearGradient(0, y, 0, y + hh);
      sg.addColorStop(0, 'rgba(18,9,5,0.96)'); sg.addColorStop(0.35, 'rgba(70,36,14,0.8)');
      sg.addColorStop(0.7, 'rgba(140,90,45,0.35)'); sg.addColorStop(1, 'rgba(150,100,60,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(x0 + (i / N) * cw - 0.3, y - 1, cw / N + 0.6, hh + 1);
    }
    ctx.restore();

    // 재
    const ashH = S.ashLen * cw;
    for (const b of ashBlobs) {
      ctx.fillStyle = b.col;
      ctx.beginPath();
      ctx.arc(cx + b.u * cw, y - b.v * ashH + cw * 0.02, b.r * cw * (0.6 + 0.4 * Math.min(1, S.ashLen)), 0, TAU);
      ctx.fill();
    }

    // 불씨
    ctx.globalCompositeOperation = 'lighter';
    const fl = 0.85 + 0.15 * Math.sin(S.t * 23) * Math.sin(S.t * 7.3);
    ctx.save();
    ctx.translate(cx, y - cw * 0.14); ctx.scale(1, 0.55);
    let rg = ctx.createRadialGradient(0, 0, 0, 0, 0, cw * 0.72);
    rg.addColorStop(0, `rgba(255,120,40,${0.95 * g * fl})`);
    rg.addColorStop(0.45, `rgba(255,50,15,${0.6 * g * fl})`);
    rg.addColorStop(1, 'rgba(255,30,0,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, cw * 0.72, 0, TAU); ctx.fill();
    ctx.restore();
    for (const b of ashBlobs) {
      if (!b.hot) continue;
      const f = g * (0.55 + 0.45 * Math.sin(S.t * 9 + b.ph));
      if (f < 0.02) continue;
      const bx = cx + b.u * cw, by = y - b.v * ashH + cw * 0.02, br = b.r * cw * 2.4;
      rg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      rg.addColorStop(0, `rgba(255,${170 + (60 * f | 0)},70,${f})`);
      rg.addColorStop(1, 'rgba(255,40,0,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
    }
    if (g > 0.15) {
      rg = ctx.createRadialGradient(cx, y - cw * 0.2, 0, cx, y - cw * 0.2, cw * 2.4);
      rg.addColorStop(0, `rgba(255,80,20,${0.2 * g})`); rg.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = rg; ctx.fillRect(cx - cw * 2.4, y - cw * 2.6, cw * 4.8, cw * 4.8);
    }
    ctx.globalCompositeOperation = 'source-over';

    // 떨어지는 재
    for (const f of flakes) {
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot);
      ctx.globalAlpha = clamp(1.6 - f.age, 0, 1);
      ctx.fillStyle = f.col; ctx.fillRect(-f.s / 2, -f.s / 2, f.s, f.s * 0.7);
      ctx.restore();
    }

    // 연기
    for (const p of smoke) {
      if (p.age < 0) continue;
      const k = p.age / p.life;
      const a = p.a * Math.min(1, p.age / 0.2) * Math.pow(1 - k, 1.2);
      if (a < 0.004) continue;
      const c = Math.cos(p.rot) * dpr, s = Math.sin(p.rot) * dpr;
      ctx.setTransform(c, s, -s, c, p.x * dpr, p.y * dpr);
      ctx.globalAlpha = a;
      ctx.drawImage(p.sp, -p.size / 2, -p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function frame(now) {
    if (!S.running) return;
    const dt = Math.min(0.05, (now - S.last) / 1000 || 0);
    S.last = now;
    update(dt); draw();
    S.raf = requestAnimationFrame(frame);
  }

  /* ---------- 입력 ---------- */

  function press() {
    if (S.done || S.holding) return;
    initAudio();
    S.holding = true; S.holdStart = performance.now();
    if (opts.haptics && navigator.vibrate) navigator.vibrate(12);
    emit('hold', true, 0);
  }
  function release() {
    if (!S.holding) return;
    S.holding = false;
    const dur = (performance.now() - S.holdStart) / 1000;
    if (dur > 0.7) exhale(dur);
    emit('hold', false, dur);
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    press();
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((n) => canvas.addEventListener(n, release));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && S.running && !e.repeat && !/INPUT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); press(); }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') release(); });
  window.addEventListener('blur', release);

  /* ---------- 공개 API ---------- */

  for (let i = 0; i < 6; i++) puffSprites.push(makePuff(100 + i * 17));
  buildAsh(3);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize);
  resize();

  window.Sim = {
    start() {
      if (S.running) return;
      resize();
      S.running = true; S.last = performance.now();
      S.raf = requestAnimationFrame(frame);
    },
    stop() {
      release();
      S.running = false; cancelAnimationFrame(S.raf);
      if (hissGain && ac) hissGain.gain.setTargetAtTime(0, ac.currentTime, 0.05);
    },
    extinguish() { finish(true); },
    reset() {
      S.burn = 0; S.done = false; S.doneT = 0; S.glow = 0; S.holding = false;
      S.ashLen = 0.45; S.ashMax = rand(0.9, 1.4);
      flakes.length = 0;
      buildAsh((Math.random() * 1e9) | 0);
    },
    on(name, fn) { listeners[name].push(fn); },
    setOptions(o) { Object.assign(opts, o); },
    get progress() { return S.burn; },
    // 테스트·디버그용
    _state: S, _press: press, _release: release, _step(dt) { update(dt); draw(); },
  };
})();
