import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import nodemailer from 'nodemailer';
import { fileURLToPath } from 'node:url';
import { gerarPdf } from './pdf.js';
import { renderTemplate, descCliente, descPdf, comLinkProprio } from './template.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- .env simples (sem dependências) ----------
function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnv();

const PORT = Number(process.env.PORT || 3000);

// ---------- Banco de dados ----------
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'app.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
CREATE TABLE IF NOT EXISTS campanhas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  email_retorno TEXT NOT NULL,
  imagem TEXT NOT NULL DEFAULT '',
  imagem_alinhamento TEXT NOT NULL DEFAULT 'esquerda',
  logo TEXT NOT NULL DEFAULT '',
  titulo_alinhamento TEXT NOT NULL DEFAULT 'esquerda',
  logo_posicao TEXT NOT NULL DEFAULT 'antes',
  descricao_cliente TEXT NOT NULL DEFAULT '',
  descricao_pdf TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS contatos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campanha_id INTEGER NOT NULL REFERENCES campanhas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pendente',
  assinatura TEXT NOT NULL DEFAULT '',
  erro TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  enviado_em TEXT NOT NULL DEFAULT '',
  assinado_em TEXT NOT NULL DEFAULT '',
  dados TEXT NOT NULL DEFAULT '{}',
  linhas TEXT NOT NULL DEFAULT '[]',
  email_copia TEXT NOT NULL DEFAULT '',
  UNIQUE (campanha_id, email)
);
CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS emails_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  para_email TEXT NOT NULL,
  assunto TEXT NOT NULL,
  corpo TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT '',
  enviado INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS links_linha (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contato_id INTEGER NOT NULL,
  idx INTEGER NOT NULL DEFAULT 0,
  nome TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pendente',
  assinatura TEXT NOT NULL DEFAULT '',
  assinado_em TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em INTEGER NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

// Se o banco ainda não tem SMTP e o .env tem, importa uma vez.
if (!db.prepare("SELECT valor FROM config WHERE chave='smtp_host'").get()?.valor && process.env.SMTP_HOST) {
  const seed = {
    smtp_host: process.env.SMTP_HOST || '',
    smtp_port: process.env.SMTP_PORT || '587',
    smtp_user: process.env.SMTP_USER || '',
    smtp_pass: process.env.SMTP_PASS || '',
    smtp_from: process.env.SMTP_FROM || '',
    base_url: process.env.BASE_URL || '',
  };
  const up = db.prepare('INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)');
  for (const [k, v] of Object.entries(seed)) up.run(k, v);
}

// Migração: bancos antigos ganham as novas colunas.
for (const [tabela, col, def] of [
  ['contatos', 'dados', "TEXT NOT NULL DEFAULT '{}'"],
  ['contatos', 'linhas', "TEXT NOT NULL DEFAULT '[]'"],
  ['contatos', 'email_copia', "TEXT NOT NULL DEFAULT ''"],
  ['campanhas', 'imagem', "TEXT NOT NULL DEFAULT ''"],
  ['campanhas', 'imagem_alinhamento', "TEXT NOT NULL DEFAULT 'esquerda'"],
  ['campanhas', 'logo', "TEXT NOT NULL DEFAULT ''"],
  ['campanhas', 'titulo_alinhamento', "TEXT NOT NULL DEFAULT 'esquerda'"],
  ['campanhas', 'logo_posicao', "TEXT NOT NULL DEFAULT 'antes'"],
  ['campanhas', 'descricao_cliente', "TEXT NOT NULL DEFAULT ''"],
  ['campanhas', 'descricao_pdf', "TEXT NOT NULL DEFAULT ''"],
]) {
  try {
    db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${col} ${def}`);
  } catch {
    /* coluna já existe */
  }
}

function getConfig() {
  const cfg = {};
  for (const row of db.prepare('SELECT chave, valor FROM config').all()) cfg[row.chave] = row.valor;
  if (!cfg.base_url) cfg.base_url = process.env.BASE_URL || `http://localhost:${PORT}`;
  return cfg;
}

function smtpConfigured(cfg) {
  return !!(cfg.smtp_host && cfg.smtp_user);
}

// ---------- Autenticação (só o painel; assinatura do cliente é pública) ----------
const SESSAO_TTL = 12 * 3600 * 1000;
const usuarioValido = (u) => /^[a-zA-Z0-9._-]{3,30}$/.test(String(u || ''));

function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  return `${salt}$${hash}`;
}
function confereSenha(senha, guardado) {
  const [salt, hash] = String(guardado || '').split('$');
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(String(senha || ''), salt, 64);
  const b = Buffer.from(hash, 'hex');
  return calc.length === b.length && crypto.timingSafeEqual(calc, b);
}
function novaSessao(usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessoes (token, usuario_id, expira_em) VALUES (?,?,?)').run(token, usuarioId, Date.now() + SESSAO_TTL);
  return token;
}
function sessaoDe(req) {
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)sessao=([a-f0-9]{64})/);
  if (!m) return null;
  const s = db.prepare('SELECT s.token, s.usuario_id, s.expira_em, u.usuario FROM sessoes s JOIN usuarios u ON u.id=s.usuario_id WHERE s.token=?').get(m[1]);
  if (!s) return null;
  if (s.expira_em < Date.now()) {
    db.prepare('DELETE FROM sessoes WHERE token=?').run(m[1]);
    return null;
  }
  db.prepare('UPDATE sessoes SET expira_em=? WHERE token=?').run(Date.now() + SESSAO_TTL, m[1]);
  return s;
}
const cookieSessao = (token, maxAge) => `sessao=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

// ---------- E-mails ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function sendMail({ to, subject, html, tipo, attachments = [] }) {
  const cfg = getConfig();
  if (!smtpConfigured(cfg)) {
    const nota = attachments.length
      ? `<p><i>Anexo(s): ${attachments.map((a) => `${esc(a.filename)} (${(a.content.length / 1024).toFixed(1)} KB)`).join(', ')}</i></p>`
      : '';
    db.prepare('INSERT INTO emails_log (para_email, assunto, corpo, tipo, enviado) VALUES (?,?,?,?,0)')
      .run(to, subject, html + nota, tipo);
    console.log(`[modo-teste] e-mail "${tipo}" para ${to} registrado (SMTP não configurado)`);
    return { testMode: true };
  }
  const transporter = nodemailer.createTransport({
    host: cfg.smtp_host,
    port: Number(cfg.smtp_port || 587),
    secure: Number(cfg.smtp_port) === 465,
    auth: { user: cfg.smtp_user, pass: cfg.smtp_pass },
  });
  await transporter.sendMail({ from: cfg.smtp_from || cfg.smtp_user, to, subject, html, attachments });
  db.prepare('INSERT INTO emails_log (para_email, assunto, corpo, tipo, enviado) VALUES (?,?,?,?,1)')
    .run(to, subject, html, tipo);
  return { testMode: false };
}

function tituloHtml(titulo, logoSrc, alinhamento, logoPos) {
  const align = alinhamento === 'centro' ? 'center' : alinhamento === 'direita' ? 'right' : 'left';
  if (!logoSrc) return `<h2 align="${align}">${esc(titulo)}</h2>`;
  const img = `<img src="${logoSrc}" alt="" width="56" style="display:block;border:0;max-width:56px;height:auto">`;
  const celTitulo = `<td align="${align}" valign="middle"><h2 style="margin:0">${esc(titulo)}</h2></td>`;
  const celLogo = `<td width="64" align="center" valign="middle">${img}</td>`;
  const cells = logoPos === 'depois' ? celTitulo + celLogo : celLogo + celTitulo;
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`;
}

function inviteHtml(campanha, contato, link, imgs = {}) {
  const bAl = campanha.imagem_alinhamento === 'centro' ? 'center' : campanha.imagem_alinhamento === 'direita' ? 'right' : 'left';
  const banner = imgs.banner
    ? `<p align="${bAl}" style="margin:0 0 12px"><img src="${imgs.banner}" alt="" style="max-width:100%;height:auto;border-radius:6px"></p>`
    : '';
  return `<div style="font-family:Arial,sans-serif;max-width:600px">
${tituloHtml(campanha.titulo, imgs.logo, campanha.titulo_alinhamento, campanha.logo_posicao)}
<p>Olá, ${esc(contato.nome)}!</p>
${banner}<p>${esc(campanha.descricao).replace(/\n/g, '<br>')}</p>
<p>Para assinar, clique no botão abaixo:</p>
<p><a href="${esc(link)}" style="display:inline-block;padding:12px 24px;background:#00B894;color:#fff;text-decoration:none;border-radius:6px">Assinar formulário</a></p>
<p style="color:#555;font-size:13px">Se o botão não funcionar, copie este link:<br>${esc(link)}</p>
</div>`;
}

function ctxDe(ct) {
  let dados = {};
  let linhas = [];
  try { dados = JSON.parse(ct.dados || '{}'); } catch { dados = {}; }
  try {
    const l = JSON.parse(ct.linhas || '[]');
    linhas = Array.isArray(l) ? l : [];
  } catch { linhas = []; }
  return { nome: ct.nome, email: ct.email, dados, linhas };
}

function validarImagem(dataUrl) {
  const m = String(dataUrl || '').match(/^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('Imagem deve ser PNG ou JPG.');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > 2 * 1024 * 1024) throw new Error('Imagem maior que 2 MB.');
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const jpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (!png && !jpg) throw new Error('Arquivo de imagem inválido.');
  return `data:${m[1] === 'png' ? 'image/png' : 'image/jpeg'};base64,${m[2]}`;
}

function decodificarImagem(dataUrl) {
  const m = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  try {
    return { mime: m[1], buf: Buffer.from(m[2], 'base64') };
  } catch {
    return null;
  }
}

function serveDataUrl(res, dataUrl) {
  const dec = decodificarImagem(dataUrl);
  if (!dec) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('sem imagem');
    return;
  }
  res.writeHead(200, { 'Content-Type': dec.mime, 'Content-Length': dec.buf.length, 'Cache-Control': 'private, max-age=3600' });
  res.end(dec.buf);
}

// Contexto de renderização: injeta {{link}} em cada linha (link próprio da
// linha ou, sem ele, o link do contato) e devolve as filas de linhas.
function contextoEnvio(camp, ct, base) {
  const ctxBase = ctxDe(ct);
  const link = `${base}/assinar.html?token=${ct.token}`;
  const filas = db.prepare('SELECT idx, nome, email, token FROM links_linha WHERE contato_id=? ORDER BY idx').all(ct.id);
  const porIdx = new Map(filas.map((l) => [l.idx, `${base}/assinar.html?token=${l.token}`]));
  const filaPorIdx = new Map(filas.map((l) => [l.idx, l]));
  const linhas = ctxBase.linhas.map((row, i) => {
    const baseRow = (row && typeof row === 'object' ? row : {});
    const lower = new Set(Object.keys(baseRow).map((k) => k.toLowerCase()));
    const f = filaPorIdx.get(i);
    const out = { ...baseRow };
    const inj = { link: porIdx.get(i) || link, nome_linha: (f && f.nome) || '', email_linha: (f && f.email) || '' };
    for (const [k, v] of Object.entries(inj)) {
      if (!lower.has(k)) out[k] = v;
    }
    return out;
  });
  return { ctx: { ...ctxBase, linhas }, link };
}

async function enviarConvite(camp, ct, base) {
  const { ctx, link } = contextoEnvio(camp, ct, base);
  const attachments = [];
  const imgs = { banner: null, logo: null };
  const banner = decodificarImagem(camp.imagem);
  if (banner) {
    attachments.push({ filename: `banner.${banner.mime === 'image/png' ? 'png' : 'jpg'}`, content: banner.buf, contentType: banner.mime, cid: 'banner' });
    imgs.banner = 'cid:banner';
  }
  const logo = decodificarImagem(camp.logo);
  if (logo) {
    attachments.push({ filename: `logo.${logo.mime === 'image/png' ? 'png' : 'jpg'}`, content: logo.buf, contentType: logo.mime, cid: 'logo' });
    imgs.logo = 'cid:logo';
  }
  // Um PDF por linha, para imprimir (com o link digital dentro).
  for (let i = 0; i < ctx.linhas.length; i++) {
    const row = ctx.linhas[i];
    const nomeLinha = row.nome_linha || row.NOME_LINHA || ct.nome;
    const emailLinha = row.email_linha || row.EMAIL_LINHA || '';
    const ctxLinha = { nome: nomeLinha, email: emailLinha, dados: row, linhas: [row] };
    try {
      const draft = await gerarPdf(
        { ...camp, descricao: renderTemplate(descPdf(camp), ctxLinha) },
        { nome: nomeLinha, email: emailLinha || '(não informado)', assinatura: '', assinado_em: '' },
        { rascunho: true, numero: i + 1, link: row.link }
      );
      attachments.push({ filename: draft.filename, content: draft.buffer, contentType: 'application/pdf' });
    } catch (e) {
      console.log(`[aviso] falha ao gerar PDF da linha ${i} (${nomeLinha}): ${e.message}`);
    }
  }
  await sendMail({
    to: ct.email, tipo: 'convite',
    subject: renderTemplate(`${camp.titulo} — formulário para assinatura`, ctx),
    html: inviteHtml({ ...camp, descricao: renderTemplate(camp.descricao, ctx) }, ct, link, imgs),
    attachments,
  });
}

function copiaClienteHtml(campanha, contato) {
  return `<div style="font-family:Arial,sans-serif;max-width:600px">
<p>Olá, ${esc(contato.nome)}!</p>
<p>Recebemos a sua assinatura do formulário <b>${esc(campanha.titulo)}</b>, registrada em ${esc(contato.assinado_em)}.</p>
<p>Você está recebendo em anexo a cópia preenchida em PDF.</p>
<p>Obrigado!</p>
</div>`;
}

function copiaEmpresaHtml(campanha, contato) {
  return `<div style="font-family:Arial,sans-serif;max-width:600px">
<p>O cliente <b>${esc(contato.nome)}</b> (${esc(contato.email)}) assinou o formulário <b>${esc(campanha.titulo)}</b> em ${esc(contato.assinado_em)}.</p>
<p>Segue em anexo a cópia preenchida em PDF.</p>
</div>`;
}

function copiaVendedorHtml(campanha, contato) {
  return `<div style="font-family:Arial,sans-serif;max-width:600px">
<p>Olá!</p>
<p>O cliente <b>${esc(contato.nome)}</b> (${esc(contato.email)}) assinou digitalmente o formulário <b>${esc(campanha.titulo)}</b> em ${esc(contato.assinado_em)}.</p>
<p>Segue em anexo a cópia preenchida em PDF para seu controle.</p>
</div>`;
}

// ---------- Utilidades HTTP ----------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readJson(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('payload grande demais')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || '').trim());
const ALINHAMENTOS = ['esquerda', 'centro', 'direita'];
const LOGO_POS = ['antes', 'depois'];

// ---------- API ----------
async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const method = req.method;
  const rotaPublica = parts[1] === 'sessao' || parts[1] === 'setup' || parts[1] === 'login' || parts[1] === 'logout' || parts[1] === 'assinatura';
  const sess = sessaoDe(req);
  if (!rotaPublica && !sess) return sendJson(res, 401, { error: 'Não autenticado. Faça login.' });

  // GET /api/sessao — estado do login (público)
  if (parts.length === 2 && parts[1] === 'sessao' && method === 'GET') {
    const n = db.prepare('SELECT COUNT(*) n FROM usuarios').get().n;
    return sendJson(res, 200, sess
      ? { logado: true, usuario: sess.usuario, setupNecessario: false }
      : { logado: false, setupNecessario: n === 0 });
  }

  // POST /api/setup { usuario, senha } — cria o primeiro usuário (só com tabela vazia)
  if (parts.length === 2 && parts[1] === 'setup' && method === 'POST') {
    const n = db.prepare('SELECT COUNT(*) n FROM usuarios').get().n;
    if (n > 0) return sendJson(res, 400, { error: 'Já existe usuário; peça a um deles para criar o seu.' });
    const b = await readJson(req);
    if (!usuarioValido(b.usuario)) return sendJson(res, 400, { error: 'Usuário: 3 a 30 letras, números ou . _ -' });
    if (String(b.senha || '').length < 8) return sendJson(res, 400, { error: 'Senha: mínimo 8 caracteres.' });
    const nome = String(b.usuario).toLowerCase();
    const r = db.prepare('INSERT INTO usuarios (usuario, senha_hash) VALUES (?,?)').run(nome, hashSenha(b.senha));
    res.setHeader('Set-Cookie', cookieSessao(novaSessao(Number(r.lastInsertRowid)), SESSAO_TTL / 1000));
    return sendJson(res, 201, { ok: true, usuario: nome });
  }

  // POST /api/login { usuario, senha }
  if (parts.length === 2 && parts[1] === 'login' && method === 'POST') {
    const b = await readJson(req);
    const u = db.prepare('SELECT * FROM usuarios WHERE usuario=?').get(String(b.usuario || '').toLowerCase());
    db.prepare('DELETE FROM sessoes WHERE expira_em<?').run(Date.now());
    if (!u || !confereSenha(b.senha, u.senha_hash)) {
      await new Promise((r) => setTimeout(r, 400));
      return sendJson(res, 401, { error: 'Usuário ou senha inválidos.' });
    }
    res.setHeader('Set-Cookie', cookieSessao(novaSessao(u.id), SESSAO_TTL / 1000));
    return sendJson(res, 200, { ok: true, usuario: u.usuario });
  }

  // POST /api/logout
  if (parts.length === 2 && parts[1] === 'logout' && method === 'POST') {
    const m = String(req.headers.cookie || '').match(/(?:^|;\s*)sessao=([a-f0-9]{64})/);
    if (m) db.prepare('DELETE FROM sessoes WHERE token=?').run(m[1]);
    res.setHeader('Set-Cookie', 'sessao=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return sendJson(res, 200, { ok: true });
  }

  // GET /api/usuarios — lista (autenticado)
  if (parts.length === 2 && parts[1] === 'usuarios' && method === 'GET') {
    return sendJson(res, 200, db.prepare('SELECT id, usuario, criado_em FROM usuarios ORDER BY id').all());
  }

  // POST /api/usuarios { usuario, senha } — cria (autenticado)
  if (parts.length === 2 && parts[1] === 'usuarios' && method === 'POST') {
    const b = await readJson(req);
    if (!usuarioValido(b.usuario)) return sendJson(res, 400, { error: 'Usuário: 3 a 30 letras, números ou . _ -' });
    if (String(b.senha || '').length < 8) return sendJson(res, 400, { error: 'Senha: mínimo 8 caracteres.' });
    try {
      const r = db.prepare('INSERT INTO usuarios (usuario, senha_hash) VALUES (?,?)').run(String(b.usuario).toLowerCase(), hashSenha(b.senha));
      return sendJson(res, 201, { id: Number(r.lastInsertRowid) });
    } catch {
      return sendJson(res, 400, { error: 'Esse usuário já existe.' });
    }
  }

  // GET /api/config — mostra tudo exceto a senha
  if (parts.length === 2 && parts[1] === 'config' && method === 'GET') {
    const cfg = getConfig();
    return sendJson(res, 200, {
      smtp_host: cfg.smtp_host || '', smtp_port: cfg.smtp_port || '587',
      smtp_user: cfg.smtp_user || '', smtp_pass_set: !!(cfg.smtp_pass),
      smtp_from: cfg.smtp_from || '', base_url: cfg.base_url || '',
      smtp_configured: smtpConfigured(cfg),
    });
  }

  // POST /api/config
  if (parts.length === 2 && parts[1] === 'config' && method === 'POST') {
    const b = await readJson(req);
    const up = db.prepare('INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)');
    for (const k of ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_from', 'base_url']) {
      if (typeof b[k] === 'string') up.run(k, b[k].trim());
    }
    if (typeof b.smtp_pass === 'string' && b.smtp_pass) up.run('smtp_pass', b.smtp_pass);
    return sendJson(res, 200, { ok: true, smtp_configured: smtpConfigured(getConfig()) });
  }

  // POST /api/config/teste { para }
  if (parts.length === 3 && parts[1] === 'config' && parts[2] === 'teste' && method === 'POST') {
    const b = await readJson(req);
    if (!isEmail(b.para)) return sendJson(res, 400, { error: 'Informe um e-mail válido em "para".' });
    try {
      const r = await sendMail({
        to: b.para.trim(), tipo: 'teste',
        subject: 'Teste de SMTP — envio de formulários',
        html: '<p>Se você recebeu este e-mail, o SMTP está funcionando.</p>',
      });
      return sendJson(res, 200, r.testMode
        ? { ok: true, testMode: true, msg: 'SMTP não configurado: e-mail registrado no log de teste.' }
        : { ok: true, testMode: false });
    } catch (e) {
      return sendJson(res, 500, { error: 'Falha no envio: ' + e.message });
    }
  }

  // GET /api/campanhas
  if (parts.length === 2 && parts[1] === 'campanhas' && method === 'GET') {
    const rows = db.prepare(`
      SELECT c.id, c.titulo, c.descricao, c.email_retorno, c.titulo_alinhamento, c.logo_posicao, c.criado_em,
        LENGTH(c.imagem)>0 AS tem_imagem, LENGTH(c.logo)>0 AS tem_logo, COUNT(t.id) AS total,
        SUM(CASE WHEN t.status IN ('enviado','assinado') THEN 1 ELSE 0 END) AS enviados,
        SUM(CASE WHEN t.status='assinado' THEN 1 ELSE 0 END) AS assinados
      FROM campanhas c LEFT JOIN contatos t ON t.campanha_id = c.id
      GROUP BY c.id ORDER BY c.id DESC`).all();
    return sendJson(res, 200, rows);
  }

  // POST /api/campanhas
  if (parts.length === 2 && parts[1] === 'campanhas' && method === 'POST') {
    const b = await readJson(req);
    if (!b.titulo || !String(b.titulo).trim()) return sendJson(res, 400, { error: 'Título é obrigatório.' });
    if (!isEmail(b.email_retorno)) return sendJson(res, 400, { error: 'E-mail de retorno inválido (para onde vai a cópia).' });
    const al = b.titulo_alinhamento || 'esquerda';
    const lp = b.logo_posicao || 'antes';
    const ia = b.imagem_alinhamento || 'esquerda';
    if (!ALINHAMENTOS.includes(al)) return sendJson(res, 400, { error: 'Alinhamento do título inválido.' });
    if (!LOGO_POS.includes(lp)) return sendJson(res, 400, { error: 'Posição do logotipo inválida.' });
    if (!ALINHAMENTOS.includes(ia)) return sendJson(res, 400, { error: 'Posição da imagem inválida.' });
    let imagem = '';
    let logo = '';
    try {
      if (b.imagem) imagem = validarImagem(b.imagem);
      if (b.logo) logo = validarImagem(b.logo);
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
    const r = db.prepare('INSERT INTO campanhas (titulo, descricao, email_retorno, imagem, imagem_alinhamento, logo, titulo_alinhamento, logo_posicao, descricao_cliente, descricao_pdf) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(String(b.titulo).trim(), String(b.descricao || '').trim(), String(b.email_retorno).trim(), imagem, ia, logo, al, lp, String(b.descricao_cliente || '').trim(), String(b.descricao_pdf || '').trim());
    return sendJson(res, 201, { id: Number(r.lastInsertRowid) });
  }

  // Rotas com :id da campanha
  if (parts[1] === 'campanhas' && /^\d+$/.test(parts[2] || '')) {
    const id = Number(parts[2]);
    const camp = db.prepare('SELECT * FROM campanhas WHERE id=?').get(id);
    if (!camp) return sendJson(res, 404, { error: 'Campanha não encontrada.' });

    // GET /api/campanhas/:id
    if (parts.length === 3 && method === 'GET') {
      const contatos = db.prepare('SELECT id,nome,email,status,enviado_em,assinado_em,assinatura,erro,COALESCE(json_array_length(linhas),0) AS nlinhas FROM contatos WHERE campanha_id=? ORDER BY id').all(id);
      const links = db.prepare('SELECT contato_id, idx, nome, email, token, status, assinado_em FROM links_linha WHERE contato_id IN (SELECT id FROM contatos WHERE campanha_id=?) ORDER BY contato_id, idx').all(id);
      const porCt = new Map();
      for (const l of links) {
        if (!porCt.has(l.contato_id)) porCt.set(l.contato_id, []);
        porCt.get(l.contato_id).push(l);
      }
      for (const ct of contatos) ct.linhas_links = porCt.get(ct.id) || [];
      camp.tem_imagem = camp.imagem ? 1 : 0;
      camp.tem_logo = camp.logo ? 1 : 0;
      delete camp.imagem;
      delete camp.logo;
      return sendJson(res, 200, { campanha: camp, contatos });
    }

    // GET /api/campanhas/:id/imagem e /:id/logo
    if (parts.length === 4 && (parts[3] === 'imagem' || parts[3] === 'logo') && method === 'GET') {
      serveDataUrl(res, parts[3] === 'imagem' ? camp.imagem : camp.logo);
      return;
    }

    // POST /api/campanhas/:id/contatos { contatos: [{nome,email}] }
    if (parts.length === 4 && parts[3] === 'contatos' && method === 'POST') {
      const b = await readJson(req);
      if (!Array.isArray(b.contatos) || !b.contatos.length) {
        return sendJson(res, 400, { error: 'Envie uma lista de contatos.' });
      }
      const ins = db.prepare('INSERT OR IGNORE INTO contatos (campanha_id, nome, email, token, dados, linhas, email_copia) VALUES (?,?,?,?,?,?,?)');
      const insLink = db.prepare('INSERT INTO links_linha (contato_id, idx, nome, email, token) VALUES (?,?,?,?,?)');
      let adicionados = 0, ignorados = 0;
      const vistos = new Set();
      for (const c of b.contatos) {
        const nome = String(c?.nome || '').trim();
        const email = String(c?.email || '').trim().toLowerCase();
        if (!nome || !isEmail(email) || vistos.has(email)) { ignorados++; continue; }
        vistos.add(email);
        const dados = (c && typeof c.dados === 'object' && c.dados !== null) ? JSON.stringify(c.dados) : '{}';
        const linhasArr = Array.isArray(c?.linhas) ? c.linhas : [];
        const cc = String(c?.email_copia || '').trim().toLowerCase();
        const r = ins.run(id, nome, email, crypto.randomBytes(24).toString('hex'), dados, JSON.stringify(linhasArr), (cc && isEmail(cc)) ? cc : '');
        if (!r.changes) { ignorados++; continue; }
        adicionados++;
        if (c.comLinks && linhasArr.length) {
          const nomes = Array.isArray(c.nomes_linha) ? c.nomes_linha : [];
          const emails = Array.isArray(c.emails_linha) ? c.emails_linha : [];
          linhasArr.forEach((row, i) => {
            const nm = String(nomes[i] || '').trim() || `Linha ${i + 1}`;
            const em = String(emails[i] || '').trim().toLowerCase();
            insLink.run(Number(r.lastInsertRowid), i, nm, (em && isEmail(em)) ? em : '', crypto.randomBytes(24).toString('hex'));
          });
        }
      }
      return sendJson(res, 200, { adicionados, ignorados });
    }

    // POST /api/campanhas/:id/disparar
    if (parts.length === 4 && parts[3] === 'disparar' && method === 'POST') {
      const cfg = getConfig();
      const base = (cfg.base_url || '').replace(/\/$/, '');
      const pendentes = db.prepare("SELECT * FROM contatos WHERE campanha_id=? AND status IN ('pendente','erro') ORDER BY id").all(id);
      let enviados = 0;
      const falhas = [];
      const markEnv = db.prepare("UPDATE contatos SET status='enviado', enviado_em=datetime('now','localtime'), erro='' WHERE id=?");
      const markErr = db.prepare("UPDATE contatos SET status='erro', erro=? WHERE id=?");
      for (const ct of pendentes) {
        try {
          await enviarConvite(camp, ct, base);
          markEnv.run(ct.id);
          enviados++;
        } catch (e) {
          markErr.run(e.message, ct.id);
          falhas.push({ email: ct.email, erro: e.message });
        }
      }
      return sendJson(res, 200, { enviados, falhas, testMode: !smtpConfigured(cfg) });
    }

    // POST /api/campanhas/:id/reenviar-todos — reenvia para todos os não assinados
    if (parts.length === 4 && parts[3] === 'reenviar-todos' && method === 'POST') {
      const cfg = getConfig();
      const base = (cfg.base_url || '').replace(/\/$/, '');
      const alvo = db.prepare("SELECT * FROM contatos WHERE campanha_id=? AND status!='assinado' ORDER BY id").all(id);
      let enviados = 0;
      const falhas = [];
      const markEnv = db.prepare("UPDATE contatos SET status='enviado', enviado_em=datetime('now','localtime'), erro='' WHERE id=?");
      const markErr = db.prepare("UPDATE contatos SET status='erro', erro=? WHERE id=?");
      for (const ct of alvo) {
        try {
          await enviarConvite(camp, ct, base);
          markEnv.run(ct.id);
          enviados++;
        } catch (e) {
          markErr.run(e.message, ct.id);
          falhas.push({ email: ct.email, erro: e.message });
        }
      }
      return sendJson(res, 200, { enviados, falhas, testMode: !smtpConfigured(cfg) });
    }

    // POST /api/campanhas/:id/contatos/:cid/reenviar
    if (parts.length === 6 && parts[3] === 'contatos' && /^\d+$/.test(parts[4] || '') && parts[5] === 'reenviar' && method === 'POST') {
      const ct = db.prepare('SELECT * FROM contatos WHERE id=? AND campanha_id=?').get(Number(parts[4]), id);
      if (!ct) return sendJson(res, 404, { error: 'Contato não encontrado nesta campanha.' });
      if (ct.status === 'assinado') return sendJson(res, 400, { error: 'Este contato já assinou; não é preciso reenviar.' });
      const cfg = getConfig();
      try {
        await enviarConvite(camp, ct, (cfg.base_url || '').replace(/\/$/, ''));
        db.prepare("UPDATE contatos SET status='enviado', enviado_em=datetime('now','localtime'), erro='' WHERE id=?").run(ct.id);
        return sendJson(res, 200, { ok: true, testMode: !smtpConfigured(cfg) });
      } catch (e) {
        db.prepare('UPDATE contatos SET status=\'erro\', erro=? WHERE id=?').run(e.message, ct.id);
        return sendJson(res, 500, { error: 'Falha no envio: ' + e.message });
      }
    }

    // GET /api/campanhas/:id/contatos/:cid/previa — e-mail renderizado sem enviar
    if (parts.length === 6 && parts[3] === 'contatos' && /^\d+$/.test(parts[4] || '') && parts[5] === 'previa' && method === 'GET') {
      const ct = db.prepare('SELECT * FROM contatos WHERE id=? AND campanha_id=?').get(Number(parts[4]), id);
      if (!ct) return sendJson(res, 404, { error: 'Contato não encontrado nesta campanha.' });
      const cfg = getConfig();
      const base = (cfg.base_url || '').replace(/\/$/, '');
      const { ctx, link } = contextoEnvio(camp, ct, base);
      const imgs = {
        banner: camp.imagem ? `/api/campanhas/${id}/imagem` : null,
        logo: camp.logo ? `/api/campanhas/${id}/logo` : null,
      };
      return sendJson(res, 200, {
        nome: ct.nome, email: ct.email,
        assunto: renderTemplate(`${camp.titulo} — formulário para assinatura`, ctx),
        html: inviteHtml({ ...camp, descricao: renderTemplate(camp.descricao, ctx) }, ct, link, imgs),
        pdfs: ctx.linhas.length,
      });
    }

    // DELETE /api/campanhas/:id/contatos — apaga contatos, links e assinaturas; mantém a campanha
    if (parts.length === 4 && parts[3] === 'contatos' && method === 'DELETE') {
      const n = db.prepare('SELECT COUNT(*) n FROM contatos WHERE campanha_id=?').get(id).n;
      db.prepare('DELETE FROM links_linha WHERE contato_id IN (SELECT id FROM contatos WHERE campanha_id=?)').run(id);
      db.prepare('DELETE FROM contatos WHERE campanha_id=?').run(id);
      return sendJson(res, 200, { ok: true, apagados: n });
    }

    // DELETE /api/campanhas/:id
    if (parts.length === 3 && method === 'DELETE') {
      db.prepare('DELETE FROM links_linha WHERE contato_id IN (SELECT id FROM contatos WHERE campanha_id=?)').run(id);
      db.prepare('DELETE FROM contatos WHERE campanha_id=?').run(id);
      db.prepare('DELETE FROM campanhas WHERE id=?').run(id);
      return sendJson(res, 200, { ok: true });
    }

    // PUT /api/campanhas/:id — edita título, descrição, e-mail, imagens e alinhamento
    if (parts.length === 3 && method === 'PUT') {
      const b = await readJson(req);
      if (!b.titulo || !String(b.titulo).trim()) return sendJson(res, 400, { error: 'Título é obrigatório.' });
      if (!isEmail(b.email_retorno)) return sendJson(res, 400, { error: 'E-mail de retorno inválido.' });
      const al = b.titulo_alinhamento === undefined ? camp.titulo_alinhamento : b.titulo_alinhamento;
      const lp = b.logo_posicao === undefined ? camp.logo_posicao : b.logo_posicao;
      const ia = b.imagem_alinhamento === undefined ? camp.imagem_alinhamento : b.imagem_alinhamento;
      const dc = b.descricao_cliente === undefined ? camp.descricao_cliente : String(b.descricao_cliente || '').trim();
      const dp = b.descricao_pdf === undefined ? camp.descricao_pdf : String(b.descricao_pdf || '').trim();
      if (!ALINHAMENTOS.includes(al)) return sendJson(res, 400, { error: 'Alinhamento do título inválido.' });
      if (!LOGO_POS.includes(lp)) return sendJson(res, 400, { error: 'Posição do logotipo inválida.' });
      if (!ALINHAMENTOS.includes(ia)) return sendJson(res, 400, { error: 'Posição da imagem inválida.' });
      let imagem = camp.imagem;
      let logo = camp.logo;
      try {
        if (b.imagem !== undefined) imagem = b.imagem ? validarImagem(b.imagem) : '';
        if (b.logo !== undefined) logo = b.logo ? validarImagem(b.logo) : '';
      } catch (e) {
        return sendJson(res, 400, { error: e.message });
      }
      db.prepare('UPDATE campanhas SET titulo=?, descricao=?, email_retorno=?, imagem=?, imagem_alinhamento=?, logo=?, titulo_alinhamento=?, logo_posicao=?, descricao_cliente=?, descricao_pdf=? WHERE id=?')
        .run(String(b.titulo).trim(), String(b.descricao || '').trim(), String(b.email_retorno).trim(), imagem, ia, logo, al, lp, dc, dp, id);
      return sendJson(res, 200, { ok: true });
    }
  }

  // GET /api/assinatura/:token/imagem e /:token/logo
  if (parts[1] === 'assinatura' && parts[2] && parts.length === 4 && (parts[3] === 'imagem' || parts[3] === 'logo') && method === 'GET') {
    let ct = db.prepare('SELECT campanha_id FROM contatos WHERE token=?').get(parts[2]);
    if (!ct) {
      const ln = db.prepare('SELECT contato_id FROM links_linha WHERE token=?').get(parts[2]);
      if (!ln) return sendJson(res, 404, { error: 'Link inválido.' });
      ct = db.prepare('SELECT campanha_id FROM contatos WHERE id=?').get(ln.contato_id);
    }
    if (!ct) return sendJson(res, 404, { error: 'Link inválido.' });
    const camp = db.prepare('SELECT imagem, logo FROM campanhas WHERE id=?').get(ct.campanha_id);
    serveDataUrl(res, parts[3] === 'imagem' ? camp.imagem : camp.logo);
    return;
  }

  // GET /api/assinatura/:token
  if (parts[1] === 'assinatura' && parts[2] && method === 'GET') {
    const ct = db.prepare('SELECT * FROM contatos WHERE token=?').get(parts[2]);
    if (!ct) {
      const ln = db.prepare('SELECT * FROM links_linha WHERE token=?').get(parts[2]);
      if (!ln) return sendJson(res, 404, { error: 'Link inválido.' });
      const pc = db.prepare('SELECT campanha_id, linhas FROM contatos WHERE id=?').get(ln.contato_id);
      const camp = db.prepare('SELECT titulo, descricao, descricao_cliente, titulo_alinhamento, logo_posicao, imagem_alinhamento, LENGTH(imagem)>0 AS tem_imagem, LENGTH(logo)>0 AS tem_logo FROM campanhas WHERE id=?').get(pc.campanha_id);
      let rows = [];
      try {
        const l = JSON.parse(pc.linhas || '[]');
        if (Array.isArray(l)) rows = l;
      } catch { rows = []; }
      const base = (getConfig().base_url || '').replace(/\/$/, '');
      const row = comLinkProprio((rows[ln.idx] && typeof rows[ln.idx] === 'object') ? rows[ln.idx] : {}, `${base}/assinar.html?token=${ln.token}`);
      const ctx = { nome: ln.nome, email: ln.email, dados: row, linhas: [row] };
      return sendJson(res, 200, {
        titulo: camp.titulo, descricao: renderTemplate(descCliente(camp), ctx), nome: ln.nome, email: ln.email,
        titulo_alinhamento: camp.titulo_alinhamento, logo_posicao: camp.logo_posicao, imagem_alinhamento: camp.imagem_alinhamento,
        tem_imagem: camp.tem_imagem, tem_logo: camp.tem_logo,
        assinado: ln.status === 'assinado', assinatura: ln.assinatura, assinado_em: ln.assinado_em,
      });
    }
    const camp = db.prepare('SELECT titulo, descricao, titulo_alinhamento, logo_posicao, imagem_alinhamento, LENGTH(imagem)>0 AS tem_imagem, LENGTH(logo)>0 AS tem_logo FROM campanhas WHERE id=?').get(ct.campanha_id);
    return sendJson(res, 200, {
      titulo: camp.titulo, descricao: renderTemplate(camp.descricao, ctxDe(ct)), nome: ct.nome, email: ct.email,
      titulo_alinhamento: camp.titulo_alinhamento, logo_posicao: camp.logo_posicao, imagem_alinhamento: camp.imagem_alinhamento,
      tem_imagem: camp.tem_imagem, tem_logo: camp.tem_logo,
      assinado: ct.status === 'assinado', assinatura: ct.assinatura, assinado_em: ct.assinado_em,
    });
  }

  // POST /api/assinatura/:token { assinatura, email? }
  if (parts[1] === 'assinatura' && parts[2] && method === 'POST') {
    const ct = db.prepare('SELECT * FROM contatos WHERE token=?').get(parts[2]);
    const b = await readJson(req);
    const assinatura = String(b.assinatura || '').trim();
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    // Assinatura de uma linha (cliente de um vendedor): PDF só com os dados
    // dela e cópias para empresa + cliente + vendedor (controle).
    if (!ct) {
      const ln = db.prepare('SELECT * FROM links_linha WHERE token=?').get(parts[2]);
      if (!ln) return sendJson(res, 404, { error: 'Link inválido.' });
      if (ln.status === 'assinado') return sendJson(res, 200, { ok: true, already: true });
      if (assinatura.length < 2) return sendJson(res, 400, { error: 'Digite sua assinatura (seu nome).' });
      const pc = db.prepare('SELECT campanha_id, email_copia, linhas FROM contatos WHERE id=?').get(ln.contato_id);
      if (!pc) return sendJson(res, 404, { error: 'Link inválido.' });
      const emailLinha = String(b.email || ln.email || '').trim();
      if (emailLinha && !isEmail(emailLinha)) return sendJson(res, 400, { error: 'E-mail inválido.' });
      db.prepare("UPDATE links_linha SET status='assinado', assinatura=?, email=?, ip=?, assinado_em=datetime('now','localtime') WHERE id=?")
        .run(assinatura, emailLinha, ip, ln.id);
      let rows = [];
      try {
        const l = JSON.parse(pc.linhas || '[]');
        if (Array.isArray(l)) rows = l;
      } catch { rows = []; }
      const base = (getConfig().base_url || '').replace(/\/$/, '');
      const row = comLinkProprio((rows[ln.idx] && typeof rows[ln.idx] === 'object') ? rows[ln.idx] : {}, `${base}/assinar.html?token=${ln.token}`);
      const camp = db.prepare('SELECT * FROM campanhas WHERE id=?').get(pc.campanha_id);
      const full = { nome: ln.nome, email: emailLinha, assinatura, assinado_em: new Date().toLocaleString('pt-BR') };
      const assunto = `Cópia assinada — ${camp.titulo} — ${ln.nome}`;
      let pdf;
      try {
        pdf = await gerarPdf({ ...camp, descricao: renderTemplate(descPdf(camp), { nome: ln.nome, email: emailLinha, dados: row, linhas: [row] }) }, full);
      } catch (e) {
        return sendJson(res, 200, { ok: true, emailError: 'Falha ao gerar o PDF: ' + e.message });
      }
      const attachments = [{ filename: pdf.filename, content: pdf.buffer, contentType: 'application/pdf' }];
      const errosEmail = [];
      const destinos = [[camp.email_retorno, 'copia-empresa', copiaEmpresaHtml(camp, full)]];
      if (emailLinha) destinos.push([emailLinha, 'copia-cliente', copiaClienteHtml(camp, full)]);
      if (pc.email_copia && isEmail(pc.email_copia) && pc.email_copia !== emailLinha) destinos.push([pc.email_copia, 'copia-vendedor', copiaVendedorHtml(camp, full)]);
      for (const [dest, tipo, html] of destinos) {
        try {
          await sendMail({ to: dest, tipo, subject: assunto, html, attachments });
        } catch (e) {
          errosEmail.push(`${dest}: ${e.message}`);
        }
      }
      if (errosEmail.length) return sendJson(res, 200, { ok: true, emailError: errosEmail.join(' | ') });
      return sendJson(res, 200, { ok: true });
    }
    if (ct.status === 'assinado') return sendJson(res, 200, { ok: true, already: true });
    if (assinatura.length < 2) return sendJson(res, 400, { error: 'Digite sua assinatura (seu nome).' });
    db.prepare("UPDATE contatos SET status='assinado', assinatura=?, ip=?, assinado_em=datetime('now','localtime') WHERE id=?")
      .run(assinatura, ip, ct.id);
    const camp = db.prepare('SELECT * FROM campanhas WHERE id=?').get(ct.campanha_id);
    const full = { ...ct, assinatura, assinado_em: new Date().toLocaleString('pt-BR') };
    const assunto = `Cópia assinada — ${camp.titulo} — ${ct.nome}`;
    let pdf;
    try {
      pdf = await gerarPdf({ ...camp, descricao: renderTemplate(camp.descricao, ctxDe(ct)) }, full);
    } catch (e) {
      return sendJson(res, 200, { ok: true, emailError: 'Falha ao gerar o PDF: ' + e.message });
    }
    const attachments = [{ filename: pdf.filename, content: pdf.buffer, contentType: 'application/pdf' }];
    const errosEmail = [];
    const destinos = [
      [camp.email_retorno, 'copia-empresa', copiaEmpresaHtml(camp, full)],
      [ct.email, 'copia-cliente', copiaClienteHtml(camp, full)],
    ];
    if (ct.email_copia && isEmail(ct.email_copia) && ct.email_copia !== ct.email) destinos.push([ct.email_copia, 'copia-vendedor', copiaVendedorHtml(camp, full)]);
    for (const [dest, tipo, html] of destinos) {
      try {
        await sendMail({ to: dest, tipo, subject: assunto, html, attachments });
      } catch (e) {
        errosEmail.push(`${dest}: ${e.message}`);
      }
    }
    if (errosEmail.length) return sendJson(res, 200, { ok: true, emailError: errosEmail.join(' | ') });
    return sendJson(res, 200, { ok: true });
  }

  // GET /api/emails-log
  if (parts.length === 2 && parts[1] === 'emails-log' && method === 'GET') {
    const rows = db.prepare('SELECT id, para_email, assunto, tipo, enviado, criado_em FROM emails_log ORDER BY id DESC LIMIT 100').all();
    return sendJson(res, 200, rows);
  }

  return sendJson(res, 404, { error: 'Rota não encontrada.' });
}

// ---------- Arquivos estáticos ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const publico = ['/login.html', '/login.js', '/assinar.html', '/assinar.js', '/styles.css'].includes(p) || p.startsWith('/fonts/');
  if (!publico && !sessaoDe(req)) {
    res.writeHead(302, { Location: '/login.html' });
    res.end();
    return;
  }
  const file = path.normalize(path.join(__dirname, 'public', p));
  if (!file.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403); res.end('negado'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('não encontrado'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- Servidor ----------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (e) {
    sendJson(res, e.message === 'payload grande demais' ? 413 : 400, { error: e.message });
  }
});

const HOST = process.env.HOST || '127.0.0.1';
server.listen(PORT, HOST, () => {
  const cfg = getConfig();
  console.log(`Servidor no ar: http://localhost:${PORT}`);
  console.log(smtpConfigured(cfg) ? 'SMTP configurado.' : 'SMTP NÃO configurado — rodando em modo teste (e-mails vão para o log).');
});
