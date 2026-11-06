const $ = (id) => document.getElementById(id);
const token = new URLSearchParams(location.search).get('token');

function alerta(msg, tipo = 'erro') {
  const el = $('alerta');
  el.textContent = msg;
  el.className = 'alerta ' + tipo;
}

function mostrarOk(nome, quando) {
  $('cartaoForm').classList.add('oculto');
  $('cartaoOk').classList.remove('oculto');
  $('resumoOk').textContent = `Assinado por ${nome} em ${quando}.`;
}

async function init() {
  if (!token) {
    $('cartaoForm').classList.add('oculto');
    alerta('Link inválido: token não informado.');
    return;
  }
  let dados;
  try {
    const r = await fetch(`/api/assinatura/${encodeURIComponent(token)}`);
    dados = await r.json();
    if (!r.ok) throw new Error(dados.error || 'Link inválido.');
  } catch (e) {
    $('cartaoForm').classList.add('oculto');
    alerta(e.message);
    return;
  }
  $('titulo').textContent = dados.titulo;
  document.title = `Assinar — ${dados.titulo}`;
  $('descricao').textContent = dados.descricao || '';
  $('nome').value = dados.nome;
  $('email').value = dados.email;
  if (!dados.email) {
    $('email').removeAttribute('readonly');
    $('email').classList.remove('somente-leitura');
    $('email').placeholder = 'Seu e-mail (para receber a cópia)';
  }
  if (dados.tem_imagem) {
    $('banner').src = `/api/assinatura/${encodeURIComponent(token)}/imagem`;
    $('banner').classList.remove('oculto');
  }
  if (dados.tem_logo) {
    $('logo').src = `/api/assinatura/${encodeURIComponent(token)}/logo`;
    $('logo').classList.remove('oculto');
  }
  if (dados.logo_posicao === 'depois') $('logo').style.order = '2';
  const al = dados.titulo_alinhamento === 'centro' ? 'center' : dados.titulo_alinhamento === 'direita' ? 'right' : 'left';
  $('tituloWrap').style.justifyContent = al === 'center' ? 'center' : al === 'right' ? 'flex-end' : 'flex-start';
  $('tituloTexto').style.textAlign = al;
  const mia = dados.imagem_alinhamento === 'centro' ? '0 auto 14px' : dados.imagem_alinhamento === 'direita' ? '0 0 14px auto' : '0 auto 14px 0';
  $('banner').style.margin = mia;
  if (dados.assinado) {
    mostrarOk(dados.assinatura || dados.nome, dados.assinado_em || '');
    return;
  }
  $('assinatura').value = dados.nome;
  $('previaAssinatura').textContent = dados.nome;
}

$('assinatura').addEventListener('input', (e) => {
  $('previaAssinatura').textContent = e.target.value;
});

$('btnAssinar').onclick = async () => {
  const assinatura = $('assinatura').value.trim();
  if (assinatura.length < 2) { alerta('Digite sua assinatura (seu nome completo).', 'aviso'); return; }
  $('btnAssinar').disabled = true;
  try {
    const r = await fetch(`/api/assinatura/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assinatura, email: $('email').value.trim() }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Falha ao assinar.');
    if (data.emailError) {
      mostrarOk(assinatura, new Date().toLocaleString('pt-BR'));
      alerta('Assinatura registrada, mas houve falha no envio das cópias: ' + data.emailError, 'aviso');
    } else {
      mostrarOk(assinatura, new Date().toLocaleString('pt-BR'));
    }
  } catch (e) {
    alerta(e.message);
    $('btnAssinar').disabled = false;
  }
};

init();
