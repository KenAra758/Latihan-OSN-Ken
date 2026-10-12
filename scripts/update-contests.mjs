// Mengumpulkan jadwal kontes terdekat dari Codeforces, AtCoder, dan TLX TOKI
// lalu menyimpannya ke data/contests.json. Dijalankan setiap hari oleh GitHub Actions.
//
// Pemakaian: node scripts/update-contests.mjs

import fs from 'node:fs/promises';

const OUT_FILE = new URL('../data/contests.json', import.meta.url);
const HORIZON_DAYS = 45;
const UA = { 'User-Agent': 'Mozilla/5.0 (latihan-ken contest calendar)' };

async function fetchText(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

// Pengelompokan kontes untuk Ken:
//   "cocok"     -> ramah pemula / persiapan OSN, ikuti rutin
//   "tantangan" -> soal awalnya masih terjangkau, bagus untuk dicoba
//   "lanjut"    -> untuk level tinggi atau format khusus (heuristic)
function tierOf(platform, name) {
  if (platform === 'TLX TOKI') return 'cocok';
  if (platform === 'Codeforces') {
    if (/Div\.\s*[34]|Educational/i.test(name)) return 'cocok';
    if (/Div\.\s*2/i.test(name)) return 'tantangan';
    return 'lanjut';
  }
  if (platform === 'AtCoder') {
    if (/Beginner Contest/i.test(name)) return 'cocok';
    if (/Regular Contest/i.test(name)) return 'tantangan';
    return 'lanjut';
  }
  return 'lanjut';
}

async function codeforces() {
  const body = JSON.parse(await fetchText('https://codeforces.com/api/contest.list?gym=false'));
  if (body.status !== 'OK') throw new Error(body.comment);
  return body.result
    .filter((c) => c.phase === 'BEFORE' || c.phase === 'CODING')
    .map((c) => ({
      platform: 'Codeforces',
      name: c.name,
      start: c.startTimeSeconds,
      duration: c.durationSeconds,
      url: c.phase === 'BEFORE' ? 'https://codeforces.com/contests' : `https://codeforces.com/contest/${c.id}`,
      register: c.phase === 'BEFORE' ? `https://codeforces.com/contestRegistration/${c.id}` : null,
    }));
}

async function atcoder() {
  const html = await fetchText('https://atcoder.jp/contests/?lang=en');
  const contests = [];
  for (const id of ['contest-table-action', 'contest-table-upcoming']) {
    const at = html.indexOf(`id="${id}"`);
    if (at === -1) continue;
    const table = html.slice(at, html.indexOf('</table>', at));
    for (const row of table.split('<tr').slice(1)) {
      const time = row.match(/iso=(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
      const link = row.match(/href="\/contests\/([a-z0-9_-]+)">([^<]+)</i);
      const dur = row.match(/>\s*(\d{2,3}):(\d{2})\s*</);
      if (!time || !link) continue;
      const [, y, mo, d, h, mi] = time.map(Number);
      // Waktu AtCoder dalam JST (UTC+9)
      const start = Date.UTC(y, mo - 1, d, h - 9, mi) / 1000;
      contests.push({
        platform: 'AtCoder',
        name: link[2].trim().replace(/&amp;/g, '&'),
        start,
        duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 : null,
        url: `https://atcoder.jp/contests/${link[1]}`,
        register: null,
      });
    }
  }
  return contests;
}

async function tlx() {
  const body = JSON.parse(await fetchText('https://api.tlx.toki.id/v2/contests?page=1'));
  return body.data.page.map((c) => ({
    platform: 'TLX TOKI',
    name: c.name,
    start: Math.round(c.beginTime / 1000),
    duration: Math.round(c.duration / 1000),
    url: `https://tlx.toki.id/contests/${c.slug}`,
    register: null,
  }));
}

async function main() {
  const now = Date.now() / 1000;
  const horizon = now + HORIZON_DAYS * 86400;
  const sources = { Codeforces: codeforces, AtCoder: atcoder, 'TLX TOKI': tlx };

  let previous = { contests: [] };
  try { previous = JSON.parse(await fs.readFile(OUT_FILE, 'utf8')); } catch (_) { /* file belum ada */ }

  const all = [];
  const failed = [];
  for (const [platform, load] of Object.entries(sources)) {
    try {
      const list = await load();
      all.push(...list);
      console.log(`${platform}: ${list.length} kontes`);
    } catch (e) {
      failed.push(platform);
      console.warn(`${platform} gagal (${e.message}); memakai data sebelumnya.`);
      all.push(...previous.contests.filter((c) => c.platform === platform));
    }
  }

  const contests = all
    .filter((c) => c.start + (c.duration || 0) > now && c.start < horizon)
    .map((c) => ({ ...c, tier: tierOf(c.platform, c.name) }))
    .sort((a, b) => a.start - b.start);

  await fs.writeFile(OUT_FILE, JSON.stringify({ updatedAt: new Date().toISOString(), failed, contests }, null, 2) + '\n');
  console.log(`Tersimpan ${contests.length} kontes (${contests.filter((c) => c.tier === 'cocok').length} cocok untuk Ken).`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
