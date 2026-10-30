// Conferência automática antes de publicar: roda no GitHub Actions depois de gerar os dados.
// Se algo falhar, o site NÃO é publicado e a versão anterior continua no ar.
//   node scripts/check-site.mjs          confere index.html, 404.html, data.json, archive.json e t/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const errors = [];
const fail = msg => errors.push(msg);
const read = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : (fail(`${f} não existe`), '');

// 1) O JavaScript da página não pode ter erro de sintaxe (um erro deixaria o site em branco)
const page = read('index.html');
const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!scripts.length) fail('index.html sem <script>');
scripts.forEach((code, i) => {
  const f = path.join(os.tmpdir(), `oqvh-check-${i}.js`);
  fs.writeFileSync(f, code);
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { fail(`erro de sintaxe no script ${i + 1} do index.html:\n${e.stderr}`); }
});
for (const id of ['hero', 'tops', 'drawer', 'detail', 'modal', 'toast', 'page-profile', 'page-search', 'page-saved', 'page-history'])
  if (!page.includes(`id="${id}"`)) fail(`index.html sem o elemento #${id}`);
if (!read('404.html').includes('?t=')) fail('404.html não redireciona links antigos');

// 2) Dados do dia
let data = { items: [], tops: { movie: {}, tv: {} } };
try { data = JSON.parse(read('data.json')); } catch (e) { fail('data.json inválido: ' + e.message); }
const ids = new Set(data.items.map(x => x.id));
if (data.items.length < 300) fail(`data.json com só ${data.items.length} títulos`);
if (ids.size !== data.items.length) fail('data.json com títulos repetidos');
for (const x of data.items) {
  const bad = [];
  if (!/^[mt]\d+$/.test(x.id)) bad.push('id');
  if (!['movie', 'tv'].includes(x.type)) bad.push('tipo');
  if (!x.t) bad.push('nome');
  if (!x.s) bad.push('sinopse');
  if (!Array.isArray(x.img) || !x.img[0]) bad.push('capa');
  if (!Array.isArray(x.ps) || !x.ps.includes(x.p)) bad.push('plataforma');
  if (!Array.isArray(x.g)) bad.push('gêneros');
  if (bad.length) fail(`${x.id} (${x.t}): faltando ${bad.join(', ')}`);
}
for (const type of ['movie', 'tv']) for (const [pf, list] of Object.entries(data.tops?.[type] || {}))
  for (const id of list) if (!ids.has(id)) fail(`Em alta ${type}/${pf} aponta para ${id}, que não está nos dados`);
const age = (Date.now() - new Date(data.updated)) / 36e5;
if (!(age < 6)) fail(`data.json não foi gerado agora (há ${age.toFixed(1)} h)`);

// 3) Páginas de compartilhamento (capa no WhatsApp) e arquivo de títulos antigos
let archive = {};
try { archive = JSON.parse(read('archive.json')); } catch (e) { fail('archive.json inválido: ' + e.message); }
for (const id of ids) if (!archive[id]) fail(`${id} está nos dados do dia mas não no archive.json`);
for (const id of Object.keys(archive)) {
  const f = `t/${id}.html`;
  if (!fs.existsSync(f)) { fail(`${f} não existe`); continue; }
  if (!ids.has(id) && !fs.existsSync(`t/${id}.json`)) fail(`t/${id}.json não existe (link antigo não abriria)`);
}
const sample = data.items[0] && fs.existsSync(`t/${data.items[0].id}.html`) ? fs.readFileSync(`t/${data.items[0].id}.html`, 'utf8') : '';
for (const tag of ['og:title', 'og:image', 'http-equiv="refresh"']) if (sample && !sample.includes(tag)) fail(`página de compartilhamento sem ${tag}`);

if (errors.length) {
  console.error(`✗ ${errors.length} problema(s) encontrado(s), o site não será publicado:\n` + errors.slice(0, 40).map(e => ' - ' + e).join('\n'));
  process.exit(1);
}
console.log(`✓ Conferência ok: ${data.items.length} títulos do dia, ${Object.keys(archive).length} links ativos, ${scripts.length} script(s) sem erro`);
