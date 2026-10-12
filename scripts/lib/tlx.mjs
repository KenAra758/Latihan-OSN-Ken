// Pembantu untuk API publik TLX TOKI (https://tlx.toki.id).

const API = 'https://api.tlx.toki.id/v2';

async function get(path) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(API + path);
      if (res.ok) return res.json();
      lastError = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  throw new Error(`TLX ${path} gagal: ${lastError.message}`);
}

// Semua submission pemrograman milik `username`, dari yang terbaru.
export async function tlxSubmissions(username) {
  const all = [];
  let beforeId = null;
  for (let guard = 0; guard < 200; guard++) {
    const q = new URLSearchParams({ username });
    if (beforeId) q.set('beforeId', beforeId);
    const body = await get(`/submissions/programming?${q}`);
    const page = body.data.page;
    all.push(...page);
    // Di API TLX, "previous" berarti halaman yang lebih lama.
    if (!body.data.hasPreviousPage || !page.length) break;
    beforeId = page.at(-1).id;
  }
  return all;
}

// Ringkasan per soal: skor terbaik, jumlah submit, waktu pertama kali skor 100.
export function summarizeSubmissions(subs) {
  const byProblem = new Map();
  for (const s of [...subs].sort((a, b) => a.time - b.time)) {
    const e = byProblem.get(s.problemJid) || { best: 0, attempts: 0, solvedAt: null, lastAt: null };
    const score = s.latestGrading?.score ?? 0;
    e.attempts++;
    e.lastAt = Math.round(s.time / 1000);
    e.best = Math.max(e.best, score);
    if (score >= 100 && !e.solvedAt) e.solvedAt = Math.round(s.time / 1000);
    byProblem.set(s.problemJid, e);
  }
  return byProblem;
}

// Kumpulan soal pemrograman dari arsip TLX, diurutkan dari yang (biasanya) paling mudah:
// urutan arsip dulu (mis. OSN-P sebelum OSN), lalu posisi soal dalam paket (A sebelum B), lalu tahun terbaru.
export async function tlxPool(archiveSlugs) {
  const pool = [];
  for (const [archiveRank, archiveSlug] of archiveSlugs.entries()) {
    const sets = (await get(`/problemsets?archiveSlug=${encodeURIComponent(archiveSlug)}&page=1`)).data.page;
    for (const [setRank, set] of sets.entries()) {
      const body = await get(`/problemsets/${set.jid}/problems`);
      body.data
        .filter((p) => p.type === 'PROGRAMMING')
        .forEach((p, position) => {
          const meta = body.problemsMap[p.problemJid] || {};
          const titles = meta.titlesByLanguage || {};
          pool.push({
            problemJid: p.problemJid,
            set: set.name,
            setSlug: set.slug,
            alias: p.alias,
            name: (titles.id || titles.en || p.alias).trim(),
            url: `https://tlx.toki.id/problems/${set.slug}/${p.alias}`,
            _rank: [archiveRank, position, setRank],
          });
        });
    }
  }
  pool.sort((a, b) => a._rank[0] - b._rank[0] || a._rank[1] - b._rank[1] || a._rank[2] - b._rank[2]);
  return pool.map(({ _rank, ...p }) => p);
}
