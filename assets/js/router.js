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
  try {
    await carregarCatalogo();
  } catch (e) {
    telaDeErro(e.message);
    return;
  }
  catalogoPronto = true;
  $('#boot').hidden = true;
  await aplicarRota();
}

window.addEventListener('hashchange', aplicarRota);
$('#form-login').addEventListener('submit', tentarLogin);

iniciar();
