// Mini-motor de variáveis da descrição da campanha.
// {{COLUNA}} -> valor da coluna (da primeira linha do grupo)
// {{NOME}} / {{EMAIL}} -> dados do destinatário
// {{#linhas}} ... {{/linhas}} -> repete o trecho para cada linha do grupo
// {{@n}} -> número da linha dentro do bloco (começa em 1)
// Variável desconhecida é mantida como está, para evidenciar erros.
export function renderTemplate(text, ctx = {}) {
  const { nome = '', email = '', dados = {}, linhas = [] } = ctx;
  const escalar = (tpl, row, idx) => tpl.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, nomeVar) => {
    const n = String(nomeVar).trim();
    if (n === '@n' && idx !== undefined) return String(idx + 1);
    if (/^nome$/i.test(n)) return String(nome);
    if (/^e?-?mail$/i.test(n)) return String(email);
    const alvo = row || dados || {};
    const chave = Object.keys(alvo).find((k) => k.toLowerCase() === n.toLowerCase());
    if (chave === undefined) return m;
    const v = alvo[chave];
    return v === null || v === undefined ? '' : String(v);
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
