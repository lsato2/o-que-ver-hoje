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
const GENRES = { 28:'ação',12:'aventura',16:'animação',35:'comédia',80:'crime',99:'documentário',18:'drama',10751:'família',14:'fantasia',36:'história',27:'terror',10402:'música',9648:'mistério',10749:'romance',878:'ficção científica',10770:'filme de TV',53:'suspense',10752:'guerra',37:'faroeste',10759:'ação e aventura',10762:'infantil',10763:'notícias',10764:'reality',10765:'ficção e fantasia',10766:'novela',10767:'talk show',10768:'guerra e política' };
// sinopse sempre em português: pt-BR → pt-PT → descrição curta gerada (nunca em inglês)
function sinopse(d, type){
  if (d.overview?.trim()) return [d.overview.trim(), 'br'];
  const tr = d.translations?.translations || [];
  const pt = tr.find(t => t.iso_639_1 === 'pt' && t.iso_3166_1 === 'BR' && t.data?.overview?.trim())
          || tr.find(t => t.iso_639_1 === 'pt' && t.data?.overview?.trim());
  if (pt) return [pt.data.overview.trim(), 'pt'];
  const g = (d.genres || []).map(x => GENRES[x.id]).filter(Boolean).slice(0, 2);
  const tipo = type === 'movie' ? 'Filme' : 'Série';
  const ano = (d.release_date || d.first_air_date || '').slice(0, 4);
  return [`${tipo}${g.length ? ' de ' + g.join(' e ') : ''}${ano ? (type === 'movie' ? ' lançado em ' : ' que estreou em ') + ano : ''}. A sinopse em português ainda não foi publicada.`, 'gen'];
}
// título legível: se vier em alfabeto não latino (ex.: japonês, telugu), usa o nome em português ou o internacional
function titulo(d){
  const t = d.title || d.name;
  if (!/[^\p{Script=Latin}\p{N}\p{P}\p{Z}\p{S}]/u.test(t)) return t;
  const tr = d.translations?.translations || [];
  const pick = l => tr.find(x => x.iso_639_1 === l && (x.data?.title || x.data?.name))?.data;
  const alt = pick('pt') || pick('en') || pick('es');
  return alt?.title || alt?.name || t;
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

// 1b) Top 10 OFICIAL da Netflix no Brasil (semanal, publicado pela Netflix em top10.netflix.com)
//     As outras plataformas não publicam ranking: no site elas aparecem como "Em alta", sem numeração.
const ascii = t => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
async function findOnNetflix(type, title, fresh, week){
  const res = (await tmdb(`/search/${type}`, { query: title, language: 'en-US' })).results || [];
  const exact = res.filter(r => [r.title, r.name, r.original_title, r.original_name].some(t => ascii(t) === ascii(title)));
  let pool = exact.length ? exact : res;
  // temporada 1 / minissérie / filme novo no ranking: prefere títulos lançados nos últimos 2 anos
  if (fresh) {
    const recent = pool.filter(r => +(r.release_date || r.first_air_date || '0').slice(0, 4) >= +week.slice(0, 4) - 2);
    if (recent.length) pool = recent;
  }
  const cands = pool.sort((a, b) => b.popularity - a.popularity).slice(0, 3);
  // entre homônimos, prefere o que está na Netflix Brasil
  for (const c of cands) {
    const pv = await tmdb(`/${type}/${c.id}/watch/providers`);
    if ((pv.results?.BR?.flatrate || []).some(v => PROVIDER_MAP[v.provider_id] === 'netflix')) return c;
  }
  return cands[0];
}
let netflixWeek = null;
try {
  const tsv = await (await fetch('https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv')).text();
  const rows = tsv.split('\n').map(l => l.split('\t')).filter(r => r[1] === 'BR');
  const week = rows.reduce((m, r) => r[2] > m ? r[2] : m, '');
  for (const [cat, type] of [['Films', 'movie'], ['TV', 'tv']]) {
    const list = rows.filter(r => r[2] === week && r[3] === cat).sort((a, b) => a[4] - b[4]);
    const ids = [];
    for (const r of list) {
      const fresh = type === 'tv' && /Season 1$|Limited Series|^N\/A$/.test(r[6]) && +r[7] <= 2;
      const hit = await findOnNetflix(type, r[5], fresh, week);
      if (!hit) { console.log(`Netflix oficial: não achei "${r[5]}" no TMDB`); continue; }
      const k = key(type, hit.id);
      if (!ids.includes(k)) ids.push(k); // temporadas diferentes da mesma série contam uma vez
      if (!seen.has(k)) seen.set(k, { type, tid: hit.id, from: 'netflix', pop: hit.popularity });
      else seen.get(k).from = 'netflix';
    }
    if (ids.length >= 5) tops[type].netflix = ids;
  }
  netflixWeek = week;
  console.log(`Top 10 oficial Netflix Brasil: semana até ${week}`);
} catch (e) { console.log('Top 10 oficial da Netflix indisponível, usando popularidade:', e.message); }
console.log(`${seen.size} títulos únicos`);

// 2) Detalhes: duração/temporadas, onde assistir, id IMDb
let prevImdb = {};
if (process.env.PREV_URL) {
  try { (await (await fetch(process.env.PREV_URL)).json()).items.forEach(x => { if (x.imdb && x.ir) prevImdb[x.imdb] = x.ir; }); } catch {}
}
const items = [];
const stats = { br: 0, pt: 0, gen: 0 };
await pool([...seen.entries()], 8, async ([id, m]) => {
  const d = await tmdb(`/${m.type}/${m.tid}`, { append_to_response: 'watch/providers,external_ids,translations' });
  const [s, sl] = sinopse(d, m.type);
  stats[sl]++;
  const flat = d['watch/providers']?.results?.BR?.flatrate || [];
  const ps = [...new Set(flat.map(v => PROVIDER_MAP[v.provider_id]).filter(Boolean))];
  if (!ps.length) ps.push(m.from);
  const n = d.number_of_seasons;
  items.push({
    id, type: m.type,
    t: titulo(d), o: d.original_title || d.original_name,
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
fs.writeFileSync('data.json', JSON.stringify({ updated: new Date().toISOString(), netflixWeek, tops, items }));
// 4) Uma página por título para o link compartilhado mostrar a capa no WhatsApp.
//    O WhatsApp não roda JavaScript: a prévia vem das tags og:* da própria página, que depois redireciona para o site.
const SITE = 'https://lsato2.github.io/o-que-ver-hoje/';
const html = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
fs.mkdirSync('t', { recursive: true });
for (const x of items) {
  const dest = `${SITE}?t=${x.id}`;
  const kind = x.type === 'movie' ? 'Filme' : 'Série';
  const img = x.img[0] ? `https://image.tmdb.org/t/p/w500${x.img[0]}` : `${SITE}og.jpg`;
  fs.writeFileSync(`t/${x.id}.html`, `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${kind}: ${html(x.t)}</title>
<meta property="og:type" content="video.${x.type === 'movie' ? 'movie' : 'tv_show'}">
<meta property="og:site_name" content="O que ver hoje">
<meta property="og:title" content="${kind}: ${html(x.t)}">
<meta property="og:description" content="O que ver hoje">
<meta property="og:url" content="${SITE}t/${x.id}.html">
<meta property="og:image" content="${img}">
${x.img[0] ? '<meta property="og:image:width" content="500"><meta property="og:image:height" content="750">' : ''}
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=${dest}">
<link rel="canonical" href="${dest}">
</head><body><script>location.replace(${JSON.stringify(dest)})</script><a href="${dest}">Abrir no O que ver hoje</a></body></html>`);
}
console.log(`sinopses: ${stats.br} pt-BR, ${stats.pt} pt-PT, ${stats.gen} sem sinopse em português`);
console.log(`data.json: ${items.length} títulos, ${items.filter(x => x.ir).length} com nota IMDb, ${(fs.statSync('data.json').size / 1024).toFixed(0)} KB`);
