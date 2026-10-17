// Membuat paket soal mingguan dari Codeforces.
//
// Pemakaian:
//   node scripts/generate-week.mjs                 -> buat paket minggu ini (jika belum ada)
//   node scripts/generate-week.mjs --regenerate    -> ganti paket minggu ini dengan soal baru
//   node scripts/generate-week.mjs --min 900 --max 1500   -> ubah level secara manual
//   node scripts/generate-week.mjs --date 2026-10-19      -> anggap "hari ini" tanggal tsb (untuk uji)
//
// Variabel lingkungan (dipakai GitHub Actions): MIN_RATING, MAX_RATING, REGENERATE=true, CF_HANDLE.

import fs from 'node:fs/promises';
import { tlxPool, tlxSubmissions, summarizeSubmissions } from './lib/tlx.mjs';

const ROOT = new URL('..', import.meta.url);
const CONFIG_FILE = new URL('config.json', ROOT);
const WEEKS_FILE = new URL('data/weeks.json', ROOT);
const LABELS = 'ABCDEFGHIJKLMNOP';
const DAY_MS = 24 * 60 * 60 * 1000;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--regenerate') args.regenerate = true;
    else if (a === '--min') args.min = Number(argv[++i]);
    else if (a === '--max') args.max = Number(argv[++i]);
    else if (a === '--date') args.date = argv[++i];
  }
  if (process.env.MIN_RATING) args.min = Number(process.env.MIN_RATING);
  if (process.env.MAX_RATING) args.max = Number(process.env.MAX_RATING);
  if (process.env.REGENERATE === 'true') args.regenerate = true;
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cf(method, params = {}) {
  const url = new URL(`https://codeforces.com/api/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url);
      const body = await res.json().catch(() => null);
      if (body?.status === 'OK') return body.result;
      lastError = new Error(body?.comment || `HTTP ${res.status}`);
      if (body?.comment?.includes('not found')) break;
    } catch (e) {
      lastError = e;
    }
    await sleep(2500 * attempt);
  }
  throw new Error(`Codeforces API ${method} gagal: ${lastError?.message}`);
}

// Senin (WIB) dari minggu yang memuat tanggal `now`, dalam format YYYY-MM-DD.
function weekStartOf(now, tzHours) {
  const local = new Date(now.getTime() + tzHours * 3600 * 1000);
  const dow = (local.getUTCDay() + 6) % 7; // Senin = 0
  const monday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - dow * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  return new Date(Date.parse(isoDate + 'T00:00:00Z') + days * DAY_MS).toISOString().slice(0, 10);
}

// Batas akhir minggu (Senin berikutnya 00:00 waktu lokal) dalam detik Unix.
function weekEndSeconds(startIso, tzHours) {
  return (Date.parse(addDays(startIso, 7) + 'T00:00:00Z') - tzHours * 3600 * 1000) / 1000;
}

function hashString(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function mulberry32(seed) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const keyOf = (p) => `${p.contestId}${p.index}`;
const nameKey = (p) => p.name.trim().toLowerCase();

// Rating target yang tersebar rata dari min ke max, dibulatkan ke kelipatan 100.
function ratingTargets(min, max, count) {
  if (count === 1) return [min];
  return Array.from({ length: count }, (_, i) => Math.round((min + ((max - min) * i) / (count - 1)) / 100) * 100);
}

function pickProblems(candidates, targets, rng) {
  const chosen = [];
  const chosenKeys = new Set();
  const tagCount = new Map();

  for (const target of targets) {
    let pool = [];
    // Cari rating tepat; jika habis, perlebar pencarian ±100, ±200, ...
    for (let delta = 0; delta <= 600 && pool.length === 0; delta += 100) {
      pool = candidates.filter(
        (p) => !chosenKeys.has(keyOf(p)) && (p.rating === target - delta || p.rating === target + delta)
      );
    }
    if (pool.length === 0) continue;

    // Utamakan soal dengan tag yang belum banyak muncul agar topiknya bervariasi.
    const overlap = (p) => p.tags.reduce((sum, t) => sum + (tagCount.get(t) || 0), 0);
    const best = Math.min(...pool.map(overlap));
    const finalists = pool.filter((p) => overlap(p) <= best + 1);
    const pick = finalists[Math.floor(rng() * finalists.length)];

    chosen.push(pick);
    chosenKeys.add(keyOf(pick));
    for (const t of pick.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  }
  return chosen.sort((a, b) => a.rating - b.rating);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8'));
  const weeks = JSON.parse(await fs.readFile(WEEKS_FILE, 'utf8'));
  const handle = process.env.CF_HANDLE || config.handle;
  const tz = config.timezoneOffsetHours ?? 7;

  if (!handle || handle.startsWith('GANTI_')) {
    throw new Error('Isi "handle" di config.json dengan username Codeforces Ken terlebih dahulu.');
  }

  const now = args.date ? new Date(Date.parse(args.date + 'T12:00:00Z') - tz * 3600 * 1000) : new Date();
  const start = weekStartOf(now, tz);
  const existingIndex = weeks.findIndex((w) => w.start === start);

  if (existingIndex !== -1 && !args.regenerate && args.min == null && args.max == null) {
    const week = weeks[existingIndex];
    if (config.tlxBonus?.enabled && !week.bonus) {
      week.bonus = await pickTlxBonus(config, weeks, existingIndex);
      await fs.writeFile(WEEKS_FILE, JSON.stringify(weeks, null, 2) + '\n');
      printBonus(week.bonus);
      return;
    }
    console.log(`Paket minggu ${start} sudah ada. Tidak ada perubahan.`);
    return;
  }

  console.log(`Mengambil data Codeforces untuk ${handle}...`);
  const submissions = await cf('user.status', { handle });
  const { problems } = await cf('problemset.problems');

  const solvedKeys = new Set();
  const solvedNames = new Set();
  const attemptedKeys = new Set();
  const attemptedNames = new Set();
  for (const s of submissions) {
    if (!s.problem?.contestId) continue;
    attemptedKeys.add(keyOf(s.problem));
    attemptedNames.add(nameKey(s.problem));
    if (s.verdict === 'OK') {
      solvedKeys.add(keyOf(s.problem));
      solvedNames.add(nameKey(s.problem));
    }
  }

  // --- Tentukan level minggu ini ---
  let levelChange = null;
  if (args.min != null || args.max != null) {
    const min = args.min ?? config.level.min;
    const max = args.max ?? config.level.max;
    if (!(min >= 800 && max >= min && max <= 3500)) throw new Error(`Rentang rating tidak valid: ${min}-${max}`);
    if (min !== config.level.min || max !== config.level.max) {
      levelChange = { type: 'manual', from: { ...config.level }, to: { min, max } };
      config.level = { min, max };
    }
  } else if (existingIndex === -1 && config.autoPromote?.enabled) {
    const rule = config.autoPromote;
    const recent = weeks.slice(-rule.consecutiveWeeks);
    const qualifies =
      recent.length === rule.consecutiveWeeks &&
      recent.every(
        (w) =>
          w.level.min === config.level.min &&
          w.level.max === config.level.max &&
          w.problems.filter((p) => solvedKeys.has(keyOf(p))).length >= rule.minSolved
      );
    if (qualifies && config.level.max + rule.step <= rule.maxRatingCap) {
      const to = { min: config.level.min + rule.step, max: config.level.max + rule.step };
      levelChange = { type: 'auto', from: { ...config.level }, to };
      config.level = to;
      console.log(`Naik level otomatis: ${to.min}-${to.max}`);
    }
  }

  // --- Pilih soal ---
  const usedKeys = new Set(
    weeks.filter((_, i) => i !== existingIndex).flatMap((w) => w.problems.map(keyOf))
  );
  const excludeTags = new Set(config.excludeTags || []);
  const candidates = problems.filter(
    (p) =>
      p.rating &&
      p.contestId >= (config.minContestId || 0) &&
      p.rating >= config.level.min - 600 &&
      p.rating <= config.level.max + 600 &&
      !p.tags.some((t) => excludeTags.has(t)) &&
      !attemptedKeys.has(keyOf(p)) &&
      !attemptedNames.has(nameKey(p)) &&
      !usedKeys.has(keyOf(p))
  );

  const count = config.problemsPerWeek || 8;
  const weekNumber = existingIndex === -1 ? (weeks.at(-1)?.week ?? 0) + 1 : weeks[existingIndex].week;
  const rng = mulberry32(hashString(`${handle}:${start}:${args.regenerate ? Date.now() : ''}`));
  const targets = ratingTargets(config.level.min, config.level.max, count);

  // Soal lama yang belum selesai boleh muncul lagi, asalkan sudah diselingi minimal `gapWeeks` minggu.
  const recycled = [];
  if (config.recycle?.enabled) {
    const isSolved = (p) => solvedKeys.has(keyOf(p)) || solvedNames.has(nameKey(p));
    const pool = recyclePool(weeks, existingIndex, weekNumber, config.recycle, (w) => w.problems, keyOf)
      .filter(({ item }) => !isSolved(item) && item.rating >= config.level.min && item.rating <= config.level.max);
    for (const { item, firstWeek, times } of pool) {
      if (recycled.length >= (config.recycle.maxPerWeek ?? 3)) break;
      // Ambil slot rating yang paling dekat (selisih maksimal 100).
      let best = -1;
      targets.forEach((t, i) => {
        if (Math.abs(t - item.rating) <= 100 && (best === -1 || Math.abs(t - item.rating) < Math.abs(targets[best] - item.rating))) best = i;
      });
      if (best === -1) continue;
      targets.splice(best, 1);
      recycled.push({ ...item, repeatFrom: firstWeek, repeatCount: times });
    }
  }

  const freshCandidates = candidates.filter((p) => !recycled.some((r) => keyOf(r) === keyOf(p)));
  const picked = [...recycled, ...pickProblems(freshCandidates, targets, rng)].sort((a, b) => a.rating - b.rating);
  if (picked.length < count) throw new Error(`Hanya menemukan ${picked.length} soal untuk rentang ${config.level.min}-${config.level.max}.`);

  const week = {
    week: weekNumber,
    start,
    end: addDays(start, 6),
    deadline: weekEndSeconds(start, tz),
    level: { ...config.level },
    generatedAt: new Date().toISOString(),
    problems: picked.map((p, i) => ({
      label: LABELS[i],
      contestId: p.contestId,
      index: p.index,
      name: p.name,
      rating: p.rating,
      tags: p.tags,
      ...(p.repeatFrom ? { repeatFrom: p.repeatFrom, repeatCount: p.repeatCount } : {}),
    })),
  };
  if (levelChange) week.levelChange = levelChange;
  if (config.tlxBonus?.enabled) {
    week.bonus = existingIndex !== -1 && weeks[existingIndex].bonus && !args.regenerate
      ? weeks[existingIndex].bonus
      : await pickTlxBonus(config, weeks, existingIndex);
  }

  if (existingIndex === -1) weeks.push(week);
  else weeks[existingIndex] = week;

  await fs.writeFile(WEEKS_FILE, JSON.stringify(weeks, null, 2) + '\n');
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');

  console.log(`Minggu ke-${week.week} (${week.start} s/d ${week.end}), level ${week.level.min}-${week.level.max}:`);
  for (const p of week.problems) console.log(`  ${p.label}. [${p.rating}] ${p.contestId}${p.index} ${p.name}`);
  if (week.bonus) printBonus(week.bonus);
}

// Soal dari minggu-minggu sebelumnya yang boleh muncul lagi: terakhir muncul paling lambat
// `gapWeeks + 1` minggu lalu (jadi ada minggu selingan), dan belum melebihi `maxAppearances`.
// Urutan: yang paling lama tidak muncul lebih dulu.
function recyclePool(weeks, skipIndex, weekNumber, rule, pick, keyFn) {
  const gap = rule.gapWeeks ?? 1;
  const maxAppearances = rule.maxAppearances ?? 3;
  const seen = new Map();
  weeks.forEach((w, i) => {
    if (i === skipIndex) return;
    for (const item of pick(w) || []) {
      const k = keyFn(item);
      const e = seen.get(k) || { item, firstWeek: w.week, lastWeek: w.week, times: 0 };
      e.item = item;
      e.lastWeek = Math.max(e.lastWeek, w.week);
      e.firstWeek = Math.min(e.firstWeek, w.week);
      e.times++;
      seen.set(k, e);
    }
  });
  return [...seen.values()]
    .filter((e) => e.lastWeek <= weekNumber - gap - 1 && e.times < maxAppearances)
    .sort((a, b) => a.lastWeek - b.lastWeek || a.firstWeek - b.firstWeek);
}

// Soal bonus dari arsip OSN di TLX: ambil soal termudah yang belum pernah dipakai dan belum diselesaikan Ken.
// Bonus lama yang belum skor 100 bisa kembali setelah diselingi minggu (lihat `recycle` di config).
async function pickTlxBonus(config, weeks, skipIndex) {
  const { perWeek = 2, archives = ['osp', 'osn'] } = config.tlxBonus;
  const weekNumber = skipIndex !== -1 ? weeks[skipIndex].week : (weeks.at(-1)?.week ?? 0) + 1;
  const used = new Set(
    weeks.filter((_, i) => i !== skipIndex).flatMap((w) => (w.bonus || []).map((b) => b.problemJid))
  );
  let solved = new Map();
  if (config.tlxUsername) {
    console.log(`Mengambil submission TLX untuk ${config.tlxUsername}...`);
    solved = summarizeSubmissions(await tlxSubmissions(config.tlxUsername));
  }
  const notSolved = (jid) => (solved.get(jid)?.best ?? 0) < 100;

  const chosen = [];
  if (config.recycle?.enabled) {
    const strip = ({ label, repeatFrom, repeatCount, ...b }) => b;
    const back = recyclePool(weeks, skipIndex, weekNumber, config.recycle, (w) => w.bonus, (b) => b.problemJid)
      .filter(({ item }) => notSolved(item.problemJid))
      .slice(0, Math.min(config.recycle.maxBonusPerWeek ?? 1, perWeek));
    for (const { item, firstWeek, times } of back) chosen.push({ ...strip(item), repeatFrom: firstWeek, repeatCount: times });
  }

  const pool = await tlxPool(archives);
  for (const p of pool) {
    if (chosen.length >= perWeek) break;
    if (!used.has(p.problemJid) && notSolved(p.problemJid)) chosen.push(p);
  }
  return chosen.map((p, i) => ({ label: `Bonus ${i + 1}`, ...p }));
}

function printBonus(bonus) {
  console.log('Soal bonus OSN (TLX):');
  for (const b of bonus) console.log(`  ${b.label}. ${b.set} ${b.alias} - ${b.name}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
