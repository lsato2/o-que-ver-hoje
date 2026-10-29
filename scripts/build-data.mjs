// Gera data.json com os dados reais do dia (TMDB), usados pelo site no lugar dos exemplos.
// Roda todo dia no GitHub Actions; a chave fica num secret do repositório, nunca no código.
//   TMDB_KEY  (obrigatória)  chave v3 da API do TMDB
//   OMDB_KEY  (opcional)     chave do OMDb para a nota IMDb
//   PREV_URL  (opcional)     data.json publicado anteriormente, para reaproveitar notas IMDb
import fs from 'node:fs';

const KEY = process.env.TMDB_KEY;
const OMDB = process.env.OMDB_KEY || '';
if (!KEY) throw new Error('TMDB_KEY não definida');

const PLATFORMS = { netflix: '8', prime: '119', disney: '337', hbo: '1899|384', apple: '350', paramount: '531' };
const PROVIDER_MAP = { 8: 'netflix', 1796: 'netflix', 119: 'prime', 9: 'prime', 337: 'disney', 1899: 'hbo', 384: 'hbo', 350: 'apple', 531: 'paramount' };
const PAGES = 4; // 4 páginas x 20 títulos por plataforma e tipo
const OMDB_LIMIT = 900; // plano grátis do OMDb: 1000 consultas/dia

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tmdb(path, params = {}){
  const qs = new URLSearchParams({ api_key: KEY, language: 'pt-BR', ...params });
  for (let i = 0; ; i++) {
    const r = await fetch(`https://api.themoviedb.org/3${path}?${qs}`);
    if (r.ok) return r.json();
    if (r.status === 401 || i >= 3) throw new Error(`TMDB ${r.status} em ${path}`);
    await sleep(1000 * (i + 1));
  }
}
async function pool(list, n, fn){
  const q = [...list];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); }));
}
const key = (type, id) => (type === 'movie' ? 'm' : 't') + id;
const fmtRuntime = m => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + m % 60 + 'min' : ''}` : `${m}min`;

// 1) Mais populares hoje em cada plataforma (Brasil, assinatura)
const tops = { movie: {}, tv: {} };
const seen = new Map();
for (const type of ['movie', 'tv']) for (const [pf, ids] of Object.entries(PLATFORMS)) {
  for (let page = 1; page <= PAGES; page++) {
    const j = await tmdb(`/discover/${type}`, { watch_region: 'BR', with_watch_monetization_types: 'flatrate', with_watch_providers: ids, sort_by: 'popularity.desc', page });
    const results = j.results.filter(r => r.poster_path);
    if (page === 1) tops[type][pf] = results.slice(0, 10).map(r => key(type, r.id));
    for (const r of results) if (!seen.has(key(type, r.id))) seen.set(key(type, r.id), { type, tid: r.id, from: pf, pop: r.popularity });
  }
}
console.log(`${seen.size} títulos únicos`);

// 2) Detalhes: duração/temporadas, onde assistir, id IMDb
let prevImdb = {};
if (process.env.PREV_URL) {
  try { (await (await fetch(process.env.PREV_URL)).json()).items.forEach(x => { if (x.imdb && x.ir) prevImdb[x.imdb] = x.ir; }); } catch {}
}
const items = [];
await pool([...seen.entries()], 8, async ([id, m]) => {
  const d = await tmdb(`/${m.type}/${m.tid}`, { append_to_response: 'watch/providers,external_ids' });
  let s = d.overview;
  if (!s) s = (await tmdb(`/${m.type}/${m.tid}`, { language: 'en-US' })).overview || '';
  const flat = d['watch/providers']?.results?.BR?.flatrate || [];
  const ps = [...new Set(flat.map(v => PROVIDER_MAP[v.provider_id]).filter(Boolean))];
  if (!ps.length) ps.push(m.from);
  const n = d.number_of_seasons;
  items.push({
    id, type: m.type,
    t: d.title || d.name, o: d.original_title || d.original_name,
    y: (d.release_date || d.first_air_date || '').slice(0, 4),
    ts: Math.round((d.vote_average || 0) * 10) / 10, vc: d.vote_count || 0,
    pop: Math.round(m.pop),
    g: (d.genres || []).map(g => g.id),
    s, p: ps.includes(m.from) ? m.from : ps[0], ps,
    dur: m.type === 'movie' ? (d.runtime ? fmtRuntime(d.runtime) : '') : (n ? `${n} temporada${n > 1 ? 's' : ''}` : ''),
    img: [d.poster_path, d.backdrop_path || d.poster_path],
    imdb: d.external_ids?.imdb_id || d.imdb_id || ''
  });
});

// 3) Nota IMDb (opcional, via OMDb), reaproveitando as do dia anterior
let omdbCalls = 0;
for (const x of items) {
  if (!x.imdb) continue;
  if (prevImdb[x.imdb]) { x.ir = prevImdb[x.imdb]; continue; }
  if (!OMDB || omdbCalls >= OMDB_LIMIT) continue;
  omdbCalls++;
  try {
    const o = await (await fetch(`https://www.omdbapi.com/?i=${x.imdb}&apikey=${OMDB}`)).json();
    const v = parseFloat(o.imdbRating);
    if (v) x.ir = v;
  } catch {}
}

items.sort((a, b) => b.pop - a.pop);
fs.writeFileSync('data.json', JSON.stringify({ updated: new Date().toISOString(), tops, items }));
console.log(`data.json: ${items.length} títulos, ${items.filter(x => x.ir).length} com nota IMDb, ${(fs.statSync('data.json').size / 1024).toFixed(0)} KB`);
