(function () {
  'use strict';

  const TZ = 'Asia/Jakarta';
  const state = {
    config: null,
    weeks: [],
    subs: [],
    user: null,
    viewIndex: 0,
    contests: null,
    progress: null,
    tab: 'minggu',
    // Tanda yang dibagi antar perangkat lewat Firebase (sudah daftar kontes, mulai kerjakan soal).
    sync: { url: null, pin: null, ok: false, error: null, data: { registered: {}, started: {} } },
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const keyOf = (p) => `${p.contestId}${p.index}`;
  const problemUrl = (p) => `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`;
  const contestUrl = (p) => `https://codeforces.com/contest/${p.contestId}`;

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (_) { /* storage tidak tersedia */ }
    return null;
  }

  function rankClass(r) {
    if (r == null) return '';
    if (r < 1200) return 'r-gray';
    if (r < 1400) return 'r-green';
    if (r < 1600) return 'r-cyan';
    if (r < 1900) return 'r-blue';
    if (r < 2100) return 'r-violet';
    if (r < 2400) return 'r-orange';
    return 'r-red';
  }

  const fmtDate = (sec, opts) => new Intl.DateTimeFormat('id-ID', { timeZone: TZ, ...opts }).format(new Date(sec * 1000));
  const fmtIso = (iso, opts) => new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', ...opts }).format(new Date(iso + 'T00:00:00Z'));

  async function getJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
  }

  async function cf(method, params) {
    const url = new URL(`https://codeforces.com/api/${method}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const body = await getJson(url);
    if (body.status !== 'OK') throw new Error(body.comment || 'Codeforces API error');
    return body.result;
  }

  // Soal dianggap "sedang dikerjakan" jika submit terakhirnya belum lama.
  const ACTIVE_SEC = 3 * 3600;

  function agoText(sec) {
    const d = Date.now() / 1000 - sec;
    if (d < 3600) return `${Math.max(1, Math.round(d / 60))} menit lalu`;
    if (d < 86400) return `${Math.floor(d / 3600)} jam lalu`;
    return fmtDate(sec, { day: 'numeric', month: 'short' });
  }

  // ---------- Sinkronisasi antar perangkat (Firebase Realtime Database) ----------
  // Data disimpan di /k/<PIN>/..., dan aturan database hanya mengizinkan PIN keluarga.
  // PIN tidak ada di kode situs; setiap perangkat memasukkannya sekali (tersimpan di browser).
  const fbKey = (s) => String(s).replace(/[.#$\[\]\/]/g, '_');
  const syncBase = () => `${state.sync.url.replace(/\/$/, '')}/k/${encodeURIComponent(state.sync.pin)}`;

  async function syncLoad() {
    const sy = state.sync;
    if (!sy.url || !sy.pin) { sy.ok = false; return false; }
    try {
      const res = await fetch(`${syncBase()}.json`, { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) { sy.ok = false; sy.error = 'PIN salah'; return false; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) || {};
      const next = { registered: data.registered || {}, started: data.started || {} };
      const changed = !sy.ok || JSON.stringify(next) !== JSON.stringify(sy.data);
      sy.data = next;
      sy.ok = true;
      sy.error = null;
      return changed;
    } catch (e) {
      sy.error = 'Tidak bisa terhubung';
      return false;
    }
  }

  async function syncWrite(group, key, value) {
    const sy = state.sync;
    if (value == null) delete sy.data[group][key];
    else sy.data[group][key] = value;
    renderAll();
    try {
      const res = await fetch(`${syncBase()}/${group}/${key}.json`, {
        method: value == null ? 'DELETE' : 'PUT',
        body: value == null ? undefined : JSON.stringify(value),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (_) {
      $('banner').textContent = 'Tanda belum tersimpan karena koneksi bermasalah. Coba lagi sebentar lagi.';
      $('banner').hidden = false;
      await syncLoad();
      renderAll();
    }
  }

  const cfProblemKey = (p) => fbKey(`cf_${p.contestId}${p.index}`);
  const tlxProblemKey = (b) => fbKey(`tlx_${b.problemJid}`);
  const contestKey = (c) => fbKey(`${c.platform}_${c.id || c.url.split('/').filter(Boolean).pop()}`);

  function startedInfo(key) {
    const at = state.sync.ok ? state.sync.data.started[key]?.at : null;
    if (!at) return null;
    const sec = Math.round(at / 1000);
    return { kind: 'started', attempts: 0, lastAt: sec, startedAt: sec, active: Date.now() / 1000 - sec < ACTIVE_SEC };
  }

  function startButton(key, s) {
    if (!state.sync.ok) return '';
    if (s.kind === 'todo') return `<button class="mini-btn" data-start="${key}">Mulai kerjakan</button>`;
    if (s.kind === 'started') return `<button class="mini-btn ghost" data-unstart="${key}" title="Hapus tanda mulai">Batal</button>`;
    return '';
  }

  function renderSyncBox() {
    const el = $('sync');
    const sy = state.sync;
    if (!sy.url) { el.hidden = true; return; }
    el.hidden = false;
    if (sy.ok) {
      el.innerHTML = `<span class="sync-ok">● Perangkat ini tersambung</span> <button class="link-btn" data-sync="logout">Putuskan</button>`;
      return;
    }
    if (document.activeElement?.id === 'sync-pin') return; // jangan ganggu saat sedang mengetik
    el.innerHTML = `<form class="sync-form" id="sync-form">
        <label for="sync-pin">Sambungkan perangkat ini dengan PIN keluarga untuk memakai tombol "Tandai sudah daftar" dan "Mulai kerjakan":</label>
        <div class="sync-row">
          <input id="sync-pin" type="password" autocomplete="off" placeholder="PIN" required>
          <button type="submit" class="btn-ghost">Sambungkan</button>
        </div>
        ${sy.error ? `<p class="sync-err">${esc(sy.error)}. Periksa lagi PIN-nya.</p>` : ''}
      </form>`;
  }

  // ---------- Status soal dari submission Codeforces ----------
  function statusOf(problem, week) {
    const name = problem.name.trim().toLowerCase();
    const mine = state.subs.filter(
      (s) => s.problem && ((s.problem.contestId === problem.contestId && s.problem.index === problem.index) ||
        s.problem.name.trim().toLowerCase() === name)
    );
    if (!mine.length) return startedInfo(cfProblemKey(problem)) || { kind: 'todo', attempts: 0 };
    const ok = mine.filter((s) => s.verdict === 'OK').sort((a, b) => a.creationTimeSeconds - b.creationTimeSeconds)[0];
    if (!ok) {
      const lastAt = Math.max(...mine.map((s) => s.creationTimeSeconds));
      return { kind: 'tried', attempts: mine.length, lastAt, active: Date.now() / 1000 - lastAt < ACTIVE_SEC };
    }
    const attempts = mine.filter((s) => s.creationTimeSeconds <= ok.creationTimeSeconds).length;
    const onTime = ok.creationTimeSeconds < week.deadline;
    return { kind: onTime ? 'ok' : 'late', attempts, at: ok.creationTimeSeconds };
  }

  // Label untuk soal yang sudah dicoba tapi belum selesai.
  function progressStatus(s, extra) {
    const label = s.active ? 'Sedang dikerjakan' : 'Proses';
    const cls = s.active ? 'active' : 'proses';
    if (s.kind === 'started') {
      return `<span class="status ${cls}">${label}</span><small>mulai ${agoText(s.startedAt)} · belum submit</small>`;
    }
    const last = s.lastAt ? ` · terakhir ${agoText(s.lastAt)}` : '';
    return `<span class="status ${cls}">${label}${extra ? ` · ${extra}` : ''}</span><small>${s.attempts}× submit${last}</small>`;
  }

  function weekScore(week) {
    let onTime = 0, late = 0;
    for (const p of week.problems) {
      const s = statusOf(p, week);
      if (s.kind === 'ok') onTime++;
      else if (s.kind === 'late') late++;
    }
    return { onTime, late, total: onTime + late, count: week.problems.length };
  }

  function bonusStatusOf(b, week) {
    const e = state.progress?.tlx?.problems?.[b.problemJid];
    if (!e || !e.attempts) return startedInfo(tlxProblemKey(b)) || { kind: 'todo', attempts: 0 };
    if (e.solvedAt) return { kind: e.solvedAt < week.deadline ? 'ok' : 'late', attempts: e.attempts, at: e.solvedAt, best: 100 };
    const active = !!e.lastAt && Date.now() / 1000 - e.lastAt < ACTIVE_SEC;
    if (e.best > 0) return { kind: 'partial', attempts: e.attempts, best: e.best, lastAt: e.lastAt, active };
    return { kind: 'tried', attempts: e.attempts, best: 0, lastAt: e.lastAt, active };
  }

  function bonusScore(week) {
    const list = week.bonus || [];
    const done = list.filter((b) => ['ok', 'late'].includes(bonusStatusOf(b, week).kind)).length;
    return { done, count: list.length };
  }

  function currentWeekIndex() {
    const now = Date.now() / 1000;
    let idx = 0;
    state.weeks.forEach((w, i) => {
      const startSec = w.deadline - 7 * 86400;
      if (startSec <= now) idx = i;
    });
    return idx;
  }

  // ---------- Render: profil ----------
  function renderProfile() {
    const el = $('profile');
    const cfg = state.config;
    const level = cfg.level;
    const parts = [];
    if (state.user) {
      const u = state.user;
      parts.push(`<a class="chip" href="https://codeforces.com/profile/${esc(u.handle)}" target="_blank" rel="noopener">
        <span class="${rankClass(u.rating)}">${esc(u.handle)}</span>
        <span class="mono ${rankClass(u.rating)}">${u.rating ?? 'unrated'}</span></a>`);
    } else {
      parts.push(`<span class="chip">${esc(cfg.handle)}</span>`);
    }
    const ac = state.progress?.atcoder;
    if (ac) {
      parts.push(`<a class="chip" href="https://atcoder.jp/users/${esc(ac.handle)}" target="_blank" rel="noopener">AtCoder
        <span class="mono">${ac.rating ?? 'unrated'}</span></a>`);
    }
    parts.push(`<span class="chip">Level <span class="mono">${level.min}–${level.max}</span></span>`);
    el.innerHTML = parts.join('');
  }

  // ---------- Render: minggu ----------
  function renderWeek() {
    const weeks = state.weeks;
    const list = $('problems');
    if (!weeks.length) {
      $('week-title').textContent = 'Belum ada paket soal';
      $('week-dates').textContent = 'Paket pertama dibuat otomatis hari Senin, atau jalankan workflow "Soal Mingguan" secara manual.';
      list.innerHTML = '<li class="empty">Soal minggu ini akan muncul di sini.</li>';
      $('week-score').textContent = '0/8';
      $('prev-week').disabled = $('next-week').disabled = true;
      $('levelup').hidden = true;
      $('discussion').hidden = true;
      return;
    }
    const w = weeks[state.viewIndex];
    const isCurrent = state.viewIndex === currentWeekIndex();
    $('prev-week').disabled = state.viewIndex === 0;
    $('next-week').disabled = state.viewIndex === weeks.length - 1;
    $('week-title').textContent = `Minggu ke-${w.week}${isCurrent ? ' · minggu ini' : ''}`;
    $('week-dates').textContent =
      `${fmtIso(w.start, { day: 'numeric', month: 'short' })} – ${fmtIso(w.end, { day: 'numeric', month: 'short', year: 'numeric' })} · rating ${w.level.min}–${w.level.max}`;

    const sc = weekScore(w);
    $('week-score').textContent = `${sc.total}/${sc.count}`;
    $('week-meter').style.width = `${(sc.total / sc.count) * 100}%`;

    const now = Date.now() / 1000;
    const left = w.deadline - now;
    const startSec = w.deadline - 7 * 86400;
    if (now < startSec) {
      $('countdown').textContent = `Dimulai ${fmtDate(startSec, { weekday: 'long', day: 'numeric', month: 'long' })} pukul 00.00 WIB · boleh dicicil lebih awal`;
    } else if (left > 0) {
      const d = Math.floor(left / 86400), h = Math.floor((left % 86400) / 3600);
      $('countdown').textContent = `Sisa waktu ${d} hari ${h} jam · berakhir ${fmtDate(w.deadline - 1, { weekday: 'long', hour: '2-digit', minute: '2-digit' })} WIB`;
    } else {
      $('countdown').textContent = `Minggu ini sudah selesai · ${sc.onTime} tepat waktu, ${sc.late} susulan`;
    }

    const showTags = $('show-tags').checked;
    list.innerHTML = w.problems.map((p) => {
      const s = statusOf(p, w);
      let status;
      if (s.kind === 'ok') status = `<span class="status ok">Selesai</span><small>${fmtDate(s.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${s.attempts}× submit</small>`;
      else if (s.kind === 'late') status = `<span class="status late">Susulan</span><small>${fmtDate(s.at, { day: 'numeric', month: 'short' })} · ${s.attempts}× submit</small>`;
      else if (s.kind === 'tried') status = progressStatus(s, 'belum AC');
      else if (s.kind === 'started') status = progressStatus(s);
      else status = `<span class="status todo">Belum</span>`;
      status += startButton(cfProblemKey(p), s);
      const tags = showTags && p.tags.length
        ? `<span class="tags">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span>` : '';
      const rowClass = s.kind === 'ok' ? 'solved' : s.kind === 'late' ? 'late' : s.active ? 'working' : (s.attempts || s.kind === 'started') ? 'inprogress' : '';
      return `<li class="problem ${rowClass}">
        <span class="p-label">${esc(p.label)}</span>
        <div class="p-main">
          <a class="p-name" href="${problemUrl(p)}" target="_blank" rel="noopener">${esc(p.name)}</a>
          <div class="p-sub">
            <span class="rating ${rankClass(p.rating)}">${p.rating}</span>
            <span>CF ${p.contestId}${esc(p.index)}</span>
            ${tags}
          </div>
        </div>
        <div class="p-status">${status}</div>
      </li>`;
    }).join('');

    renderBonus(w);
    renderWorking(w);
    renderLevelUp(isCurrent);
    renderDiscussion(w);
  }

  function renderBonus(w) {
    const list = w.bonus || [];
    $('bonus').hidden = !list.length;
    const scoreEl = $('bonus-score');
    scoreEl.hidden = !list.length;
    if (!list.length) return;
    const bs = bonusScore(w);
    scoreEl.textContent = `+ Bonus OSN: ${bs.done}/${bs.count}`;
    const upd = state.progress?.updatedAt;
    $('bonus-updated').textContent = upd
      ? `Status TLX diperbarui ${new Intl.DateTimeFormat('id-ID', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(upd))} WIB (setiap 2 jam)`
      : 'Status TLX diperbarui setiap 2 jam';
    $('bonus-list').innerHTML = list.map((b, i) => {
      const s = bonusStatusOf(b, w);
      let status;
      if (s.kind === 'ok') status = `<span class="status ok">Selesai</span><small>${fmtDate(s.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${s.attempts}× submit</small>`;
      else if (s.kind === 'late') status = `<span class="status late">Susulan</span><small>${fmtDate(s.at, { day: 'numeric', month: 'short' })} · ${s.attempts}× submit</small>`;
      else if (s.kind === 'partial') status = progressStatus(s, `skor ${s.best}`);
      else if (s.kind === 'tried') status = progressStatus(s, 'skor 0');
      else if (s.kind === 'started') status = progressStatus(s);
      else status = `<span class="status todo">Belum</span>`;
      status += startButton(tlxProblemKey(b), s);
      const rowClass = s.kind === 'ok' ? 'solved' : s.kind === 'late' ? 'late' : s.active ? 'working' : (s.attempts || s.kind === 'started') ? 'inprogress' : '';
      return `<li class="problem ${rowClass}">
        <span class="p-label">B${i + 1}</span>
        <div class="p-main">
          <a class="p-name" href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.name)}</a>
          <div class="p-sub"><span class="src">TLX</span><span>${esc(b.set)} · soal ${esc(b.alias)}</span></div>
        </div>
        <div class="p-status">${status}</div>
      </li>`;
    }).join('');
  }

  // Ringkasan di kepala minggu: soal mana yang sedang/masih dikerjakan.
  function renderWorking(w) {
    const el = $('working');
    const items = [
      ...w.problems.map((p) => ({ label: p.label, s: statusOf(p, w) })),
      ...(w.bonus || []).map((b, i) => ({ label: `B${i + 1}`, s: bonusStatusOf(b, w) })),
    ];
    const active = items.filter((x) => x.s.active).map((x) => x.label);
    const proses = items.filter((x) => !x.s.active && ['tried', 'partial', 'started'].includes(x.s.kind)).map((x) => x.label);
    const parts = [];
    if (active.length) parts.push(`<span class="dot-live" aria-hidden="true"></span><strong>Sedang dikerjakan: ${active.join(', ')}</strong>`);
    if (proses.length) parts.push(`<span>Proses: ${proses.join(', ')}</span>`);
    el.hidden = !parts.length;
    el.innerHTML = parts.join('<span class="muted"> · </span>');
  }

  function renderLevelUp(isCurrent) {
    const el = $('levelup');
    const rule = state.config.autoPromote;
    if (!rule?.enabled || !isCurrent) { el.hidden = true; return; }
    el.hidden = false;
    const lvl = state.config.level;
    const atLevel = state.weeks.filter((w) => w.level.min === lvl.min && w.level.max === lvl.max);
    const recent = atLevel.slice(-rule.consecutiveWeeks);
    const pips = recent.map((w) => {
      const sc = weekScore(w);
      const done = sc.total >= rule.minSolved;
      return `<span class="pip ${done ? 'done' : ''}">M${w.week}: ${sc.total}/${sc.count}</span>`;
    }).join('');
    el.innerHTML = `
      <p><strong>Target naik level:</strong> selesaikan minimal ${rule.minSolved} dari ${state.config.problemsPerWeek} soal
      selama ${rule.consecutiveWeeks} minggu berturut-turut, maka paket berikutnya naik ke rating
      <strong>${lvl.min + rule.step}–${lvl.max + rule.step}</strong>.</p>
      <div class="pips">${pips}</div>`;
  }

  async function renderDiscussion(w) {
    $('discussion').hidden = false;
    const el = $('notes');
    // Pembahasan terkunci sampai minggu berakhir, agar Ken mencoba sendiri dulu.
    if (Date.now() / 1000 < w.deadline) {
      el.innerHTML = `<div class="locked">
        <span class="lock-icon" aria-hidden="true">🔒</span>
        <div>
          <strong>Pembahasan dibuka ${fmtDate(w.deadline, { weekday: 'long', day: 'numeric', month: 'long' })} pukul 00.00 WIB</strong>
          <p class="muted">Kerjakan dulu soal-soalnya sendiri. Catatan pembahasan dan link editorial akan muncul di sini setelah minggu ini berakhir.</p>
        </div>
      </div>`;
      return;
    }
    const editorials = `<p class="muted">Editorial resmi ada di bagian "Contest materials" pada halaman kontes. Coba kerjakan dulu sebelum membukanya.</p>
      <ul class="editorials">${w.problems.map((p) => `<li><a href="${contestUrl(p)}" target="_blank" rel="noopener">${esc(p.label)} · CF ${p.contestId}</a></li>`).join('')}</ul>`;
    el.innerHTML = editorials;
    const file = `data/notes/minggu-${String(w.week).padStart(2, '0')}.md`;
    try {
      const res = await fetch(file, { cache: 'no-store' });
      if (!res.ok) throw new Error('none');
      const md = await res.text();
      if (state.weeks[state.viewIndex] !== w) return;
      const html = window.marked ? window.marked.parse(md) : `<pre>${esc(md)}</pre>`;
      el.innerHTML = `<div>${html}</div><hr style="border:0;border-top:1px solid var(--line);margin:16px 0">${editorials}`;
    } catch (_) {
      if (state.weeks[state.viewIndex] !== w) return;
      el.insertAdjacentHTML('afterbegin', `<p class="muted">Catatan pembahasan minggu ini belum ditulis. Tambahkan file <code>${file}</code> di repository (contoh format: <code>data/notes/CONTOH.md</code>).</p>`);
    }
  }

  // ---------- Render: riwayat ----------
  function renderHistory() {
    const body = $('history-body');
    if (!state.weeks.length) { body.innerHTML = '<tr><td colspan="7" class="empty">Belum ada riwayat.</td></tr>'; return; }
    const rows = [];
    [...state.weeks].reverse().forEach((w) => {
      const sc = weekScore(w);
      const i = state.weeks.indexOf(w);
      rows.push(`<tr>
        <td>Minggu ${w.week}</td>
        <td>${fmtIso(w.start, { day: 'numeric', month: 'short' })} – ${fmtIso(w.end, { day: 'numeric', month: 'short', year: '2-digit' })}</td>
        <td class="mono">${w.level.min}–${w.level.max}</td>
        <td class="num">${sc.onTime}/${sc.count}</td>
        <td class="num">${sc.total}/${sc.count}</td>
        <td class="num">${(w.bonus || []).length ? `${bonusScore(w).done}/${bonusScore(w).count}` : '–'}</td>
        <td><button class="link-btn" data-open="${i}">Lihat</button></td>
      </tr>`);
      if (w.levelChange) {
        const lc = w.levelChange;
        const why = lc.type === 'auto' ? 'Naik level otomatis' : 'Level diubah manual';
        rows.push(`<tr class="lvl"><td colspan="7">${why}: ${lc.from.min}–${lc.from.max} → <strong>${lc.to.min}–${lc.to.max}</strong> mulai minggu ${w.week}</td></tr>`);
      }
    });
    body.innerHTML = rows.join('');
  }

  // ---------- Render: statistik ----------
  function renderStats() {
    const weeks = state.weeks;
    const allProblems = weeks.flatMap((w) => w.problems.map((p) => ({ p, s: statusOf(p, w) })));
    const solved = allProblems.filter((x) => x.s.kind === 'ok' || x.s.kind === 'late');
    const onTime = allProblems.filter((x) => x.s.kind === 'ok').length;

    let streak = 0;
    const cur = currentWeekIndex();
    for (let i = cur; i >= 0; i--) {
      const sc = weekScore(weeks[i]);
      if (sc.total >= Math.ceil(sc.count / 2)) streak++;
      else if (i !== cur) break;
    }
    const acTotal = new Set(state.subs.filter((s) => s.verdict === 'OK' && s.problem).map((s) => keyOf(s.problem))).size;

    $('stat-tiles').innerHTML = [
      [`${solved.length}/${allProblems.length}`, 'soal paket selesai'],
      [onTime, 'selesai tepat waktu'],
      [streak, 'minggu beruntun ≥ 50%'],
      [acTotal, 'total soal AC di Codeforces'],
      [`${weeks.reduce((n, w) => n + bonusScore(w).done, 0)}/${weeks.reduce((n, w) => n + (w.bonus || []).length, 0)}`, 'bonus soal OSN selesai'],
    ].map(([v, l]) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`).join('');

    renderChart(weeks);

    const tagCount = new Map();
    solved.forEach(({ p }) => p.tags.forEach((t) => tagCount.set(t, (tagCount.get(t) || 0) + 1)));
    bars($('tag-bars'), [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10), 'Belum ada soal yang selesai.');

    const byRating = new Map();
    allProblems.forEach(({ p, s }) => {
      const e = byRating.get(p.rating) || [0, 0];
      e[1]++;
      if (s.kind === 'ok' || s.kind === 'late') e[0]++;
      byRating.set(p.rating, e);
    });
    const ratingRows = [...byRating.entries()].sort((a, b) => a[0] - b[0]);
    const ul = $('rating-bars');
    ul.innerHTML = ratingRows.length ? ratingRows.map(([r, [d, t]]) => `<li>
      <span class="name rating ${rankClass(r)}">${r}</span>
      <span class="track"><span class="fill" style="width:${(d / t) * 100}%"></span></span>
      <span class="val">${d}/${t}</span></li>`).join('') : '<li class="muted">Belum ada data.</li>';
  }

  function bars(ul, entries, emptyText) {
    if (!entries.length) { ul.innerHTML = `<li class="muted">${emptyText}</li>`; return; }
    const max = Math.max(...entries.map((e) => e[1]));
    ul.innerHTML = entries.map(([name, v]) => `<li>
      <span class="name" title="${esc(name)}">${esc(name)}</span>
      <span class="track"><span class="fill" style="width:${(v / max) * 100}%"></span></span>
      <span class="val">${v}</span></li>`).join('');
  }

  function renderChart(weeks) {
    const el = $('chart');
    if (!weeks.length) { el.innerHTML = '<p class="muted">Grafik muncul setelah minggu pertama.</p>'; return; }
    const maxN = Math.max(...weeks.map((w) => w.problems.length));
    const barW = 28, gap = 14, padL = 28, padB = 24, padT = 10, h = 180;
    const width = Math.max(300, padL + weeks.length * (barW + gap) + gap);
    const y = (v) => padT + (h - padT - padB) * (1 - v / maxN);
    let svg = `<svg width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" role="img" aria-label="Soal selesai per minggu">`;
    for (let v = 0; v <= maxN; v += Math.max(1, Math.round(maxN / 4))) {
      svg += `<line class="grid" x1="${padL}" x2="${width}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    }
    weeks.forEach((w, i) => {
      const sc = weekScore(w);
      const x = padL + gap + i * (barW + gap);
      if (sc.onTime) svg += `<rect class="bar-on" x="${x}" y="${y(sc.onTime)}" width="${barW}" height="${y(0) - y(sc.onTime)}" rx="3"/>`;
      if (sc.late) svg += `<rect class="bar-late" x="${x}" y="${y(sc.total)}" width="${barW}" height="${y(sc.onTime) - y(sc.total)}" rx="3"/>`;
      svg += `<text x="${x + barW / 2}" y="${h - 6}" text-anchor="middle">M${w.week}</text>`;
    });
    el.innerHTML = svg + '</svg>';
  }

  // ---------- Render: kontes ----------
  const PLATFORM_CLASS = { Codeforces: 'cf', AtCoder: 'ac', 'TLX TOKI': 'tlx' };
  const TIER_LABEL = { cocok: 'Cocok', tantangan: 'Tantangan', lanjut: 'Lanjut' };

  function gcalDate(sec) {
    return new Date(sec * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  function calendarUrl(c) {
    const end = c.start + (c.duration || 7200);
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: `[${c.platform}] ${c.name}`,
      dates: `${gcalDate(c.start)}/${gcalDate(end)}`,
      details: `Kontes ${c.platform}: ${c.url}`,
    });
    return `https://calendar.google.com/calendar/render?${params}`;
  }

  function fmtDuration(sec) {
    if (!sec) return '';
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    if (h >= 48) return `${Math.round(h / 24)} hari`;
    return h ? `${h} jam${m ? ` ${m} mnt` : ''}` : `${m} mnt`;
  }

  const URGENT_SEC = 3 * 86400;

  function relTime(c, now) {
    const urgent = c.start - now < URGENT_SEC;
    const cls = urgent ? 'urgent' : 'calm';
    if (c.start <= now) return `<span class="when-badge urgent">Sedang berlangsung</span>`;
    const diff = c.start - now;
    let text;
    if (diff < 3600) text = `${Math.ceil(diff / 60)} menit lagi`;
    else if (diff < 86400) text = `${Math.floor(diff / 3600)} jam lagi`;
    else text = `${Math.floor(diff / 86400)} hari lagi`;
    return `<span class="when-badge ${cls}">${urgent ? 'Segera · ' : ''}${text}</span>`;
  }

  function kenInBadge(c) {
    if (c.platform !== 'Codeforces' || !c.id) return '';
    const mine = myContests().find((m) => m.platform === 'Codeforces' && m.id === c.id);
    if (!mine) return '';
    const solved = mine.problems.filter((p) => p.status === 'ok').length;
    return `<span class="ken-in">Ken ikut · ${solved} soal benar</span>`;
  }

  function contestItem(c, now) {
    const plat = PLATFORM_CLASS[c.platform] || '';
    const key = contestKey(c);
    const registered = state.sync.ok && !!state.sync.data.registered[key];
    const actions = [`<a href="${esc(c.url)}" target="_blank" rel="noopener">Buka</a>`];
    if (state.sync.ok && c.start > now) {
      actions.push(registered
        ? `<button class="mini-btn ghost" data-unreg="${key}" title="Hapus tanda terdaftar">Batal tanda</button>`
        : `<button class="mini-btn" data-reg="${key}">Tandai sudah daftar</button>`);
    }
    if (c.register && c.start > now && !registered) actions.unshift(`<a class="primary" href="${esc(c.register)}" target="_blank" rel="noopener">Daftar</a>`);
    if (c.start > now) actions.push(`<a href="${esc(calendarUrl(c))}" target="_blank" rel="noopener">+ Kalender</a>`);
    const urgency = c.start - now < URGENT_SEC ? 'urgent' : 'calm';
    return `<li class="contest ${urgency}${registered ? ' registered' : ''}">
      <div class="c-when"><span>${fmtDate(c.start, { weekday: 'short' })}</span><b>${fmtDate(c.start, { day: 'numeric' })}</b><span>${fmtDate(c.start, { month: 'short' })}</span></div>
      <div class="c-main">
        <a class="c-name" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>
        <div class="c-sub">
          <span class="c-plat ${plat}">${esc(c.platform)}</span>
          <span>${fmtDate(c.start, { hour: '2-digit', minute: '2-digit' })} WIB · ${fmtDuration(c.duration)}</span>
          <span class="tier ${c.tier}">${TIER_LABEL[c.tier] || c.tier}</span>
          ${registered ? '<span class="reg-badge">✓ Terdaftar</span>' : ''}
          ${relTime(c, now)}
          ${kenInBadge(c)}
        </div>
      </div>
      <div class="c-actions">${actions.join('')}</div>
    </li>`;
  }

  // ---------- Kontes yang diikuti Ken ----------
  const CF_PARTICIPANT = { CONTESTANT: 'resmi', OUT_OF_COMPETITION: 'tidak resmi', VIRTUAL: 'virtual' };

  // Gabungkan riwayat dari progress.json dengan submission Codeforces terbaru di browser,
  // sehingga kontes Codeforces yang sedang berlangsung langsung terlihat progresnya.
  function myContests() {
    const now = Date.now() / 1000;
    const list = (state.progress?.contestHistory || []).map((c) => ({ ...c }));
    const byCf = new Map();
    for (const s of state.subs) {
      const type = CF_PARTICIPANT[s.author?.participantType];
      if (!type || !s.contestId) continue;
      const e = byCf.get(s.contestId) || { type, start: s.author.startTimeSeconds, subs: [] };
      e.subs.push(s);
      byCf.set(s.contestId, e);
    }
    for (const [id, e] of byCf) {
      const sched = (state.contests?.contests || []).find((c) => c.platform === 'Codeforces' && c.id === String(id));
      let entry = list.find((c) => c.platform === 'Codeforces' && c.id === String(id));
      if (!entry) {
        entry = {
          platform: 'Codeforces', id: String(id), name: sched?.name || `Kontes Codeforces ${id}`,
          url: `https://codeforces.com/contest/${id}`, start: e.start, duration: sched?.duration ?? null,
          participation: e.type, rank: null, problems: [], rated: false,
        };
        list.push(entry);
      }
      const labels = new Set(entry.problems.map((p) => p.label));
      e.subs.forEach((s) => labels.add(s.problem.index));
      entry.problems = [...labels].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map((label) => {
        const mine = e.subs.filter((s) => s.problem.index === label);
        return { label, status: mine.some((s) => s.verdict === 'OK') ? 'ok' : mine.length ? 'tried' : 'none' };
      });
      const duration = entry.duration ?? sched?.duration;
      entry.live = !!duration && entry.start <= now && now < entry.start + duration;
    }
    return list.sort((a, b) => b.start - a.start);
  }

  function renderMyContests() {
    const ul = $('my-contest-list');
    const list = myContests();
    if (!list.length) {
      ul.innerHTML = '<li class="empty">Belum ada kontes yang diikuti. Kontes pertama akan muncul di sini setelah Ken mengirim jawaban.</li>';
      return;
    }
    ul.innerHTML = list.map((c) => {
      const solved = c.problems.filter((p) => p.status === 'ok').length;
      const chips = c.problems.map((p) => `<span class="pchip ${p.status}" title="${p.status === 'ok' ? 'Benar' : p.status === 'tried' ? 'Dicoba, belum benar' : 'Tidak dicoba'}">${esc(p.label)}${p.status === 'ok' ? ' ✓' : p.status === 'tried' ? ' ✗' : ''}</span>`).join('');
      let rating = '<span>unrated</span>';
      if (c.rated && c.newRating != null) {
        const d = c.newRating - (c.oldRating ?? 0);
        rating = `<span>rating ${c.oldRating} → ${c.newRating} <span class="${d >= 0 ? 'delta-up' : 'delta-down'}">(${d >= 0 ? '+' : ''}${d})</span></span>`;
        if (c.performance) rating += `<span>performa ${c.performance}</span>`;
      }
      const result = c.live
        ? `<b>${solved} soal</b>sedang berjalan`
        : `<b>${solved}/${c.problems.length}</b>${c.rank ? `peringkat ${c.rank.toLocaleString('id-ID')}` : 'soal benar'}`;
      return `<li class="contest ${c.live ? 'live' : ''}">
        <div class="c-when"><span>${fmtDate(c.start, { weekday: 'short' })}</span><b>${fmtDate(c.start, { day: 'numeric' })}</b><span>${fmtDate(c.start, { month: 'short', year: '2-digit' })}</span></div>
        <div class="c-main">
          <a class="c-name" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>
          <div class="c-sub">
            <span class="c-plat ${PLATFORM_CLASS[c.platform] || ''}">${esc(c.platform)}</span>
            ${c.live ? '<span class="when-badge urgent">Sedang berlangsung</span>' : ''}
            <span>${esc(c.participation || '')}</span>
            ${rating}
          </div>
          <div class="pchips">${chips}</div>
        </div>
        <div class="c-result">${result}</div>
      </li>`;
    }).join('');
  }

  function liveContests() {
    const now = Date.now() / 1000;
    return (state.contests?.contests || []).filter((c) => c.start + (c.duration || 0) > now);
  }

  function renderContests() {
    renderMyContests();
    const now = Date.now() / 1000;
    const list = $('contest-list');
    const updated = $('contest-updated');
    if (!state.contests) {
      list.innerHTML = '<li class="empty">Jadwal kontes belum tersedia. Jadwal diperbarui otomatis setiap hari oleh workflow "Jadwal Kontes".</li>';
      updated.textContent = '';
    } else {
      const show = { cocok: true, tantangan: $('f-tantangan').checked, lanjut: $('f-lanjut').checked };
      const items = liveContests().filter((c) => show[c.tier]);
      list.innerHTML = items.length ? items.map((c) => contestItem(c, now)).join('')
        : '<li class="empty">Tidak ada kontes dalam 45 hari ke depan untuk filter ini.</li>';
      const failed = state.contests.failed?.length ? ` · ${state.contests.failed.join(', ')} gagal diperbarui, memakai data lama` : '';
      updated.textContent = `Diperbarui ${new Intl.DateTimeFormat('id-ID', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(state.contests.updatedAt))} WIB${failed}`;
    }

    const next = liveContests().filter((c) => c.tier === 'cocok').slice(0, 3);
    $('next-contests').hidden = !next.length || state.tab === 'kontes';
    $('next-contest-list').innerHTML = next.map((c) => contestItem(c, now)).join('');
  }

  // ---------- Render: topik ----------
  const TAG_ID = {
    'implementation': 'Implementasi', 'math': 'Matematika', 'greedy': 'Greedy', 'brute force': 'Brute force',
    'constructive algorithms': 'Konstruktif', 'sortings': 'Pengurutan', 'strings': 'String', 'number theory': 'Teori bilangan',
    'dp': 'Dynamic programming', 'binary search': 'Binary search', 'two pointers': 'Two pointers', 'graphs': 'Graf',
    'dfs and similar': 'DFS/BFS', 'trees': 'Pohon (tree)', 'data structures': 'Struktur data', 'bitmasks': 'Bitmask',
    'combinatorics': 'Kombinatorika', 'geometry': 'Geometri', 'games': 'Permainan', 'dsu': 'DSU', 'shortest paths': 'Jalur terpendek',
    'hashing': 'Hashing', 'probabilities': 'Peluang', 'divide and conquer': 'Divide & conquer', 'interactive': 'Interaktif',
    'matrices': 'Matriks', 'graph matchings': 'Matching graf', 'string suffix structures': 'Struktur suffix', 'flows': 'Flow',
  };

  const shortDate = (sec) => fmtDate(sec, { day: 'numeric', month: 'short', year: '2-digit' });

  function dayDots(n) {
    if (!n) return '<span class="muted">–</span>';
    const dots = '<i></i>'.repeat(Math.min(n, 10));
    return `<span class="days"><span class="dots" aria-hidden="true">${dots}</span><span class="mono">${n}</span></span>`;
  }

  function renderCourses() {
    const el = $('courses');
    const courses = state.progress?.tlx?.courses;
    if (!courses?.length) {
      el.innerHTML = '<p class="muted">Data kursus TLX belum tersedia. Data diperbarui otomatis setiap 2 jam.</p>';
      return;
    }
    el.innerHTML = courses.map((c) => {
      const chapters = c.chapters.filter((ch) => ch.total > 0);
      const doneDays = chapters.filter((ch) => ch.doneAt).map((ch) => ch.activeDays).sort((a, b) => a - b);
      const median = doneDays.length ? doneDays[Math.floor(doneDays.length / 2)] : 0;
      const heavyAt = Math.max(4, median * 2);
      const solved = chapters.reduce((n, ch) => n + ch.solved, 0);
      const total = chapters.reduce((n, ch) => n + ch.total, 0);
      const doneCount = chapters.filter((ch) => ch.doneAt).length;
      const rows = chapters.map((ch) => {
        let status;
        if (ch.doneAt) status = `<span class="badge done">Tuntas</span>`;
        else if (ch.attempted) status = `<span class="badge open">Belum tuntas</span>`;
        else status = `<span class="badge idle">Belum mulai</span>`;
        if (ch.activeDays >= heavyAt) status += ` <span class="badge heavy" title="Butuh jauh lebih banyak hari daripada bab lain">Butuh waktu lama</span>`;
        const when = ch.firstAt ? `${shortDate(ch.firstAt)} → ${ch.doneAt ? shortDate(ch.doneAt) : 'sekarang'}` : '';
        const pct = ch.total ? (ch.solved / ch.total) * 100 : 0;
        return `<tr class="${ch.attempted ? '' : 'untouched'}">
          <td class="alias">${esc(ch.alias)}</td>
          <td class="tname">${esc(ch.name)}</td>
          <td><div class="solvebar"><span class="track"><span class="${ch.doneAt ? 'done' : ''}" style="width:${pct}%"></span></span><span class="val">${ch.solved}/${ch.total}</span></div></td>
          <td>${dayDots(ch.activeDays)}</td>
          <td class="when">${when}</td>
          <td>${status}</td>
        </tr>`;
      }).join('');
      return `<section class="topic-block">
        <div class="topic-head">
          <h2><a href="https://tlx.toki.id/courses/${esc(c.slug)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">${esc(c.name)}</a></h2>
          <div class="course-meter"><span class="track"><span class="${doneCount === chapters.length ? 'done' : ''}" style="width:${total ? (solved / total) * 100 : 0}%"></span></span>
            ${solved}/${total} soal · ${doneCount}/${chapters.length} bab tuntas</div>
        </div>
        <div class="table-scroll">
          <table class="topics">
            <thead><tr><th>Bab</th><th>Topik</th><th>Soal selesai</th><th>Hari aktif</th><th>Mulai → selesai</th><th>Status</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>`;
    }).join('');
  }

  function renderCfTopics() {
    const body = $('cf-topics');
    if (!state.subs.length) {
      body.innerHTML = '<tr><td colspan="4" class="empty">Belum ada data submission Codeforces.</td></tr>';
      return;
    }
    // Ringkas per soal: sudah AC atau belum, dan berapa kali submit sampai AC.
    const perProblem = new Map();
    for (const s of [...state.subs].sort((a, b) => a.creationTimeSeconds - b.creationTimeSeconds)) {
      if (!s.problem?.contestId) continue;
      const k = keyOf(s.problem);
      const e = perProblem.get(k) || { tags: s.problem.tags || [], tries: 0, solved: false, triesToAc: 0 };
      if (!e.solved) {
        e.tries++;
        if (s.verdict === 'OK') { e.solved = true; e.triesToAc = e.tries; }
      }
      perProblem.set(k, e);
    }
    const perTag = new Map();
    for (const e of perProblem.values()) {
      for (const t of e.tags) {
        const x = perTag.get(t) || { attempted: 0, solved: 0, tries: 0 };
        x.attempted++;
        if (e.solved) { x.solved++; x.tries += e.triesToAc; }
        perTag.set(t, x);
      }
    }
    const rows = [...perTag.entries()].sort((a, b) => b[1].attempted - a[1].attempted || b[1].solved - a[1].solved);
    body.innerHTML = rows.map(([tag, x]) => {
      const rate = x.solved / x.attempted;
      const avg = x.solved ? `${(x.tries / x.solved).toFixed(1)}×` : '–';
      let badge = '';
      if (x.attempted >= 3 && rate < 0.6) badge = '<span class="badge weak">Perlu latihan</span>';
      else if (x.solved >= 5 && rate >= 0.85 && x.tries / x.solved <= 2) badge = '<span class="badge done">Kuat</span>';
      return `<tr>
        <td class="tname">${esc(TAG_ID[tag] || tag)}</td>
        <td><div class="solvebar"><span class="track"><span class="${rate < 0.6 ? 'weak' : 'done'}" style="width:${rate * 100}%"></span></span><span class="val">${x.solved}/${x.attempted}</span></div></td>
        <td class="num">${avg}</td>
        <td>${badge}</td>
      </tr>`;
    }).join('');
  }

  function renderTopics() {
    renderCourses();
    renderCfTopics();
  }

  function renderAll() {
    renderProfile();
    renderWeek();
    renderHistory();
    renderStats();
    renderTopics();
    renderContests();
    renderSyncBox();
  }

  // ---------- Data ----------
  async function loadCodeforces() {
    const handle = state.config.handle;
    const banner = $('banner');
    if (!handle || handle.startsWith('GANTI_')) {
      banner.textContent = 'Isi "handle" di config.json dengan username Codeforces Ken agar status soal bisa dibaca.';
      banner.hidden = false;
      return;
    }
    try {
      const [users, subs] = await Promise.all([cf('user.info', { handles: handle }), cf('user.status', { handle })]);
      state.user = users[0];
      state.subs = subs;
      banner.hidden = true;
    } catch (e) {
      banner.textContent = `Status soal belum bisa dibaca dari Codeforces (${e.message}). Coba tekan "Perbarui status" beberapa saat lagi.`;
      banner.hidden = false;
    }
  }

  function selectTab(name) {
    state.tab = name;
    renderContests();
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    ['minggu', 'riwayat', 'statistik', 'topik', 'kontes'].forEach((t) => { $(`panel-${t}`).hidden = t !== name; });
  }

  async function init() {
    try {
      [state.config, state.weeks] = await Promise.all([getJson('config.json'), getJson('data/weeks.json')]);
    } catch (e) {
      $('banner').textContent = `Gagal memuat data situs: ${e.message}`;
      $('banner').hidden = false;
      return;
    }
    try { state.contests = await getJson('data/contests.json'); } catch (_) { state.contests = null; }
    try { state.progress = await getJson('data/progress.json'); } catch (_) { state.progress = null; }
    $('f-tantangan').checked = store('fTantangan') !== '0';
    $('f-lanjut').checked = store('fLanjut') === '1';
    $('title').textContent = `Latihan Mingguan ${state.config.displayName || ''}`.trim();
    document.title = $('title').textContent;
    state.viewIndex = currentWeekIndex();
    $('show-tags').checked = store('showTags') === '1';
    state.sync.url = state.config.firebase?.databaseURL || null;
    state.sync.pin = store('syncPin');
    renderAll();
    await Promise.all([loadCodeforces(), syncLoad()]);
    renderAll();
    // Ambil tanda terbaru dari perangkat lain setiap menit.
    setInterval(async () => {
      if (document.hidden || !state.sync.ok) return;
      if (await syncLoad()) renderAll();
    }, 60000);
  }

  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) selectTab(b.dataset.tab);
  });
  $('prev-week').addEventListener('click', () => { if (state.viewIndex > 0) { state.viewIndex--; renderWeek(); } });
  $('next-week').addEventListener('click', () => { if (state.viewIndex < state.weeks.length - 1) { state.viewIndex++; renderWeek(); } });
  $('show-tags').addEventListener('change', (e) => { store('showTags', e.target.checked ? '1' : '0'); renderWeek(); });
  $('refresh').addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Memperbarui…';
    await loadCodeforces();
    renderAll();
    e.target.disabled = false;
    e.target.textContent = 'Perbarui status';
  });
  $('f-tantangan').addEventListener('change', (e) => { store('fTantangan', e.target.checked ? '1' : '0'); renderContests(); });
  $('f-lanjut').addEventListener('change', (e) => { store('fLanjut', e.target.checked ? '1' : '0'); renderContests(); });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-goto]');
    if (b) selectTab(b.dataset.goto);
  });
  setInterval(renderContests, 60000);
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-start],[data-unstart],[data-reg],[data-unreg],[data-sync]');
    if (!t) return;
    const value = { at: Date.now() };
    if (t.dataset.start) syncWrite('started', t.dataset.start, value);
    else if (t.dataset.unstart) syncWrite('started', t.dataset.unstart, null);
    else if (t.dataset.reg) syncWrite('registered', t.dataset.reg, value);
    else if (t.dataset.unreg) syncWrite('registered', t.dataset.unreg, null);
    else if (t.dataset.sync === 'logout') {
      try { localStorage.removeItem('syncPin'); } catch (_) { /* abaikan */ }
      state.sync.pin = null;
      state.sync.ok = false;
      renderAll();
    }
  });
  document.addEventListener('submit', async (e) => {
    if (e.target.id !== 'sync-form') return;
    e.preventDefault();
    const input = $('sync-pin');
    const pin = input.value.trim();
    if (!pin) return;
    input.blur();
    state.sync.pin = pin;
    await syncLoad();
    if (state.sync.ok) store('syncPin', pin);
    else state.sync.pin = null;
    renderAll();
  });
  $('history-body').addEventListener('click', (e) => {
    const b = e.target.closest('[data-open]');
    if (!b) return;
    state.viewIndex = Number(b.dataset.open);
    selectTab('minggu');
    renderWeek();
  });

  init();
})();
