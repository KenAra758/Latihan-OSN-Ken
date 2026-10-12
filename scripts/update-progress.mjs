// Membaca progres Ken di situs yang tidak bisa diakses langsung dari browser
// (TLX TOKI dan AtCoder), lalu menyimpannya ke data/progress.json.
// Dijalankan berkala oleh GitHub Actions.
//
// Pemakaian: node scripts/update-progress.mjs

import fs from 'node:fs/promises';
import { tlxSubmissions, summarizeSubmissions } from './lib/tlx.mjs';

const ROOT = new URL('..', import.meta.url);
const CONFIG_FILE = new URL('config.json', ROOT);
const WEEKS_FILE = new URL('data/weeks.json', ROOT);
const OUT_FILE = new URL('data/progress.json', ROOT);

async function tlxProgress(username, weeks) {
  const bonusJids = new Set(weeks.flatMap((w) => (w.bonus || []).map((b) => b.problemJid)));
  const subs = await tlxSubmissions(username);
  const summary = summarizeSubmissions(subs);
  const problems = {};
  for (const jid of bonusJids) if (summary.has(jid)) problems[jid] = summary.get(jid);
  return { username, totalSubmissions: subs.length, problems };
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
      out.tlx = await tlxProgress(config.tlxUsername, weeks);
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
