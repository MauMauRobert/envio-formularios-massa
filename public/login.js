const $ = (id) => document.getElementById(id);
let setup = false;

function alerta(msg, tipo = 'erro') {
  const el = $('alerta');
  el.textContent = msg;
  el.className = 'alerta ' + tipo;
}

async function init() {
  try {
    const r = await fetch('/api/sessao');
    const s = await r.json();
    if (s.logado) { location.href = '/'; return; }
    if (s.setupNecessario) {
      setup = true;
      $('tituloLogin').textContent = 'Criar administrador';
      $('subtitulo').textContent = 'Primeiro acesso: crie o usuário inicial';
      $('dicaLogin').textContent = 'Mínimo 8 caracteres na senha.';
      $('loginSenha').autocomplete = 'new-password';
      $('btnEntrar').textContent = 'Criar e entrar';
    }
  } catch {
    alerta('Falha ao falar com o servidor.');
  }
}

async function entrar() {
  const usuario = $('loginUsuario').value.trim();
  const senha = $('loginSenha').value;
  if (!usuario || !senha) { alerta('Informe usuário e senha.', 'aviso'); return; }
  $('btnEntrar').disabled = true;
  try {
    const r = await fetch(setup ? '/api/setup' : '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, senha }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Falha ao entrar.');
    location.href = '/';
  } catch (e) {
    alerta(e.message);
    $('btnEntrar').disabled = false;
  }
}

$('btnEntrar').onclick = entrar;
$('loginSenha').addEventListener('keydown', (e) => { if (e.key === 'Enter') entrar(); });
init();
