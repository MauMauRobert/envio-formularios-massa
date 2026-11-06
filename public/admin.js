import { parsePlanilha, agruparContatos, detectarMapa } from './planilha.js';

const $ = (id) => document.getElementById(id);
let campanhaAberta = null;

function alerta(msg, tipo = 'sucesso') {
  const el = $('alerta');
  el.textContent = msg;
  el.className = 'alerta ' + tipo;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  clearTimeout(alerta._t);
  alerta._t = setTimeout(() => el.classList.add('oculto'), 6000);
}

async function api(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Falha (${r.status})`);
  return data;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- SMTP ----------
async function carregarConfig() {
  const cfg = await api('GET', '/api/config');
  $('smtp_host').value = cfg.smtp_host;
  $('smtp_port').value = cfg.smtp_port;
  $('smtp_user').value = cfg.smtp_user;
  $('smtp_from').value = cfg.smtp_from;
  $('base_url').value = cfg.base_url;
  $('smtp_pass').placeholder = cfg.smtp_pass_set ? '•••••••• (já salva)' : '••••••••';
  $('smtpStatus').innerHTML = cfg.smtp_configured
    ? '<span class="etiqueta ok">SMTP configurado</span>'
    : '<span class="etiqueta aviso">modo teste (sem SMTP)</span>';
}

$('btnSalvarSmtp').onclick = async () => {
  try {
    const r = await api('POST', '/api/config', {
      smtp_host: $('smtp_host').value, smtp_port: $('smtp_port').value,
      smtp_user: $('smtp_user').value, smtp_pass: $('smtp_pass').value,
      smtp_from: $('smtp_from').value, base_url: $('base_url').value,
    });
    $('smtp_pass').value = '';
    await carregarConfig();
    alerta(r.smtp_configured ? 'SMTP salvo e pronto para enviar.' : 'Configuração salva. Ainda em modo teste.');
  } catch (e) { alerta(e.message, 'erro'); }
};

$('btnTestarSmtp').onclick = async () => {
  try {
    const r = await api('POST', '/api/config/teste', { para: $('testePara').value });
    alerta(r.testMode ? r.msg : 'E-mail de teste enviado!', r.testMode ? 'aviso' : 'sucesso');
    carregarLog();
  } catch (e) { alerta(e.message, 'erro'); }
};

// ---------- Campanhas ----------
async function carregarCampanhas() {
  const lista = await api('GET', '/api/campanhas');
  $('tabelaCampanhas').innerHTML = lista.length ? lista.map((c) => `
    <tr>
      <td><b>${esc(c.titulo)}</b><br><span style="color:#57534e;font-size:12px">${esc(c.email_retorno)}</span></td>
      <td>${c.total}</td><td>${c.enviados || 0}</td><td>${c.assinados || 0}</td>
      <td style="white-space:nowrap"><button class="secundario" data-abrir="${c.id}">Abrir</button> <button class="secundario" data-excluir="${c.id}" data-titulo="${esc(c.titulo)}" data-total="${c.total}">Excluir</button></td>
    </tr>`).join('')
    : '<tr><td colspan="5">Nenhuma campanha ainda.</td></tr>';
  document.querySelectorAll('[data-abrir]').forEach((b) => {
    b.onclick = () => abrirCampanha(Number(b.dataset.abrir));
  });
  document.querySelectorAll('[data-excluir]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm(`Excluir a campanha "${b.dataset.titulo}" e seus ${b.dataset.total} contato(s)?`)) return;
      try {
        await api('DELETE', `/api/campanhas/${b.dataset.excluir}`);
        alerta('Campanha excluída.');
        carregarCampanhas();
      } catch (e) { alerta(e.message, 'erro'); }
    };
  });
}

const lerDataUrl = (file) => new Promise((res, rej) => {
  if (!file) return res('');
  if (file.size > 2 * 1024 * 1024) return rej(new Error('Imagem maior que 2 MB.'));
  const r = new FileReader();
  r.onload = () => res(String(r.result || ''));
  r.onerror = () => rej(new Error('Falha ao ler a imagem.'));
  r.readAsDataURL(file);
});

$('btnCriarCampanha').onclick = async () => {
  try {
    const corpo = {
      titulo: $('campTitulo').value, descricao: $('campDescricao').value,
      email_retorno: $('campRetorno').value,
      descricao_cliente: $('campMsgCliente').value,
      descricao_pdf: $('campPdfCliente').value,
      titulo_alinhamento: $('campAlinhamento').value, logo_posicao: $('campLogoPos').value,
      imagem_alinhamento: $('campImagemPos').value,
    };
    const fImg = $('campImagem').files[0];
    if (fImg) corpo.imagem = await lerDataUrl(fImg);
    const fLogo = $('campLogo').files[0];
    if (fLogo) corpo.logo = await lerDataUrl(fLogo);
    const r = await api('POST', '/api/campanhas', corpo);
    $('campTitulo').value = ''; $('campDescricao').value = ''; $('campMsgCliente').value = ''; $('campPdfCliente').value = '';
    $('campImagem').value = ''; $('campLogo').value = '';
    alerta('Campanha criada! Agora importe a planilha.');
    await carregarCampanhas();
    abrirCampanha(r.id);
  } catch (e) { alerta(e.message, 'erro'); }
};

async function carregarLog() {
  const rows = await api('GET', '/api/emails-log');
  $('tabelaLog').innerHTML = rows.length ? rows.map((m) => `
    <tr><td>${esc(m.criado_em)}</td><td>${esc(m.para_email)}</td>
    <td>${esc(m.assunto)}</td><td>${esc(m.tipo)}</td>
    <td>${m.enviado ? 'sim' : 'teste'}</td></tr>`).join('')
    : '<tr><td colspan="5">Nenhum e-mail registrado.</td></tr>';
}

// ---------- Detalhe ----------
async function abrirCampanha(id) {
  const { campanha, contatos } = await api('GET', `/api/campanhas/${id}`);
  campanhaAberta = campanha;
  $('visaoGeral').classList.add('oculto');
  $('visaoCampanha').classList.remove('oculto');
  $('detTitulo').textContent = campanha.titulo;
  const al = campanha.titulo_alinhamento === 'centro' ? 'center' : campanha.titulo_alinhamento === 'direita' ? 'right' : 'left';
  $('detTituloWrap').style.justifyContent = al === 'center' ? 'center' : al === 'right' ? 'flex-end' : 'flex-start';
  $('detTitulo').style.textAlign = al;
  if (campanha.tem_logo) {
    $('detLogo').src = `/api/campanhas/${campanha.id}/logo`;
    $('detLogo').classList.remove('oculto');
  } else {
    $('detLogo').classList.add('oculto');
    $('detLogo').removeAttribute('src');
  }
  $('detLogo').style.order = campanha.logo_posicao === 'depois' ? '2' : '';
  if (campanha.tem_imagem) {
    $('detBanner').src = `/api/campanhas/${campanha.id}/imagem`;
    $('detBanner').classList.remove('oculto');
  } else {
    $('detBanner').classList.add('oculto');
    $('detBanner').removeAttribute('src');
  }
  const mia = campanha.imagem_alinhamento === 'centro' ? '0 auto 14px' : campanha.imagem_alinhamento === 'direita' ? '0 0 14px auto' : '0 auto 14px 0';
  $('detBanner').style.margin = mia;
  $('editImagemPos').value = campanha.imagem_alinhamento || 'esquerda';
  $('detResumo').textContent = `Cópia vai para ${campanha.email_retorno} • ${contatos.length} contato(s)`;
  $('detDescricao').textContent = campanha.descricao || '(sem descrição)';
  $('editTitulo').value = campanha.titulo;
  $('editRetorno').value = campanha.email_retorno;
  $('editDescricao').value = campanha.descricao || '';
  $('msgCliente').value = campanha.descricao_cliente || '';
  $('msgPdf').value = campanha.descricao_pdf || '';
  $('editAlinhamento').value = campanha.titulo_alinhamento || 'esquerda';
  $('editLogoPos').value = campanha.logo_posicao || 'antes';
  $('editImagem').value = '';
  $('editLogo').value = '';
  $('editRemoverImagem').checked = false;
  $('editRemoverLogo').checked = false;
  renderContatos(contatos);
  planilha = null;
  $('previaCsv').textContent = '';
  $('arquivoCsv').value = '';
  for (const id of ['mapNome', 'mapEmail', 'mapGrupo', 'mapEmailCc', 'mapNomeLinha']) $(id).innerHTML = '';
  window.scrollTo({ top: 0 });
}

$('btnSalvarCampanha').onclick = async () => {
  try {
    const corpo = {
      titulo: $('editTitulo').value, descricao: $('editDescricao').value,
      email_retorno: $('editRetorno').value,
      titulo_alinhamento: $('editAlinhamento').value, logo_posicao: $('editLogoPos').value,
      imagem_alinhamento: $('editImagemPos').value,
    };
    if ($('editRemoverImagem').checked) corpo.imagem = '';
    else if ($('editImagem').files[0]) corpo.imagem = await lerDataUrl($('editImagem').files[0]);
    if ($('editRemoverLogo').checked) corpo.logo = '';
    else if ($('editLogo').files[0]) corpo.logo = await lerDataUrl($('editLogo').files[0]);
    await api('PUT', `/api/campanhas/${campanhaAberta.id}`, corpo);
    alerta('Campanha atualizada! Os reenvios usarão os novos dados.');
    abrirCampanha(campanhaAberta.id);
  } catch (e) { alerta(e.message, 'erro'); }
};

$('btnSalvarMsgCliente').onclick = async () => {
  if (!campanhaAberta) return;
  try {
    await api('PUT', `/api/campanhas/${campanhaAberta.id}`, {
      titulo: campanhaAberta.titulo, descricao: campanhaAberta.descricao,
      email_retorno: campanhaAberta.email_retorno,
      titulo_alinhamento: campanhaAberta.titulo_alinhamento, logo_posicao: campanhaAberta.logo_posicao,
      imagem_alinhamento: campanhaAberta.imagem_alinhamento,
      descricao_cliente: $('msgCliente').value,
      descricao_pdf: $('msgPdf').value,
    });
    alerta('Textos do cliente salvos!');
    abrirCampanha(campanhaAberta.id);
  } catch (e) { alerta(e.message, 'erro'); }
};

$('btnVoltar').onclick = () => {
  campanhaAberta = null;
  $('visaoCampanha').classList.add('oculto');
  $('visaoGeral').classList.remove('oculto');
  carregarCampanhas();
  carregarLog();
};

function renderContatos(contatos) {
  $('tabelaContatos').innerHTML = contatos.length ? contatos.map((c) => `
    <tr><td>${esc(c.nome)}</td><td>${esc(c.email)}</td>
    <td><span class="etiqueta ${esc(c.status)}">${esc(c.status)}</span>${c.erro ? `<br><span style="font-size:11px;color:#991b1b">${esc(c.erro)}</span>` : ''}</td>
    <td>${esc(c.enviado_em || '—')}</td><td>${esc(c.assinado_em || '—')}</td>
    <td style="font-family:cursive">${esc(c.assinatura || '—')}</td>
    <td>${c.nlinhas ?? '—'}</td>
    <td style="white-space:nowrap">${(c.linhas_links && c.linhas_links.length) ? `<button class="secundario" data-linhas="${c.id}">Clientes (${c.linhas_links.filter((l) => l.status === 'assinado').length}/${c.linhas_links.length})</button> ` : ''}<button class="secundario" data-previa="${c.id}">Prévia</button> ${c.status === 'assinado' ? '' : `<button class="secundario" data-reenviar="${c.id}">Reenviar</button>`}</td></tr>`).join('')
    : '<tr><td colspan="8">Nenhum contato importado.</td></tr>';
  document.querySelectorAll('[data-reenviar]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await api('POST', `/api/campanhas/${campanhaAberta.id}/contatos/${b.dataset.reenviar}/reenviar`);
        alerta(r.testMode ? 'Convite registrado no log (modo teste).' : 'Convite reenviado!');
        abrirCampanha(campanhaAberta.id);
      } catch (e) { alerta(e.message, 'erro'); b.disabled = false; }
    };
  });
  document.querySelectorAll('[data-previa]').forEach((b) => {
    b.onclick = () => abrirPrevia(Number(b.dataset.previa));
  });
  document.querySelectorAll('[data-linhas]').forEach((b) => {
    b.onclick = () => abrirLinhas(Number(b.dataset.linhas));
  });
}

// ---------- Planilha ----------
let planilha = null; // { colunas, linhas, prontos }

function mapaAtual() {
  return {
    nome: $('mapNome').value || '', email: $('mapEmail').value || '', grupo: $('mapGrupo').value || '',
    emailCc: $('mapEmailCc').value || '', nomeLinha: $('mapNomeLinha').value || '',
  };
}

function preencherMapas() {
  const det = detectarMapa(planilha.colunas);
  const opcoes = (atual) => planilha.colunas.map((c) => `<option value="${esc(c)}"${c === atual ? ' selected' : ''}>${esc(c)}</option>`).join('');
  $('mapNome').innerHTML = opcoes(det.nome);
  $('mapEmail').innerHTML = `<option value="">(sem e-mail do cliente)</option>` + opcoes(det.email);
  $('mapGrupo').innerHTML = `<option value="">(sem agrupar — 1 por linha)</option>` + opcoes('');
  $('mapEmailCc').innerHTML = `<option value="">(sem e-mail cópia)</option>` + opcoes(det.emailCc);
  $('mapNomeLinha').innerHTML = `<option value="">(igual à coluna do nome)</option>` + opcoes('');
}

function atualizarPrevia() {
  if (!planilha) return;
  let res;
  try {
    res = agruparContatos(planilha.colunas, planilha.linhas, mapaAtual(), { temCabecalho: $('temCabecalho').checked });
  } catch (e) {
    planilha.prontos = [];
    $('previaCsv').textContent = e.message;
    return;
  }
  planilha.prontos = res.contatos;
  let msg = `${planilha.linhas.length} linha(s) → ${res.contatos.length} destinatário(s).`;
  if (res.ignorados.length) {
    msg += ` Ignorados (${res.ignorados.length}): ${res.ignorados.slice(0, 5).map((i) => `${i.chave} (${i.motivo})`).join('; ')}${res.ignorados.length > 5 ? '…' : ''}`;
  }
  $('previaCsv').textContent = msg;
}

function lerArquivo() {
  const f = $('arquivoCsv').files[0];
  if (!f) {
    planilha = null;
    $('previaCsv').textContent = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      planilha = parsePlanilha(String(reader.result || ''), { temCabecalho: $('temCabecalho').checked });
    } catch (e) {
      planilha = null;
      alerta('Não consegui ler o CSV: ' + e.message, 'erro');
      return;
    }
    if (!planilha.linhas.length) {
      $('previaCsv').textContent = 'Nenhuma linha de dados encontrada no arquivo.';
      return;
    }
    preencherMapas();
    atualizarPrevia();
  };
  reader.readAsText(f, 'utf-8');
}

$('arquivoCsv').onchange = lerArquivo;
$('temCabecalho').onchange = lerArquivo;
$('mapNome').onchange = atualizarPrevia;
$('mapEmail').onchange = atualizarPrevia;
$('mapGrupo').onchange = atualizarPrevia;
$('mapEmailCc').onchange = atualizarPrevia;
$('mapNomeLinha').onchange = atualizarPrevia;

$('btnImportar').onclick = async () => {
  if (!planilha || !planilha.prontos || !planilha.prontos.length) {
    alerta('Nada para importar: confira o arquivo e o mapeamento.', 'aviso');
    return;
  }
  try {
    const r = await api('POST', `/api/campanhas/${campanhaAberta.id}/contatos`, { contatos: planilha.prontos });
    alerta(`Importados: ${r.adicionados}. Ignorados (duplicados/inválidos): ${r.ignorados}.`);
    abrirCampanha(campanhaAberta.id);
  } catch (e) { alerta(e.message, 'erro'); }
};

$('btnDisparar').onclick = async () => {
  if (!confirm('Enviar convites para todos os contatos pendentes?')) return;
  $('btnDisparar').disabled = true;
  $('statusDisparo').textContent = 'Enviando…';
  try {
    const r = await api('POST', `/api/campanhas/${campanhaAberta.id}/disparar`);
    $('statusDisparo').textContent = '';
    alerta(r.testMode
      ? `Modo teste: ${r.enviados} e-mail(s) registrados no log (SMTP não configurado).`
      : `Disparo concluído: ${r.enviados} enviado(s), ${r.falhas.length} falha(s).`,
      r.falhas.length ? 'aviso' : 'sucesso');
    abrirCampanha(campanhaAberta.id);
  } catch (e) {
    $('statusDisparo').textContent = '';
    alerta(e.message, 'erro');
  }
  $('btnDisparar').disabled = false;
};

$('btnReenviarTodos').onclick = async () => {
  if (!confirm('Reenviar convites para TODOS os contatos não assinados (inclusive já enviados)?')) return;
  $('btnReenviarTodos').disabled = true;
  try {
    const r = await api('POST', `/api/campanhas/${campanhaAberta.id}/reenviar-todos`);
    alerta(r.testMode
      ? `Modo teste: ${r.enviados} convite(s) registrado(s) no log.`
      : `Reenvio concluído: ${r.enviados} enviado(s), ${r.falhas.length} falha(s).`,
      r.falhas.length ? 'aviso' : 'sucesso');
    abrirCampanha(campanhaAberta.id);
  } catch (e) { alerta(e.message, 'erro'); }
  $('btnReenviarTodos').disabled = false;
};

$('btnApagarContatos').onclick = async () => {
  if (!campanhaAberta) return;
  let contatos = [];
  try {
    ({ contatos } = await api('GET', `/api/campanhas/${campanhaAberta.id}`));
  } catch (e) { alerta(e.message, 'erro'); return; }
  if (!contatos.length) { alerta('Esta campanha não tem contatos.', 'aviso'); return; }
  if (!confirm(`Apagar os ${contatos.length} contato(s) e todas as assinaturas desta campanha? A campanha será mantida e você poderá importar de novo.`)) return;
  try {
    const r = await api('DELETE', `/api/campanhas/${campanhaAberta.id}/contatos`);
    alerta(`Apagados ${r.apagados} contato(s) e suas assinaturas.`);
    abrirCampanha(campanhaAberta.id);
  } catch (e) { alerta(e.message, 'erro'); }
};

async function abrirPrevia(contatoId) {
  try {
    const p = await api('GET', `/api/campanhas/${campanhaAberta.id}/contatos/${contatoId}/previa`);
    $('previaTitulo').textContent = p.assunto;
    $('previaPara').textContent = `Para: ${p.nome} <${p.email}>` + (p.pdfs ? ` • ${p.pdfs} PDF(s) anexado(s), um por cliente` : '');
    $('previaCorpo').innerHTML = p.html;
    $('modalPrevia').classList.remove('oculto');
  } catch (e) { alerta(e.message, 'erro'); }
}
$('btnFecharPrevia').onclick = () => $('modalPrevia').classList.add('oculto');
$('modalPrevia').onclick = (e) => { if (e.target.id === 'modalPrevia') $('modalPrevia').classList.add('oculto'); };

async function abrirLinhas(contatoId) {
  try {
    const { contatos } = await api('GET', `/api/campanhas/${campanhaAberta.id}`);
    const ct = contatos.find((x) => x.id === contatoId);
    if (!ct || !ct.linhas_links || !ct.linhas_links.length) { alerta('Sem clientes vinculados.', 'aviso'); return; }
    $('linhasTitulo').textContent = `Clientes — ${ct.nome}`;
    const ok = ct.linhas_links.filter((l) => l.status === 'assinado').length;
    $('linhasResumo').textContent = `${ok} de ${ct.linhas_links.length} assinados. Encaminhe cada link ao cliente.`;
    $('tabelaLinhas').innerHTML = ct.linhas_links.map((l) => {
      const link = `${location.origin}/assinar.html?token=${l.token}`;
      return `<tr><td>${esc(l.nome)}${l.email ? `<br><span style="color:#57534e;font-size:12px">${esc(l.email)}</span>` : ''}</td>
      <td><span class="etiqueta ${esc(l.status)}">${esc(l.status)}</span></td>
      <td>${esc(l.assinado_em || '—')}</td>
      <td><button class="secundario" data-copiar="${esc(link)}">Copiar link</button></td></tr>`;
    }).join('');
    document.querySelectorAll('[data-copiar]').forEach((b) => {
      b.onclick = async () => {
        try { await navigator.clipboard.writeText(b.dataset.copiar); b.textContent = 'Copiado!'; }
        catch { prompt('Copie o link:', b.dataset.copiar); }
      };
    });
    $('modalLinhas').classList.remove('oculto');
  } catch (e) { alerta(e.message, 'erro'); }
}
$('btnFecharLinhas').onclick = () => $('modalLinhas').classList.add('oculto');
$('modalLinhas').onclick = (e) => { if (e.target.id === 'modalLinhas') $('modalLinhas').classList.add('oculto'); };

// ---------- Usuários ----------
async function carregarUsuarios() {
  const lista = await api('GET', '/api/usuarios');
  $('tabelaUsuarios').innerHTML = lista.map((u) => `<tr><td>${esc(u.usuario)}</td><td>${esc(u.criado_em)}</td></tr>`).join('');
}

$('btnCriarUsuario').onclick = async () => {
  try {
    await api('POST', '/api/usuarios', { usuario: $('novoUsuario').value.trim(), senha: $('novaSenha').value });
    $('novoUsuario').value = '';
    $('novaSenha').value = '';
    alerta('Usuário criado!');
    carregarUsuarios();
  } catch (e) { alerta(e.message, 'erro'); }
};

$('btnSair').onclick = async () => {
  try { await api('POST', '/api/logout'); } catch {}
  location.href = '/login.html';
};

// ---------- Início ----------
(async () => {
  try {
    const s = await api('GET', '/api/sessao');
    if (!s.logado) { location.href = '/login.html'; return; }
    $('usuarioLogado').textContent = s.usuario;
  } catch {
    location.href = '/login.html';
    return;
  }
  carregarConfig().catch((e) => alerta(e.message, 'erro'));
  carregarCampanhas().catch((e) => alerta(e.message, 'erro'));
  carregarLog().catch(() => {});
  carregarUsuarios().catch(() => {});
})();
