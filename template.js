// Mini-motor de variáveis da descrição da campanha.
// {{COLUNA}} -> valor da coluna (linha atual no loop; fora dele, dados do grupo ou primeira linha)
// {{NOME}} / {{EMAIL}} -> dados do destinatário
// {{#linhas}} ... {{/linhas}} -> repete o trecho para cada linha do grupo
// {{@n}} -> número da linha dentro do bloco (1, 2, 3...); {{@n0}} com zero (01, 02...)
// {{@total}} -> quantidade de linhas do destinatário
// {{moeda:COLUNA}} -> valor formatado em R$ pt-BR (aceita número US e BR)
// {{primeiro:COLUNA}} -> primeiro nome ("982 - PEDRO MEN" -> "Pedro")
// CRESCIMENTO / TOTAL_FATURADO / TOTAL_META / TOTAL_CRESCIMENTO -> calculados
// de VLR_TOTAL/VLR_NOVO quando a planilha não tem essas colunas.
// Variável sem dado na planilha sai em branco.
export function parseNumero(txt) {
  let t = String(txt || '').replace(/[R$\s]/g, '');
  if (!t) return null;
  const virg = t.includes(',');
  const ponto = t.includes('.');
  if (virg && ponto) {
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
  } else if (virg) {
    t = /^-?[^,]*,\d{3}$/.test(t) ? t.replace(',', '') : t.replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, '');
  }
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export function fmtMoeda(v) {
  return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const COLS_TOTAL = ['VLR_TOTAL', 'FATURAMENTO', 'VALOR_TOTAL', 'VLR'];
const COLS_META = ['META', 'VLR_META', 'VLR_NOVO', 'META_CLIENTE'];

const achaChave = (obj, nome) => Object.keys(obj).find((k) => k.toLowerCase() === String(nome).toLowerCase());
const temChave = (obj, nome) => achaChave(obj, nome) !== undefined;

export function primeiroNome(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const semCod = s.includes('-') ? s.split('-').slice(1).join('-').trim() : s;
  const w = ((semCod || s).split(/\s+/)[0]) || '';
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

// Deriva CRESCIMENTO por linha e totais do grupo a partir de
// VLR_TOTAL/VLR_NOVO. Nunca sobrescreve coluna da planilha nem o ctx original.
export function enriquecerCtx(ctx = {}) {
  const linhas = Array.isArray(ctx.linhas)
    ? ctx.linhas.map((r) => (r && typeof r === 'object' ? { ...r } : r))
    : [];
  const dados = (ctx.dados && typeof ctx.dados === 'object') ? { ...ctx.dados } : {};
  const numDe = (row, nomes) => {
    if (!row || typeof row !== 'object') return null;
    for (const nm of nomes) {
      const k = achaChave(row, nm);
      if (k !== undefined) {
        const v = parseNumero(row[k]);
        if (v !== null) return v;
      }
    }
    return null;
  };
  const cent = (v) => Math.round(v * 100) / 100;
  let sT = 0; let sM = 0; let sC = 0; let nC = 0; let temT = false; let temM = false;
  for (const row of linhas) {
    const t = numDe(row, COLS_TOTAL);
    const m = numDe(row, COLS_META);
    if (t !== null) { sT += t; temT = true; }
    if (m !== null) { sM += m; temM = true; }
    if (t !== null && m !== null && row && typeof row === 'object') {
      const d = cent(m - t);
      sC += d;
      nC++;
      if (!temChave(row, 'crescimento')) row.CRESCIMENTO = String(d);
    }
  }
  if (temT && !temChave(dados, 'total_faturado')) dados.TOTAL_FATURADO = String(cent(sT));
  if (temM && !temChave(dados, 'total_meta')) dados.TOTAL_META = String(cent(sM));
  if (nC > 0 && !temChave(dados, 'total_crescimento')) dados.TOTAL_CRESCIMENTO = String(cent(sC));
  return { nome: ctx.nome ?? '', email: ctx.email ?? '', dados, linhas };
}

export function renderTemplate(text, ctx = {}) {
  const { nome = '', email = '', dados = {}, linhas = [] } = enriquecerCtx(ctx);
  const valorDe = (n, row) => {
    const fontes = row
      ? [row, dados]
      : [dados, (linhas[0] && typeof linhas[0] === 'object' ? linhas[0] : {})];
    for (const f of fontes) {
      const k = achaChave(f, n);
      if (k !== undefined) return f[k];
    }
    return undefined;
  };
  const escalar = (tpl, row, idx) => tpl.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, nomeVar) => {
    const n = String(nomeVar).trim();
    if (n === '@n' && idx !== undefined) return String(idx + 1);
    if (/^@n0$/i.test(n) && idx !== undefined) return String(idx + 1).padStart(2, '0');
    if (/^@total$/i.test(n)) return String(Array.isArray(linhas) ? linhas.length : 0);
    if (/^nome$/i.test(n)) return String(nome);
    if (/^e?-?mail$/i.test(n)) return String(email);
    let pref = n.match(/^moeda\s*:\s*(.+)$/i);
    if (pref) {
      const raw = valorDe(pref[1].trim(), row);
      if (raw === undefined || raw === null || String(raw).trim() === '') return '';
      const v = parseNumero(raw);
      return v === null ? String(raw) : fmtMoeda(v);
    }
    pref = n.match(/^primeiro\s*:\s*(.+)$/i);
    if (pref) {
      const alvo = pref[1].trim();
      if (/^nome$/i.test(alvo)) return primeiroNome(nome);
      if (/^e?-?mail$/i.test(alvo)) return primeiroNome(email);
      const raw = valorDe(alvo, row);
      if (raw === undefined || raw === null) return '';
      return primeiroNome(raw);
    }
    const v = valorDe(n, row);
    if (v === undefined) return (n[0] === '#' || n[0] === '/') ? m : '';
    return v === null ? '' : String(v);
  });
  const comLoops = String(text ?? '').replace(/\{\{#linhas\}\}([\s\S]*?)\{\{\/linhas\}\}/g, (m, inner) => {
    if (!Array.isArray(linhas) || !linhas.length) return '';
    const corpo = inner.replace(/^\n+/, '').replace(/\n+$/, '');
    const ini = /^\n/.test(inner) ? '\n' : '';
    const fim = /\n$/.test(inner) ? '\n' : '';
    const partes = linhas.map((row, i) => escalar(corpo, row, i));
    const juncao = (ini || fim || corpo.includes('\n')) ? '\n' : '';
    return ini + partes.join(juncao) + fim;
  });
  return escalar(comLoops, null, undefined);
}

// Texto por superfície da campanha, com fallbacks:
// PDF do cliente -> mensagem do cliente -> descrição principal.
export function descCliente(camp) {
  const dc = String((camp && camp.descricao_cliente) || '');
  return dc.trim() ? dc : String((camp && camp.descricao) || '');
}
export function descPdf(camp) {
  const dp = String((camp && camp.descricao_pdf) || '');
  return dp.trim() ? dp : descCliente(camp);
}
// Injeta {{link}} próprio na linha sem sobrescrever coluna do usuário.
export function comLinkProprio(row, link) {
  const base = (row && typeof row === 'object') ? row : {};
  if (Object.keys(base).some((k) => k.toLowerCase() === 'link')) return base;
  return { ...base, link };
}

export function escaparHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Mesmo motor, mas escapando os VALORES (da planilha): o modelo com as
// tags continua intacto e os dados não quebram o HTML.
export function renderTemplateHtml(text, ctx = {}) {
  const escVal = (v) => {
    if (typeof v === 'string') return escaparHtml(v);
    if (Array.isArray(v)) return v.map(escVal);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, escVal(x)]));
    return v;
  };
  return renderTemplate(text, {
    nome: escVal(ctx.nome ?? ''),
    email: escVal(ctx.email ?? ''),
    dados: escVal(ctx.dados ?? {}),
    linhas: escVal(ctx.linhas ?? []),
  });
}

// HTML -> texto simples para o PDF (que não renderiza HTML).
export function tirarTags(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Bloqueia conteúdo ativo; o restante das tags de estilo passa.
export function sanitizarHtml(html) {
  let s = String(html ?? '');
  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, '');
  s = s.replace(/<\/?(iframe|object|embed)\b[^>]*>/gi, '');
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/href\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, 'href="#"');
  return s;
}

// Descrição HTML integral (documento <html>) x trecho (vai na moldura do convite).
export function ehDocumentoHtml(html) {
  return /<\s*html[\s>]/i.test(String(html ?? ''));
}

// Troca cid: pelos anexos reais (e-mail) ou pelas URLs (prévia/página).
export function resolverCid(html, imgs = {}) {
  let s = String(html ?? '');
  if (imgs && imgs.banner) s = s.split('cid:banner').join(String(imgs.banner));
  if (imgs && imgs.logo) s = s.split('cid:logo').join(String(imgs.logo));
  return s;
}
