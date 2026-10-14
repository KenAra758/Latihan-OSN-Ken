// Riwayat kontes yang diikuti Ken di Codeforces dan AtCoder, beserta hasilnya.

const UA = { headers: { 'User-Agent': 'Mozilla/5.0 (latihan-ken contest history)' } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cf(method, params) {
  const url = new URL(`https://codeforces.com/api/${method}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  for (let attempt = 1; attempt <= 3; attempt++) {
    const body = await (await fetch(url, UA)).json().catch(() => null);
    if (body?.status === 'OK') return body.result;
    // Batas API Codeforces: sekitar 1 permintaan per 2 detik.
    await sleep(2500 * attempt);
  }
  throw new Error(`Codeforces ${method} gagal`);
}

const PARTICIPATIONS = { CONTESTANT: 'resmi', OUT_OF_COMPETITION: 'tidak resmi', VIRTUAL: 'virtual' };

// Catatan: API Codeforces tidak lagi memberi papan peringkat per peserta, jadi hasil dihitung
// dari submission Ken sendiri. Peringkat tersedia untuk kontes rated (dari riwayat rating).
export async function codeforcesHistory(handle, maxContests = 30) {
  const subs = await cf('user.status', { handle });
  const entries = new Map();
  for (const s of subs) {
    const type = PARTICIPATIONS[s.author?.participantType];
    if (!type || !s.contestId) continue;
    const e = entries.get(s.contestId) || { type, start: s.author.startTimeSeconds, subs: [] };
    e.subs.push(s);
    entries.set(s.contestId, e);
  }
  if (!entries.size) return [];
  const ids = [...entries.keys()].slice(0, maxContests); // submission terbaru lebih dulu

  await sleep(2100);
  const contests = new Map((await cf('contest.list', { gym: false })).map((c) => [c.id, c]));
  await sleep(2100);
  const { problems } = await cf('problemset.problems', {});
  await sleep(2100);
  const ratingChanges = new Map((await cf('user.rating', { handle })).map((r) => [r.contestId, r]));

  return ids.map((id) => {
    const e = entries.get(id);
    const c = contests.get(id);
    const rc = ratingChanges.get(id);
    const labels = problems.filter((p) => p.contestId === id).map((p) => p.index)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    for (const s of e.subs) if (!labels.includes(s.problem.index)) labels.push(s.problem.index);
    return {
      platform: 'Codeforces',
      id: String(id),
      name: c?.name || `Codeforces Round ${id}`,
      url: `https://codeforces.com/contest/${id}`,
      start: e.start || c?.startTimeSeconds,
      duration: c?.durationSeconds ?? null,
      participation: e.type,
      rank: rc?.rank ?? null,
      points: null,
      problems: labels.map((label) => {
        const mine = e.subs.filter((s) => s.problem.index === label);
        return { label, status: mine.some((s) => s.verdict === 'OK') ? 'ok' : mine.length ? 'tried' : 'none' };
      }),
      rated: !!rc,
      oldRating: rc?.oldRating ?? null,
      newRating: rc?.newRating ?? null,
      performance: null,
    };
  });
}

export async function atcoderHistory(handle, previous = []) {
  const history = await (await fetch(`https://atcoder.jp/users/${encodeURIComponent(handle)}/history/json`, UA)).json();
  if (!history.length) return [];
  // Tidak ada kontes baru: pakai hasil sebelumnya, tanpa mengunduh ulang data besar.
  if (previous.length === history.length) return previous;
  const [contests, contestProblems] = await Promise.all([
    fetch('https://kenkoooo.com/atcoder/resources/contests.json', UA).then((r) => r.json()),
    fetch('https://kenkoooo.com/atcoder/resources/contest-problem.json', UA).then((r) => r.json()),
  ]);
  const results = [];
  for (const h of history) {
    const id = h.ContestScreenName.split('.')[0];
    const c = contests.find((x) => x.id === id);
    const start = c?.start_epoch_second ?? Math.round(Date.parse(h.EndTime) / 1000) - 6000;
    const end = start + (c?.duration_second ?? 6000);
    await sleep(1100);
    const subs = await (await fetch(
      `https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${encodeURIComponent(handle)}&from_second=${start}`, UA
    )).json();
    const during = subs.filter((s) => s.contest_id === id && s.epoch_second <= end);
    const problems = contestProblems
      .filter((p) => p.contest_id === id)
      .sort((a, b) => a.problem_index.localeCompare(b.problem_index))
      .map((p) => {
        const mine = during.filter((s) => s.problem_id === p.problem_id);
        return {
          label: p.problem_index,
          status: mine.some((s) => s.result === 'AC') ? 'ok' : mine.length ? 'tried' : 'none',
        };
      });
    results.push({
      platform: 'AtCoder',
      id,
      name: c?.title || h.ContestNameEn || h.ContestName || id,
      url: `https://atcoder.jp/contests/${id}`,
      start,
      duration: end - start,
      participation: 'resmi',
      rank: h.Place,
      points: null,
      problems,
      rated: h.IsRated,
      oldRating: h.IsRated ? h.OldRating : null,
      newRating: h.IsRated ? h.NewRating : null,
      performance: h.IsRated ? h.Performance : null,
    });
  }
  return results;
}
