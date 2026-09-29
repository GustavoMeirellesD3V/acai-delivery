/* =========================================================
   Açaí Mais Chantilly — inicialização e rotas
   #admin abre a área do lojista; qualquer outro hash, a loja.
   ========================================================= */

let viewAtual = null;
let catalogoPronto = false;

function telaDeErro(msg) {
  $('#boot').hidden = true;
  $('#view-loja').hidden = true;
  $('#view-admin').hidden = true;
  $('#erro-fatal').hidden = false;
  $('#erro-fatal-msg').textContent = msg;
}

/* Mensagem para quem está do outro lado da tela: nada de código de
   erro do Postgres, e sempre uma saída — o botão ou o WhatsApp. */
function mensagemDeFalha(e) {
  const m = String((e && e.message) || e || '');
  if (/PGRST303|issued at future/i.test(m)) {
    return 'O servidor demorou para responder. Toque em "Tentar de novo" — costuma resolver na hora.';
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) {
    return 'Sem conexão com o servidor. Confira sua internet e tente de novo.';
  }
  if (/config\.js/i.test(m)) return m;   // erro de configuração: é para o dev ver
  return 'Não conseguimos carregar o cardápio agora. Tente de novo em instantes.';
}

async function aplicarRota() {
  if (!catalogoPronto) return;

  const alvo = location.hash === '#admin' ? 'admin' : 'loja';
  if (alvo === viewAtual) return; // âncoras internas não recarregam nada

  viewAtual = alvo;
  fecharTodosModais();
  $('#view-loja').hidden = alvo === 'admin';
  $('#view-admin').hidden = alvo !== 'admin';

  if (alvo === 'admin') {
    const user = await usuarioAtual();
    if (user) {
      await mostrarPainel();
    } else {
      $('#admin-painel').hidden = true;
      $('#admin-login').hidden = false;
    }
  } else {
    pararDeOuvir();
    renderLoja();
  }
  window.scrollTo({ top: 0 });
}

async function iniciar() {
  $('#erro-fatal').hidden = true;
  $('#boot').hidden = false;
  try {
    await carregarCatalogo();
  } catch (e) {
    console.error('Falha ao carregar o catálogo:', e);
    telaDeErro(mensagemDeFalha(e));
    return;
  }
  catalogoPronto = true;
  viewAtual = null;          // força o render depois de uma retentativa
  $('#boot').hidden = true;
  await aplicarRota();
}

window.addEventListener('hashchange', aplicarRota);
$('#form-login').addEventListener('submit', tentarLogin);

$('#btn-tentar-de-novo').addEventListener('click', async (ev) => {
  const b = ev.currentTarget;
  b.disabled = true;
  b.textContent = 'Carregando…';
  await iniciar();
  b.disabled = false;
  b.textContent = 'Tentar de novo';
});

iniciar();
