// Leitura de CSV e agrupamento de destinatários. Puro, sem DOM:
// usado pelo painel (admin.js) e reaproveitado nos testes via import.
export function parsePlanilha(text, { temCabecalho = true } = {}) {
  const limpo = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const linhasRaw = limpo.split('\n').filter((l) => l.trim() !== '');
  if (!linhasRaw.length) return { colunas: [], linhas: [] };
  const primeira = linhasRaw[0];
  const delim = (primeira.match(/;/g) || []).length >= (primeira.match(/,/g) || []).length ? ';' : ',';
  const dividir = (line) => {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else { q = false; }
        } else { cur += ch; }
      } else if (ch === '"') { q = true; }
      else if (ch === delim) { out.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    out.push(cur.trim());
    return out;
  };
  const tabela = linhasRaw.map(dividir);
  const nCols = Math.max(...tabela.map((r) => r.length));
  let colunas;
  let dados;
  if (temCabecalho) {
    colunas = tabela[0].map((h, i) => h || `Coluna ${i + 1}`);
    dados = tabela.slice(1);
  } else {
    colunas = Array.from({ length: nCols }, (_, i) => `Coluna ${i + 1}`);
    dados = tabela;
  }
  const vistos = new Map();
  colunas = colunas.map((c) => {
    const n = (vistos.get(c) || 0) + 1;
    vistos.set(c, n);
    return n === 1 ? c : `${c} (${n})`;
  });
  const linhas = [];
  for (const cells of dados) {
    const obj = {};
    colunas.forEach((c, i) => { obj[c] = cells[i] || ''; });
    if (Object.values(obj).some((v) => v !== '')) linhas.push(obj);
  }
  return { colunas, linhas };
}

export function detectarMapa(colunas) {
  const lower = colunas.map((c) => c.toLowerCase());
  const achar = (pred) => {
    const i = lower.findIndex(pred);
    return i === -1 ? '' : colunas[i];
  };
  return {
    nome: achar((c) => c.includes('nome')),
    email: achar((c) => c.includes('mail') || c.includes('e-mail')),
    grupo: '',
    emailCc: achar((c) => c.includes('copia') || c.includes('cópia') || c === 'cc'),
    nomeLinha: '',
  };
}

export function agruparContatos(colunas, linhas, mapa, { temCabecalho = true } = {}) {
  const cNome = mapa.nome || '';
  const cEmail = mapa.email || '';
  const cGrupo = mapa.grupo || '';
  const cCc = mapa.emailCc || '';
  const cNomeLinha = mapa.nomeLinha || cNome;
  if (!cNome || !colunas.includes(cNome)) throw new Error('Mapeie a coluna do nome.');
  if (cGrupo && !colunas.includes(cGrupo)) throw new Error('Coluna de agrupamento inválida.');
  if (cEmail && !colunas.includes(cEmail)) throw new Error('Coluna de e-mail inválida.');
  if (cCc && !colunas.includes(cCc)) throw new Error('Coluna de e-mail cópia inválida.');
  if (!colunas.includes(cNomeLinha)) throw new Error('Coluna de nome nas linhas inválida.');
  if (cGrupo && !cCc) throw new Error('Com agrupamento, mapeie a coluna do e-mail cópia (vendedor).');
  if (!cGrupo && !cEmail) throw new Error('Sem agrupamento, mapeie a coluna do e-mail.');
  const rotulo = (idx) => `linha ${idx + (temCabecalho ? 2 : 1)}`;
  const primeiro = (itens, col) => (col ? itens.map((it) => it.row[col] || '').find((v) => v) || '' : '');
  const ignorados = [];
  const grupos = new Map();
  linhas.forEach((row, idx) => {
    const chave = cGrupo ? (row[cGrupo] || '') : `#${idx}`;
    if (cGrupo && !chave) {
      ignorados.push({ chave: rotulo(idx), motivo: 'sem valor na coluna de agrupamento' });
      return;
    }
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push({ row, idx });
  });
  const contatos = [];
  for (const [chave, itens] of grupos) {
    const nome = primeiro(itens, cNome);
    const email = cGrupo ? primeiro(itens, cCc) : primeiro(itens, cEmail);
    if (!nome || !email) {
      ignorados.push({
        chave: cGrupo ? String(chave) : rotulo(itens[0].idx),
        motivo: !email ? (cGrupo ? 'sem e-mail cópia' : 'sem e-mail') : 'sem nome',
      });
      continue;
    }
    const rows = itens.map((it) => it.row);
    contatos.push({
      nome,
      email,
      email_copia: primeiro(itens, cCc),
      dados: rows[0],
      linhas: rows,
      nomes_linha: rows.map((r, i) => (r[cNomeLinha] || r[cNome] || '').trim() || `Linha ${i + 1}`),
      emails_linha: rows.map((r) => (cEmail ? (r[cEmail] || '').trim() : '')),
      comLinks: !!cGrupo,
    });
  }
  return { contatos, ignorados };
}
