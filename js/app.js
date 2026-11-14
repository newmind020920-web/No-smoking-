/* 금연 기록·설정·화면 전환 */
(() => {
  'use strict';

  const KEY = 'hanmogeum.v1';
  const PACK = 20;            // 한 갑 개비 수
  const LIFE_MIN = 11;        // 한 개비당 수명(분, 추정)
  const $ = (s) => document.querySelector(s);
  const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;

  const MILESTONES = [
    [20 * MIN, '20분', '심박수와 혈압이 내려가기 시작합니다'],
    [12 * HOUR, '12시간', '혈중 일산화탄소가 정상 수준으로 돌아옵니다'],
    [14 * DAY, '2주', '혈액순환과 폐 기능이 좋아지기 시작합니다'],
    [30 * DAY, '1개월', '기침과 숨가쁨이 줄어듭니다'],
    [365 * DAY, '1년', '관상동맥질환 위험이 흡연자의 절반으로 줄어듭니다'],
    [5 * 365 * DAY, '5년', '뇌졸중 위험이 낮아지기 시작해 5~15년 사이 비흡연자 수준이 됩니다'],
    [10 * 365 * DAY, '10년', '폐암 위험이 흡연자의 절반 수준으로 줄어듭니다'],
    [15 * 365 * DAY, '15년', '관상동맥질환 위험이 비흡연자와 같아집니다'],
  ];

  let data = load();
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
  }

  const won = (n) => '₩' + Math.floor(n).toLocaleString('ko-KR');
  const pad = (n) => String(n).padStart(2, '0');
  const toLocalInput = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * MIN).toISOString().slice(0, 16);
  function shortDur(ms) {
    const d = Math.floor(ms / DAY), h = Math.floor(ms / HOUR) % 24, m = Math.floor(ms / MIN) % 60;
    if (d > 0) return `${d}일 ${h}시간`;
    if (h > 0) return `${h}시간 ${m}분`;
    return `${m}분`;
  }
  function lifeDur(min) {
    if (min >= 1440) return `${Math.floor(min / 1440)}일 ${Math.floor(min / 60) % 24}시간`;
    if (min >= 60) return `${Math.floor(min / 60)}시간 ${Math.floor(min) % 60}분`;
    return `${Math.floor(min)}분`;
  }
  const todayCount = () => {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    return data.log.filter((t) => t >= d0.getTime()).length;
  };

  /* ---------- 화면 갱신 ---------- */

  let craveStart = 0;

  function render() {
    if (!data) return;
    const el = Math.max(0, Date.now() - data.quitAt);
    const cigs = (el / DAY) * data.perDay;

    $('#hud-time').textContent = `금연 ${shortDur(el)}째`;
    $('#hud-count').textContent = `넘긴 갈망 ${data.log.length}회`;
    if (craveStart) {
      const s = Math.floor((Date.now() - craveStart) / 1000);
      $('#crave-clock').textContent = `${Math.floor(s / 60)}:${pad(s % 60)}`;
    }

    if (!$('#tab-stats').classList.contains('active')) return;
    const s = Math.floor(el / 1000);
    $('#st-timer').textContent = `${Math.floor(s / 86400)}일 ${pad(Math.floor(s / 3600) % 24)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
    $('#st-since').textContent = new Date(data.quitAt).toLocaleString('ko-KR', { dateStyle: 'long', timeStyle: 'short' }) + '부터';
    $('#st-money').textContent = won(cigs * data.price / PACK);
    $('#st-cigs').textContent = `${Math.floor(cigs).toLocaleString('ko-KR')}개비`;
    $('#st-life').textContent = lifeDur(cigs * LIFE_MIN);
    $('#st-crave').textContent = `${data.log.length}회`;
    $('#st-today').textContent = `오늘 ${todayCount()}회`;

    $('#timeline').innerHTML = MILESTONES.map(([ms, when, what]) => {
      const p = Math.min(1, el / ms);
      return `<li class="${p >= 1 ? 'reached' : ''}"><div class="top"><span class="when">${when}</span><span class="pct">${p >= 1 ? '달성 ✓' : (p * 100).toFixed(p < 0.1 ? 1 : 0) + '%'}</span></div><div class="what">${what}</div><div class="bar"><i style="width:${p * 100}%"></i></div></li>`;
    }).join('');
  }

  /* ---------- 탭 ---------- */

  function show(tab) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + tab));
    document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'sim' && data && !document.hidden) Sim.start(); else Sim.stop();
    if (tab === 'settings') fillSettings();
    render();
  }
  document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) Sim.stop();
    else if ($('#tab-sim').classList.contains('active') && data) Sim.start();
  });

  /* ---------- 가상 담배 ---------- */

  const hint = $('#hint');
  let hintTimer = 0;
  Sim.on('hold', (holding, dur) => {
    clearTimeout(hintTimer);
    if (holding) {
      if (!craveStart) { craveStart = Date.now(); $('#crave').hidden = false; render(); }
      hint.textContent = '천천히 들이쉬는 중…';
      hint.classList.add('inhale');
    } else {
      hint.classList.remove('inhale');
      hint.textContent = dur > 0.7 ? '후— 길게 내쉬세요' : '조금 더 길게 눌러 보세요';
      hintTimer = setTimeout(() => { hint.textContent = '피우고 싶을 때마다 다시 꾹 누르세요'; }, 3500);
    }
  });
  Sim.on('finish', () => {
    data.log.push(Date.now()); save();
    $('#done-gain').textContent = `이 한 개비로 지킨 것: ${won(data.price / PACK)} · 수명 약 ${LIFE_MIN}분`;
    setTimeout(() => { $('#done').hidden = false; }, 1200);
    render();
  });
  function newCig() {
    $('#done').hidden = true;
    craveStart = 0; $('#crave').hidden = true;
    hint.textContent = '담배를 꾹 누르고 있으면 한 모금 빨아들입니다';
    Sim.reset();
  }
  $('#btn-new').addEventListener('click', newCig);
  $('#btn-stats').addEventListener('click', () => { newCig(); show('stats'); });

  /* ---------- 설정 ---------- */

  const fs = $('#form-settings');
  function fillSettings() {
    if (!data) return;
    fs.quitAt.value = toLocalInput(data.quitAt);
    fs.perDay.value = data.perDay; fs.price.value = data.price;
    fs.sound.checked = data.sound; fs.haptics.checked = data.haptics;
  }
  function readForm(f) {
    const q = new Date(f.quitAt.value).getTime();
    return {
      quitAt: Math.min(isNaN(q) ? Date.now() : q, Date.now()),
      perDay: Math.max(1, +f.perDay.value || 20),
      price: Math.max(0, +f.price.value || 0),
    };
  }
  function applyOptions() { Sim.setOptions({ sound: data.sound, haptics: data.haptics }); }

  fs.addEventListener('submit', (e) => {
    e.preventDefault();
    Object.assign(data, readForm(fs), { sound: fs.sound.checked, haptics: fs.haptics.checked });
    save(); applyOptions(); fillSettings();
    $('#saved').hidden = false; setTimeout(() => { $('#saved').hidden = true; }, 1800);
  });
  // 두 번 눌러 확인(브라우저 confirm 창을 쓰지 않음)
  function twoTap(btn, ask, run) {
    const label = btn.textContent;
    let timer = 0;
    btn.addEventListener('click', () => {
      if (timer) { clearTimeout(timer); timer = 0; btn.textContent = label; run(); return; }
      btn.textContent = ask;
      timer = setTimeout(() => { timer = 0; btn.textContent = label; }, 3500);
    });
  }
  twoTap($('#btn-restart'), '한 번 더 누르면 지금부터 다시 시작합니다', () => {
    data.quitAt = Date.now(); save(); fillSettings(); render();
  });
  twoTap($('#btn-wipe'), '한 번 더 누르면 전부 지웁니다', () => {
    try { localStorage.removeItem(KEY); } catch (e) {}
    location.reload();
  });

  /* ---------- 첫 실행 ---------- */

  const fo = $('#form-onboard');
  fo.addEventListener('submit', (e) => {
    e.preventDefault();
    data = Object.assign(readForm(fo), { sound: true, haptics: true, log: [] });
    save(); applyOptions();
    $('#onboard').hidden = true;
    show('sim');
  });

  if (data) {
    data.log = data.log || [];
    applyOptions(); show('sim');
  } else {
    fo.quitAt.value = toLocalInput(Date.now());
    $('#onboard').hidden = false;
  }
  setInterval(render, 1000);

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
