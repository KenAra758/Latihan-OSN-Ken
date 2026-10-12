// Membaca progres Ken di situs yang tidak bisa diakses langsung dari browser
// (TLX TOKI dan AtCoder), lalu menyimpannya ke data/progress.json.
// Dijalankan berkala oleh GitHub Actions.
//
// Pemakaian: node scripts/update-progress.mjs

import fs from 'node:fs/promises';
import { tlxSubmissions, summarizeSubmissions, tlxCourse } from './lib/tlx.mjs';

const ROOT = new URL('..', import.meta.url);
const CONFIG_FILE = new URL('config.json', ROOT);
const WEEKS_FILE = new URL('data/weeks.json', ROOT);
const OUT_FILE = new URL('data/progress.json', ROOT);

const wibDate = (ms) => new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10);

// Ringkasan per bab kursus: berapa soal tuntas, kapan mulai/selesai, dan berapa hari aktif berlatih.
function chapterStats(chapter, subs) {
  const mine = subs.filter((s) => s.containerJid === chapter.jid).sort((a, b) => a.time - b.time);
  const summary = summarizeSubmissions(mine);
  const total = chapter.problemJids.length;
  const solvedTimes = chapter.problemJids.map((j) => summary.get(j)?.solvedAt).filter(Boolean);
  const complete = total > 0 && solvedTimes.length === total;
  const doneAt = complete ? Math.max(...solvedTimes) : null;
  const counted = complete ? mine.filter((s) => s.time / 1000 <= doneAt) : mine;
  return {
    alias: chapter.alias,
    name: chapter.name,
    total,
    solved: solvedTimes.length,
    attempted: chapter.problemJids.filter((j) => summary.has(j)).length,
    submissions: mine.length,
    firstAt: mine.length ? Math.round(mine[0].time / 1000) : null,
    lastAt: mine.length ? Math.round(mine.at(-1).time / 1000) : null,
    doneAt,
    activeDays: new Set(counted.map((s) => wibDate(s.time))).size,
  };
}

async function tlxProgress(username, weeks, courseSlugs) {
  const bonusJids = new Set(weeks.flatMap((w) => (w.bonus || []).map((b) => b.problemJid)));
  const subs = await tlxSubmissions(username);
  const summary = summarizeSubmissions(subs);
  const problems = {};
  for (const jid of bonusJids) if (summary.has(jid)) problems[jid] = summary.get(jid);
  const courses = [];
  for (const slug of courseSlugs) {
    const course = await tlxCourse(slug);
    courses.push({ slug, name: course.name, chapters: course.chapters.map((ch) => chapterStats(ch, subs)) });
  }
  return { username, totalSubmissions: subs.length, problems, courses };
}

async function atcoderProgress(handle) {
  const ua = { headers: { 'User-Agent': 'Mozilla/5.0 (latihan-ken progress)' } };
  const history = await (await fetch(`https://atcoder.jp/users/${encodeURIComponent(handle)}/history/json`, ua)).json();
  const rated = history.filter((h) => h.IsRated);
  let acCount = null;
  try {
    const rank = await (await fetch(`https://kenkoooo.com/atcoder/atcoder-api/v3/user/ac_rank?user=${encodeURIComponent(handle)}`, ua)).json();
    acCount = rank.count ?? null;
  } catch (_) { /* opsional */ }
  return {
    handle,
    rating: rated.length ? rated.at(-1).NewRating : null,
    ratedContests: rated.length,
    contests: history.length,
    acCount,
  };
}

async function main() {
  const config = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8'));
  const weeks = JSON.parse(await fs.readFile(WEEKS_FILE, 'utf8'));
  let previous = {};
  try { previous = JSON.parse(await fs.readFile(OUT_FILE, 'utf8')); } catch (_) { /* belum ada */ }

  const out = { ...previous };
  if (config.tlxUsername) {
    try {
      out.tlx = await tlxProgress(config.tlxUsername, weeks, config.tlxCourses || []);
      console.log(`TLX: ${out.tlx.totalSubmissions} submission, ${Object.keys(out.tlx.problems).length} soal bonus pernah dicoba.`);
    } catch (e) {
      console.warn(`TLX gagal: ${e.message}`);
    }
  }
  if (config.atcoderHandle) {
    try {
      out.atcoder = await atcoderProgress(config.atcoderHandle);
      console.log(`AtCoder: rating ${out.atcoder.rating ?? 'unrated'}, ${out.atcoder.acCount ?? '?'} AC.`);
    } catch (e) {
      console.warn(`AtCoder gagal: ${e.message}`);
    }
  }

  // Hanya tulis jika isinya berubah, agar tidak ada commit kosong.
  const { updatedAt: _a, ...before } = previous;
  const { updatedAt: _b, ...after } = out;
  if (JSON.stringify(before) === JSON.stringify(after)) {
    console.log('Tidak ada perubahan progres.');
    return;
  }
  out.updatedAt = new Date().toISOString();
  await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
  console.log('progress.json diperbarui.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
