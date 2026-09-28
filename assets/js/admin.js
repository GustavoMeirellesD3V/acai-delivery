/* =========================================================
   Açaí Mais Chantilly — painel do lojista
   Login pelo Supabase Auth, pedidos em tempo real.
   ========================================================= */

let abaAtual = 'pedidos';
let filtroStatus = 'ativos';
let pedidoAberto = null;
let somLigado = true;

/* ---------------- login ---------------- */
async function tentarLogin(ev) {
  ev.preventDefault();
  const erro = $('#login-erro');
  const botao = $('#btn-login');
  erro.hidden = true;
  botao.disabled = true;
  botao.textContent = 'Entrando…';

  try {
    await entrar($('#login-email').value.trim(), $('#login-senha').value);
    $('#login-senha').value = '';
    await mostrarPainel();
  } catch (e) {
    erro.hidden = false;
    erro.textContent = e.message;
  } finally {
    botao.disabled = false;
    botao.textContent = 'Entrar';
  }
}

async function sair() {
  pararDeOuvir();
  await sairDaConta();
  $('#admin-painel').hidden = true;
  $('#admin-login').hidden = false;
}

async function mostrarPainel() {
  $('#admin-login').hidden = true;
  $('#admin-painel').hidden = false;
  $('#admin-nome-loja').textContent = DB.config ? DB.config.nomeLoja : '';

  // O papel vem do banco. Esconder aba é conforto visual, não segurança:
  // quem forçar o valor aqui continua barrado pelo RLS no servidor.
  await carregarPapel();
  aplicarPapelNasAbas();
  vigiarInatividade(async () => {
    await registrarEvento('SESSAO_EXPIRADA');
    toast('Sessão expirada por inatividade.');
    sair();
  });

  $('#painel-conteudo').innerHTML = '<div class="vazio"><p>Carregando pedidos…</p></div>';
  try {
    await carregarPedidos();
  } catch (e) {
    $('#painel-conteudo').innerHTML =
      `<div class="aviso aviso--erro">Não foi possível carregar os pedidos: ${esc(e.message)}</div>`;
    return;
  }

  ouvirPedidos(aoChegarPedido, () => { if (abaAtual === 'pedidos') renderAba(); });
  renderAba();
}

function aoChegarPedido(p) {
  tocarAlerta();
  toast(`Pedido novo #${p.numero} — ${p.cliente.nome}`);
  if (abaAtual === 'pedidos') renderAba();
}

function mostrarAvisoEquipe(msg) {
  const alvo = $('#painel-conteudo');
  if (!alvo) return;
  const caixa = document.createElement('div');
  caixa.className = 'aviso aviso--erro';
  caixa.style.marginBottom = '16px';
  caixa.textContent = msg;
  alvo.prepend(caixa);
  caixa.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => caixa.remove(), 12000);
}

/* ---------------- confirmação de ação crítica ---------------- */
function confirmar(titulo, detalhe) {
  return new Promise((resolve) => {
    const caixa = document.createElement('div');
    caixa.className = 'modal';
    caixa.innerHTML = `
      <div class="modal__card" role="alertdialog" aria-modal="true" style="max-width:420px">
        <div class="modal__cab"><h2 class="modal__titulo">Confirmar</h2></div>
        <div class="modal__corpo">
          <p style="font-weight:600;margin-bottom:8px">${esc(titulo)}</p>
          ${detalhe ? `<p style="color:var(--creme-fraco);font-size:13.5px">${esc(detalhe)}</p>` : ''}
        </div>
        <div class="modal__pe">
          <button class="btn btn--linha" data-nao style="flex:1">Cancelar</button>
          <button class="btn btn--folha" data-sim style="flex:1">Confirmar</button>
        </div>
      </div>`;
    document.body.appendChild(caixa);
    const fim = (v) => { caixa.remove(); resolve(v); };
    caixa.querySelector('[data-sim]').onclick = () => fim(true);
    caixa.querySelector('[data-nao]').onclick = () => fim(false);
    caixa.onclick = (e) => { if (e.target === caixa) fim(false); };
    caixa.querySelector('[data-sim]').focus();
  });
}

/* ---------------- alerta sonoro ----------------
   Dois bipes curtos via WebAudio: não precisa de
   arquivo de som e funciona offline.
------------------------------------------------- */
let audioCtx = null;
function tocarAlerta() {
  if (!somLigado) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    [0, 0.28].forEach((atraso) => {
      const osc = audioCtx.createOscillator();
      const vol = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      vol.gain.setValueAtTime(0.0001, audioCtx.currentTime + atraso);
      vol.gain.exponentialRampToValueAtTime(0.28, audioCtx.currentTime + atraso + 0.02);
      vol.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + atraso + 0.22);
      osc.connect(vol).connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + atraso);
      osc.stop(audioCtx.currentTime + atraso + 0.24);
    });
  } catch (e) { /* som é um extra, nunca quebra o painel */ }
}

/* ---------------- papéis ---------------- */
const ABAS_POR_PAPEL = {
  admin:     ['pedidos', 'cardapio', 'complementos', 'sabores', 'config', 'equipe', 'registro'],
  gerente:   ['pedidos', 'cardapio', 'complementos', 'sabores', 'config', 'registro'],
  atendente: ['pedidos']
};

function abasPermitidas() {
  return ABAS_POR_PAPEL[papelAtual] || ABAS_POR_PAPEL.atendente;
}

function aplicarPapelNasAbas() {
  const permitidas = abasPermitidas();
  $$('#abas .aba').forEach((b) => { b.hidden = !permitidas.includes(b.dataset.aba); });
  if (!permitidas.includes(abaAtual)) abaAtual = permitidas[0];

  const selo = $('#selo-papel');
  if (selo) {
    const nomes = { admin: 'Administrador', gerente: 'Gerente', atendente: 'Atendente' };
    selo.textContent = nomes[papelAtual] || 'Sem perfil';
    selo.hidden = false;
  }
}

/* ---------------- abas ---------------- */
function renderAba() {
  $$('#abas .aba').forEach((b) => b.classList.toggle('aba--ativa', b.dataset.aba === abaAtual));
  const alvo = $('#painel-conteudo');
  if (abaAtual === 'pedidos') alvo.innerHTML = htmlPedidos();
  else if (abaAtual === 'cardapio') alvo.innerHTML = htmlCardapio();
  else if (abaAtual === 'complementos') alvo.innerHTML = htmlComplementos();
  else if (abaAtual === 'sabores') alvo.innerHTML = htmlSabores();
  else if (abaAtual === 'equipe') { alvo.innerHTML = '<div class="vazio"><p>Carregando equipe…</p></div>'; mostrarEquipe(); }
  else if (abaAtual === 'registro') { alvo.innerHTML = '<div class="vazio"><p>Carregando registro…</p></div>'; mostrarRegistro(); }
  else alvo.innerHTML = htmlConfig();
}

/* ---------------- aba: pedidos ---------------- */
function htmlPedidos() {
  const hoje = new Date().toDateString();
  const doDia = DB.pedidos.filter((p) => new Date(p.criadoEm).toDateString() === hoje && p.status !== 'cancelado');
  const faturamento = doDia.reduce((s, p) => s + p.total, 0);
  const abertos = DB.pedidos.filter((p) => ['novo', 'preparo', 'saiu', 'pronto'].includes(p.status));

  let lista = DB.pedidos;
  if (filtroStatus === 'ativos') lista = abertos;
  else if (filtroStatus !== 'todos') lista = DB.pedidos.filter((p) => p.status === filtroStatus);

  const filtros = [['ativos', 'Em aberto'], ['todos', 'Todos'], ...STATUS.map((s) => [s.id, s.label])];

  return `
    <h1 class="painel__titulo">Pedidos</h1>
    <p class="painel__sub">Chegam sozinhos, sem atualizar a página. Cada mudança de status abre a mensagem pronta para o cliente.</p>

    <div class="metricas">
      <div class="metrica"><div class="metrica__rotulo">Em aberto</div><div class="metrica__valor">${abertos.length}</div></div>
      <div class="metrica"><div class="metrica__rotulo">Pedidos hoje</div><div class="metrica__valor">${doDia.length}</div></div>
      <div class="metrica metrica--destaque"><div class="metrica__rotulo">Faturamento hoje</div><div class="metrica__valor">${brl(faturamento)}</div></div>
      <div class="metrica"><div class="metrica__rotulo">Ticket médio</div><div class="metrica__valor">${brl(doDia.length ? faturamento / doDia.length : 0)}</div></div>
    </div>

    <div class="filtros" style="margin-bottom:10px">
      <label class="interruptor">
        <input type="checkbox" id="chk-som" ${somLigado ? 'checked' : ''}> Alerta sonoro em pedido novo
      </label>
    </div>

    <div class="filtros">
      ${filtros.map(([id, label]) => `<button class="aba ${filtroStatus === id ? 'aba--ativa' : ''}" data-filtro="${id}">${label}</button>`).join('')}
    </div>

    ${lista.length ? lista.map(htmlPedido).join('') : '<div class="vazio"><div class="vazio__icone">📭</div><p>Nenhum pedido nesse filtro.</p></div>'}
  `;
}

function htmlPedido(p) {
  const st = STATUS.find((s) => s.id === p.status) || STATUS[0];
  const aberto = pedidoAberto === p.id;
  const hora = new Date(p.criadoEm).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
  const proximos = STATUS.filter((s) => s.id !== p.status
    && !(p.tipo === 'entrega' && s.id === 'pronto')
    && !(p.tipo === 'retirada' && s.id === 'saiu'));

  return `
    <article class="pedido">
      <button class="pedido__cab" data-pedido="${p.id}">
        <span class="pedido__num">#${p.numero}</span>
        <span class="pedido__info">
          <span class="pedido__cliente">${esc(p.cliente.nome)}</span>
          <span class="pedido__hora">${hora} · ${p.tipo === 'entrega' ? 'Entrega' : 'Retirada'} · ${LABEL_PAGAMENTO[p.pagamento]}</span>
        </span>
        <span class="selo selo--${st.cor}">${st.label}</span>
        <span class="pedido__valor">${brl(p.total)}</span>
      </button>
      ${aberto ? `
      <div class="pedido__corpo">
        <div class="detalhe-linha"><span class="detalhe-linha__rotulo">Cliente</span><span class="detalhe-linha__valor">${esc(p.cliente.nome)} · ${esc(p.cliente.telefone)}</span></div>
        <div class="detalhe-linha"><span class="detalhe-linha__rotulo">Entrega</span><span class="detalhe-linha__valor">${esc(enderecoTexto(p))}</span></div>
        <div class="detalhe-linha"><span class="detalhe-linha__rotulo">Pagamento</span><span class="detalhe-linha__valor">${LABEL_PAGAMENTO[p.pagamento]}${p.troco ? ' · troco para ' + brl(p.troco) : ''}</span></div>
        ${p.observacao ? `<div class="detalhe-linha"><span class="detalhe-linha__rotulo">Observação</span><span class="detalhe-linha__valor">${esc(p.observacao)}</span></div>` : ''}

        <div class="itens-pedido"><pre>${esc(p.itens.map(itemTexto).join('\n'))}</pre></div>

        <div class="resumo" style="margin-top:0">
          <div class="resumo__linha"><span>Subtotal</span><span>${brl(p.subtotal)}</span></div>
          <div class="resumo__linha"><span>Taxa</span><span>${brl(p.taxa)}</span></div>
          <div class="resumo__linha resumo__linha--total"><span>Total</span><span>${brl(p.total)}</span></div>
        </div>

        <p class="grupo-titulo">Atualizar status e avisar o cliente</p>
        <div class="acoes-pedido">
          ${proximos.map((s) => `<button class="btn btn--sm ${s.id === 'cancelado' ? 'btn--perigo' : 'btn--linha'}" data-status="${p.id}:${s.id}">${s.label}</button>`).join('')}
        </div>
        <div class="acoes-pedido">
          <button class="btn btn--sm btn--folha" data-imprimir="${p.id}">🧾 Imprimir cupom</button>
          <a class="btn btn--sm btn--flor" href="${waLink(p.cliente.telefoneBruto, mensagemStatus(p, p.status, DB.config))}" target="_blank" rel="noopener">Reenviar aviso de "${st.label}"</a>
          <a class="btn btn--sm btn--linha" href="${waLink(p.cliente.telefoneBruto, 'Olá ' + p.cliente.nome.split(' ')[0] + '! Sobre o pedido #' + p.numero + ': ')}" target="_blank" rel="noopener">Abrir conversa</a>
          ${podeExcluirPedido() ? `<button class="btn btn--sm btn--perigo" data-excluir="${p.id}">Excluir</button>` : ''}
        </div>
      </div>` : ''}
    </article>`;
}

async function mudarStatus(pedidoId, statusId) {
  const p = DB.pedidos.find((x) => x.id === pedidoId);
  if (!p) return;
  try {
    await atualizarStatus(pedidoId, statusId);
  } catch (e) {
    toast('Não foi possível atualizar: ' + e.message);
    return;
  }
  const msg = mensagemStatus(p, statusId, DB.config);
  const janela = msg ? window.open(waLink(p.cliente.telefoneBruto, msg), '_blank', 'noopener') : null;
  renderAba();
  if (msg && !janela) toast('Status atualizado. Use "Reenviar aviso" para abrir o WhatsApp.');
}

/* ---------------- cupom para impressora térmica ---------------- */
function imprimirCupom(pedidoId) {
  const p = DB.pedidos.find((x) => x.id === pedidoId);
  if (!p) return;
  const c = DB.config;
  const hora = new Date(p.criadoEm).toLocaleString('pt-BR');

  $('#area-cupom').innerHTML = `
    <div class="cupom">
      <h1>${esc(c.nomeLoja)}</h1>
      <p class="cupom__centro">${esc(c.endereco)}<br>${esc(formatarTelefone(c.whatsapp))}</p>
      <hr>
      <h2>PEDIDO #${p.numero}</h2>
      <p class="cupom__centro">${hora}</p>
      <hr>
      <p><strong>${esc(p.cliente.nome)}</strong><br>${esc(p.cliente.telefone)}</p>
      <p>${p.tipo === 'entrega' ? '** ENTREGA **<br>' + esc(enderecoTexto(p)) : '** RETIRADA NO BALCAO **'}</p>
      <hr>
      <pre>${esc(p.itens.map(itemTexto).join('\n'))}</pre>
      <hr>
      <table>
        <tr><td>Subtotal</td><td>${brl(p.subtotal)}</td></tr>
        <tr><td>Taxa</td><td>${brl(p.taxa)}</td></tr>
        <tr class="cupom__total"><td>TOTAL</td><td>${brl(p.total)}</td></tr>
      </table>
      <p><strong>Pagamento:</strong> ${LABEL_PAGAMENTO[p.pagamento]}${p.troco ? '<br>Troco para ' + brl(p.troco) : ''}</p>
      ${p.observacao ? `<hr><p><strong>Obs:</strong> ${esc(p.observacao)}</p>` : ''}
      <hr>
      <p class="cupom__centro">Obrigado pela preferencia!</p>
    </div>`;

  window.print();
  marcarImpresso(pedidoId).catch(() => {});
}

/* ---------------- aba: cardápio ---------------- */
function htmlCardapio() {
  return `
    <h1 class="painel__titulo">Cardápio e preços</h1>
    <p class="painel__sub">Tudo que você mudar aqui aparece na loja na hora, para todo mundo.</p>
    ${DB.produtos.map((p) => `
      <div class="caixa">
        <h2 class="caixa__titulo">${esc(p.nome)}
          <label class="interruptor" style="margin-left:auto">
            <input type="checkbox" data-prod-ativo="${p.id}" ${p.ativo ? 'checked' : ''}> visível na loja
          </label>
        </h2>
        <div class="campo" style="margin-bottom:16px">
          <label class="campo__label" for="desc-${p.id}">Descrição que aparece na loja</label>
          <input class="entrada" id="desc-${p.id}" value="${esc(p.descricao || '')}"
                 data-prod-desc="${p.id}" maxlength="160"
                 placeholder="Ex.: Açaí cremoso batido na hora, com todos os complementos inclusos.">
        </div>
        ${p.tamanhos.map((t) => `
          <div class="linha-edit">
            <input class="entrada entrada--nome" value="${esc(t.nome)}" data-tam-nome="${t.id}">
            <input class="entrada entrada--preco" type="number" min="0" step="0.5" value="${t.preco}" data-tam-preco="${t.id}">
            <label class="interruptor"><input type="checkbox" data-tam-ativo="${t.id}" ${t.ativo ? 'checked' : ''}> ativo</label>
            <button class="btn btn--xs btn--perigo" data-tam-remover="${t.id}">Remover</button>
          </div>`).join('')}
        <div class="add-linha">
          <input class="entrada entrada--nome" placeholder="Novo tamanho (ex.: 700 ml)" id="novo-tam-nome-${p.id}">
          <input class="entrada entrada--preco" type="number" min="0" step="0.5" placeholder="Preço" id="novo-tam-preco-${p.id}">
          <button class="btn btn--sm btn--folha" data-tam-add="${p.id}">Adicionar tamanho</button>
        </div>
      </div>`).join('')}
  `;
}

/* ---------------- aba: complementos ---------------- */
function htmlComplementos() {
  const grupos = agruparComplementos(DB.complementos);
  return `
    <h1 class="painel__titulo">Complementos</h1>
    <p class="painel__sub">Preço 0 mantém grátis. Desmarque o que acabou no estoque.</p>
    <div class="caixa">
      <div class="campo">
        <label class="campo__label" for="max-comp">Limite de complementos por copo</label>
        <input class="entrada entrada--preco" id="max-comp" type="number" min="0" value="${DB.config.maxComplementos}">
        <p class="campo__dica">0 = sem limite, como está no cardápio impresso.</p>
      </div>
    </div>
    ${Object.keys(grupos).map((g) => `
      <div class="caixa">
        <h2 class="caixa__titulo">${esc(g)}</h2>
        ${grupos[g].map((c) => `
          <div class="linha-edit">
            <input class="entrada entrada--nome" value="${esc(c.nome)}" data-comp-nome="${c.id}">
            <input class="entrada entrada--preco" type="number" min="0" step="0.5" value="${c.preco}" data-comp-preco="${c.id}">
            <label class="interruptor"><input type="checkbox" data-comp-ativo="${c.id}" ${c.ativo ? 'checked' : ''}> disponível</label>
            <button class="btn btn--xs btn--perigo" data-comp-remover="${c.id}">Remover</button>
          </div>`).join('')}
      </div>`).join('')}
    <div class="caixa">
      <h2 class="caixa__titulo">Adicionar complemento</h2>
      <div class="add-linha">
        <input class="entrada entrada--nome" id="novo-comp-nome" placeholder="Nome">
        <input class="entrada entrada--nome" id="novo-comp-cat" placeholder="Categoria" value="Complementos">
        <input class="entrada entrada--preco" id="novo-comp-preco" type="number" min="0" step="0.5" value="0">
        <button class="btn btn--sm btn--folha" id="btn-add-comp">Adicionar</button>
      </div>
    </div>`;
}

/* ---------------- aba: sabores ---------------- */
function htmlSabores() {
  return `
    <h1 class="painel__titulo">Sabores do açaí</h1>
    <p class="painel__sub">Aparecem na etapa de montagem do copo.</p>
    <div class="caixa">
      ${DB.sabores.map((s) => `
        <div class="linha-edit">
          <input class="entrada entrada--nome" value="${esc(s.nome)}" data-sabor-nome="${s.id}">
          <label class="interruptor"><input type="checkbox" data-sabor-ativo="${s.id}" ${s.ativo ? 'checked' : ''}> disponível</label>
          <button class="btn btn--xs btn--perigo" data-sabor-remover="${s.id}">Remover</button>
        </div>`).join('')}
      <div class="add-linha">
        <input class="entrada entrada--nome" id="novo-sabor" placeholder="Novo sabor">
        <button class="btn btn--sm btn--folha" id="btn-add-sabor">Adicionar</button>
      </div>
    </div>`;
}

/* ---------------- aba: equipe ---------------- */
const DESCRICAO_PAPEL = {
  admin:     'Acesso total, incluindo equipe e registro.',
  gerente:   'Cardápio, preços, horários, pedidos e registro. Não mexe na equipe.',
  atendente: 'Só a aba Pedidos: ver e atualizar status.'
};

async function mostrarEquipe() {
  let equipe;
  try {
    equipe = await carregarEquipe();
  } catch (e) {
    $('#painel-conteudo').innerHTML = `<div class="aviso aviso--erro">${esc(e.message)}</div>`;
    return;
  }
  $('#painel-conteudo').innerHTML = htmlEquipe(equipe);
}

function htmlEquipe(equipe) {
  const admins = equipe.filter((p) => p.papel === 'admin' && p.ativo).length;

  return `
    <h1 class="painel__titulo">Equipe</h1>
    <p class="painel__sub">Quem tem acesso ao painel e o que cada um pode fazer.</p>

    <div class="aviso aviso--info">
      <strong>Para dar acesso a alguém novo:</strong> crie a conta no Supabase em
      <em>Authentication → Users → Add user</em>, marcando <em>Auto Confirm User</em>.
      A pessoa aparece aqui como <strong>atendente</strong> e você promove.
      <br><br>
      O painel não cria contas porque isso exigiria guardar no site uma chave com poder total
      sobre o banco — exatamente o que nunca pode ficar no navegador.
    </div>

    ${admins === 1 ? `<div class="aviso aviso--alerta">
      Existe <strong>um único administrador</strong>. Se essa conta se perder, ninguém mais administra o sistema.
      Vale promover uma segunda pessoa de confiança.
    </div>` : ''}

    <div class="caixa" style="padding:0;overflow-x:auto">
      <table class="tabela-log tabela-equipe">
        <thead>
          <tr><th>E-mail</th><th>Papel</th><th>Acesso</th><th>Desde</th></tr>
        </thead>
        <tbody>
          ${equipe.map((p) => `
            <tr class="${p.ativo ? '' : 'linha-inativa'}">
              <td>
                ${esc(p.email || '(sem e-mail)')}
                ${p.sou_eu ? '<span class="log-papel">você</span>' : ''}
              </td>
              <td>
                <select class="entrada entrada--papel" data-papel-de="${p.id}" ${p.ativo ? '' : 'disabled'}>
                  ${['admin','gerente','atendente'].map((op) =>
                    `<option value="${op}" ${p.papel === op ? 'selected' : ''}>${op}</option>`).join('')}
                </select>
                <div class="papel-dica">${esc(DESCRICAO_PAPEL[p.papel] || '')}</div>
              </td>
              <td>
                <label class="interruptor">
                  <input type="checkbox" data-ativo-de="${p.id}" ${p.ativo ? 'checked' : ''}>
                  ${p.ativo ? 'liberado' : 'bloqueado'}
                </label>
              </td>
              <td class="log-hora">${esc(new Date(p.criado_em).toLocaleDateString('pt-BR'))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="caixa">
      <h2 class="caixa__titulo">O que cada papel pode</h2>
      ${Object.entries(DESCRICAO_PAPEL).map(([k, v]) => `
        <div class="detalhe-linha">
          <span class="detalhe-linha__rotulo">${k}</span>
          <span class="detalhe-linha__valor">${esc(v)}</span>
        </div>`).join('')}
      <p class="campo__dica" style="margin-top:14px">
        Bloquear o acesso é melhor que apagar a conta: a pessoa perde a entrada na hora,
        e o histórico dela no registro continua fazendo sentido.
      </p>
      <button class="btn btn--sm btn--linha" id="btn-sincronizar-equipe" style="margin-top:10px">
        Sincronizar com o Supabase
      </button>
      <p class="campo__dica">Use se alguém foi criado no Supabase e ainda não apareceu aqui.</p>
    </div>`;
}

/* ---------------- aba: registro de auditoria ---------------- */
const ROTULO_ACAO = {
  INSERT: 'criou', UPDATE: 'alterou', DELETE: 'excluiu',
  LOGIN: 'entrou', LOGOUT: 'saiu', SESSAO_EXPIRADA: 'sessão expirou'
};
const ROTULO_TABELA = {
  produtos: 'produto', tamanhos: 'tamanho/preço', complementos: 'complemento',
  sabores: 'sabor', bairros: 'bairro', config: 'configurações',
  pedidos: 'pedido', sessao: 'conta'
};

async function mostrarRegistro() {
  let linhas;
  try {
    linhas = await carregarAuditoria(150);
  } catch (e) {
    $('#painel-conteudo').innerHTML =
      `<div class="aviso aviso--erro">Não foi possível ler o registro: ${esc(e.message)}</div>`;
    return;
  }
  $('#painel-conteudo').innerHTML = htmlRegistro(linhas);
}

function resumoMudanca(l) {
  if (l.tabela === 'sessao') return '';
  if (l.acao === 'UPDATE' && l.antes && l.depois) {
    const mudou = Object.keys(l.depois).filter((k) =>
      JSON.stringify(l.antes[k]) !== JSON.stringify(l.depois[k]) && k !== 'atualizado_em');
    return mudou.slice(0, 3).map((k) => {
      const de = l.antes[k], para = l.depois[k];
      const curto = (v) => {
        const t = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return t.length > 28 ? t.slice(0, 28) + '…' : t;
      };
      return `${k}: ${curto(de)} → ${curto(para)}`;
    }).join(' · ');
  }
  const alvo = l.depois || l.antes || {};
  return alvo.nome ? String(alvo.nome) : (alvo.cliente_nome ? String(alvo.cliente_nome) : '');
}

function htmlRegistro(linhas) {
  return `
    <h1 class="painel__titulo">Registro de atividade</h1>
    <p class="painel__sub">
      Quem mexeu no quê e quando. Gravado pelo banco, não pelo navegador — não dá para apagar daqui.
    </p>
    <div class="aviso aviso--info">
      O registro nunca guarda senha, token ou dado de pagamento. Só a ação, o autor e o horário.
    </div>
    ${linhas.length ? `<div class="caixa" style="padding:0;overflow-x:auto">
      <table class="tabela-log">
        <thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Detalhe</th></tr></thead>
        <tbody>
          ${linhas.map((l) => `
            <tr>
              <td class="log-hora">${esc(new Date(l.em).toLocaleString('pt-BR', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</td>
              <td>${esc(l.usuario || 'cliente')}${l.papel ? `<span class="log-papel">${esc(l.papel)}</span>` : ''}</td>
              <td>${esc(ROTULO_ACAO[l.acao] || l.acao)} ${esc(ROTULO_TABELA[l.tabela] || l.tabela)}</td>
              <td class="log-detalhe">${esc(resumoMudanca(l))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '<div class="vazio"><div class="vazio__icone">📋</div><p>Nenhum evento registrado ainda.</p></div>'}`;
}

/* ---------------- aba: configurações ---------------- */
function htmlConfig() {
  const c = DB.config;
  return `
    <h1 class="painel__titulo">Configurações</h1>
    <p class="painel__sub">Dados da loja, entrega, PIX e as mensagens automáticas.</p>

    <div class="caixa">
      <h2 class="caixa__titulo">Loja</h2>
      <label class="interruptor" style="margin-bottom:6px">
        <input type="checkbox" id="cfg-aberta" ${c.aberta ? 'checked' : ''}> Operando normalmente
      </label>
      <p class="campo__dica" style="margin-bottom:14px">
        Desmarque para fechar agora, mesmo dentro do horário — feriado, imprevisto, acabou o estoque.
      </p>
      <div class="campo"><label class="campo__label" for="cfg-nome">Nome</label><input class="entrada" id="cfg-nome" value="${esc(c.nomeLoja)}"></div>
      <div class="campo"><label class="campo__label" for="cfg-endereco">Endereço</label><input class="entrada" id="cfg-endereco" value="${esc(c.endereco)}"></div>
      <div class="linha-campos">
        <div class="campo"><label class="campo__label" for="cfg-wpp">WhatsApp da loja</label><input class="entrada" id="cfg-wpp" value="${esc(c.whatsapp)}"><p class="campo__dica">Com DDI e DDD, só números.</p></div>
        <div class="campo"><label class="campo__label" for="cfg-insta">Instagram</label><input class="entrada" id="cfg-insta" value="${esc(c.instagram)}"></div>
      </div>
    </div>

    <div class="caixa">
      <h2 class="caixa__titulo">Horário de funcionamento</h2>
      <p class="caixa__sub">
        A loja abre e fecha sozinha por esta tabela, no horário de Brasília.
        Agora: <strong id="estado-agora">${esc(estadoDaLoja(c).texto)}</strong>
        <span style="color:var(--creme-fraco)">(${esc(estadoDaLoja(c).detalhe)})</span>
      </p>
      ${[1,2,3,4,5,6,0].map((d) => {
        const h = (c.horarios || {})[String(d)] || { abre: '14:00', fecha: '23:00', fechado: true };
        return `
        <div class="linha-edit linha-horario">
          <span class="linha-edit__nome" style="min-width:78px;flex:none">${DIAS_CURTO[d]}</span>
          <label class="interruptor"><input type="checkbox" data-dia-aberto="${d}" ${h.fechado ? '' : 'checked'}> abre</label>
          <input class="entrada entrada--hora" type="time" value="${esc(h.abre)}" data-dia-abre="${d}" ${h.fechado ? 'disabled' : ''}>
          <span style="color:var(--creme-fraco)">até</span>
          <input class="entrada entrada--hora" type="time" value="${esc(h.fecha)}" data-dia-fecha="${d}" ${h.fechado ? 'disabled' : ''}>
        </div>`;
      }).join('')}
      <p class="campo__dica" style="margin-top:12px">
        Para fechar depois da meia-noite, coloque o fim menor que o início — 18:00 até 02:00, por exemplo.
      </p>
      <label class="interruptor" style="margin-top:14px">
        <input type="checkbox" id="cfg-fora-horario" ${c.aceitaForaHorario ? 'checked' : ''}>
        Aceitar encomenda com a loja fechada
      </label>
      <p class="campo__dica">
        Desmarcado, o cliente vê o horário e não consegue fechar o pedido.
        Marcado, ele encomenda e vocês preparam na abertura.
      </p>
    </div>

    <div class="caixa">
      <h2 class="caixa__titulo">Entrega e pagamento</h2>
      <div class="linha-campos">
        <div class="campo"><label class="campo__label" for="cfg-taxa">Taxa de entrega padrão</label><input class="entrada" id="cfg-taxa" type="number" min="0" step="0.5" value="${c.taxaEntrega}"></div>
        <div class="campo"><label class="campo__label" for="cfg-min">Pedido mínimo</label><input class="entrada" id="cfg-min" type="number" min="0" step="0.5" value="${c.pedidoMinimo}"><p class="campo__dica">0 = sem mínimo.</p></div>
      </div>
      <p class="grupo-titulo">Formas aceitas</p>
      <div class="filtros">
        <label class="interruptor"><input type="checkbox" id="pag-pix" ${c.pagamentos.pix ? 'checked' : ''}> PIX</label>
        <label class="interruptor"><input type="checkbox" id="pag-cartao" ${c.pagamentos.cartao ? 'checked' : ''}> Cartão</label>
        <label class="interruptor"><input type="checkbox" id="pag-dinheiro" ${c.pagamentos.dinheiro ? 'checked' : ''}> Dinheiro</label>
      </div>
      <p class="grupo-titulo">Bairros com taxa própria</p>
      <p class="caixa__sub">Lista vazia = o cliente digita o bairro e vale a taxa padrão.</p>
      ${(c.bairros || []).map((b) => `
        <div class="linha-edit">
          <input class="entrada entrada--nome" value="${esc(b.nome)}" data-bairro-nome="${b.id}">
          <input class="entrada entrada--preco" type="number" min="0" step="0.5" value="${b.taxa}" data-bairro-taxa="${b.id}">
          <button class="btn btn--xs btn--perigo" data-bairro-remover="${b.id}">Remover</button>
        </div>`).join('')}
      <div class="add-linha">
        <input class="entrada entrada--nome" id="novo-bairro-nome" placeholder="Bairro">
        <input class="entrada entrada--preco" id="novo-bairro-taxa" type="number" min="0" step="0.5" placeholder="Taxa">
        <button class="btn btn--sm btn--folha" id="btn-add-bairro">Adicionar bairro</button>
      </div>
    </div>

    <div class="caixa">
      <h2 class="caixa__titulo">Chave PIX</h2>
      <p class="caixa__sub">Gera o QR Code e o copia e cola no checkout.</p>
      <div class="linha-campos">
        <div class="campo"><label class="campo__label" for="pix-chave">Chave</label><input class="entrada" id="pix-chave" value="${esc(c.pix.chave || '')}"></div>
        <div class="campo"><label class="campo__label" for="pix-tipo">Tipo</label><input class="entrada" id="pix-tipo" value="${esc(c.pix.tipoChave || '')}"></div>
      </div>
      <div class="linha-campos">
        <div class="campo"><label class="campo__label" for="pix-nome">Beneficiário</label><input class="entrada" id="pix-nome" value="${esc(c.pix.beneficiario || '')}"></div>
        <div class="campo"><label class="campo__label" for="pix-cidade">Cidade</label><input class="entrada" id="pix-cidade" value="${esc(c.pix.cidade || '')}"></div>
      </div>
      <p class="campo__dica">Faça um teste de R$ 0,01 antes de divulgar.</p>
    </div>

    <div class="caixa">
      <h2 class="caixa__titulo">Mensagens automáticas</h2>
      <p class="caixa__sub">Variáveis: {nome} {numero} {total} {pagamento} {endereco} {enderecoLoja} {loja}</p>
      ${[['recebido', 'Pedido recebido'], ['preparo', 'Em preparo'], ['saiu', 'Saiu para entrega'],
         ['pronto', 'Pronto para retirada'], ['entregue', 'Concluído'], ['cancelado', 'Cancelado']]
        .map(([k, label]) => `
        <div class="campo">
          <label class="campo__label" for="msg-${k}">${label}</label>
          <textarea class="entrada" id="msg-${k}" data-msg="${k}">${esc(c.mensagens[k] || '')}</textarea>
        </div>`).join('')}
    </div>

    <div class="caixa">
      <h2 class="caixa__titulo">Conta</h2>
      <p class="caixa__sub">A senha é gerenciada pelo Supabase. Para trocar, use "Esqueci minha senha" na tela de login, ou o painel do Supabase em Authentication → Users.</p>
    </div>

    <div style="height:20px"></div>
    <button class="btn btn--folha btn--bloco" id="btn-salvar-config">Salvar configurações</button>
  `;
}

function lerHorariosDoFormulario(c) {
  const h = {};
  [0,1,2,3,4,5,6].forEach((d) => {
    const chk  = $(`[data-dia-aberto="${d}"]`);
    const abre = $(`[data-dia-abre="${d}"]`);
    const fim  = $(`[data-dia-fecha="${d}"]`);
    if (!chk) { h[String(d)] = (c.horarios || {})[String(d)] || { abre:'14:00', fecha:'23:00', fechado:true }; return; }
    h[String(d)] = {
      abre: abre.value || '14:00',
      fecha: fim.value || '23:00',
      fechado: !chk.checked
    };
  });
  return h;
}

async function guardarConfig() {
  const c = DB.config;
  const novo = {
    ...c,
    aberta: $('#cfg-aberta').checked,
    nomeLoja: $('#cfg-nome').value.trim() || c.nomeLoja,
    endereco: $('#cfg-endereco').value.trim(),
    whatsapp: digits($('#cfg-wpp').value) || c.whatsapp,
    horarios: lerHorariosDoFormulario(c),
    aceitaForaHorario: $('#cfg-fora-horario').checked,
    instagram: $('#cfg-insta').value.trim().replace('@', ''),
    taxaEntrega: Number($('#cfg-taxa').value) || 0,
    pedidoMinimo: Number($('#cfg-min').value) || 0,
    pagamentos: {
      pix: $('#pag-pix').checked,
      cartao: $('#pag-cartao').checked,
      dinheiro: $('#pag-dinheiro').checked
    },
    pix: {
      chave: $('#pix-chave').value.trim(),
      tipoChave: $('#pix-tipo').value.trim(),
      beneficiario: $('#pix-nome').value.trim(),
      cidade: $('#pix-cidade').value.trim()
    },
    mensagens: { ...c.mensagens }
  };
  $$('[data-msg]').forEach((t) => { novo.mensagens[t.dataset.msg] = t.value; });

  const botao = $('#btn-salvar-config');
  botao.disabled = true;
  botao.textContent = 'Salvando…';
  try {
    // bairros são linhas próprias
    for (const inp of $$('[data-bairro-nome]')) {
      const b = c.bairros.find((x) => x.id === inp.dataset.bairroNome);
      if (b) { b.nome = inp.value.trim(); await salvarLinha('bairros', b.id, { nome: b.nome }); }
    }
    for (const inp of $$('[data-bairro-taxa]')) {
      const b = c.bairros.find((x) => x.id === inp.dataset.bairroTaxa);
      if (b) { b.taxa = Number(inp.value) || 0; await salvarLinha('bairros', b.id, { taxa: b.taxa }); }
    }
    await salvarConfig(novo);
    $('#admin-nome-loja').textContent = novo.nomeLoja;
    toast('Configurações salvas');
  } catch (e) {
    toast('Erro ao salvar: ' + e.message);
  } finally {
    botao.disabled = false;
    botao.textContent = 'Salvar configurações';
  }
}

/* ---------------- eventos do painel ---------------- */
document.addEventListener('click', async (ev) => {
  const t = ev.target;
  const d = t.dataset || {};

  if (t.id === 'btn-sair') { sair(); return; }
  if (t.id === 'btn-ver-loja') { location.hash = ''; return; }
  if (t.id === 'voltar-loja') { ev.preventDefault(); location.hash = ''; return; }

  if (t.classList && t.classList.contains('aba') && d.aba) { abaAtual = d.aba; renderAba(); return; }
  if (d.filtro) { filtroStatus = d.filtro; renderAba(); return; }

  const cab = t.closest('[data-pedido]');
  if (cab) { pedidoAberto = pedidoAberto === cab.dataset.pedido ? null : cab.dataset.pedido; renderAba(); return; }

  if (d.status) { const [pid, sid] = d.status.split(':'); mudarStatus(pid, sid); return; }
  if (d.imprimir) { imprimirCupom(d.imprimir); return; }

  if (d.excluir) {
    const p = DB.pedidos.find((x) => x.id === d.excluir);
    if (!await confirmar(`Excluir o pedido #${p ? p.numero : ''}?`,
                         'A exclusão fica registrada no log e não pode ser desfeita.')) return;
    try { await excluirPedido(d.excluir); renderAba(); toast('Pedido excluído'); }
    catch (e) { toast(e.message.includes('policy') ? 'Seu perfil não pode excluir pedidos.' : 'Erro: ' + e.message); }
    return;
  }

  /* cardápio */
  if (d.tamAdd) {
    const nome = $('#novo-tam-nome-' + d.tamAdd).value.trim();
    const preco = Number($('#novo-tam-preco-' + d.tamAdd).value);
    if (!nome || !preco) { toast('Preencha nome e preço'); return; }
    try {
      const linha = await inserirLinha('tamanhos', { produto_id: d.tamAdd, nome, preco, ordem: 99 });
      DB.produtos.find((p) => p.id === d.tamAdd).tamanhos.push(
        { id: linha.id, nome: linha.nome, preco: Number(linha.preco), ativo: linha.ativo });
      renderAba(); toast('Tamanho adicionado');
    } catch (e) { toast('Erro: ' + e.message); }
    return;
  }
  if (d.tamRemover) {
    if (!await confirmar('Remover este item do cardápio?',
                         'A remoção fica registrada no log.')) return;
    try {
      await removerLinha('tamanhos', d.tamRemover);
      DB.produtos.forEach((p) => { p.tamanhos = p.tamanhos.filter((x) => x.id !== d.tamRemover); });
      renderAba();
    } catch (e) { toast('Erro: ' + e.message); }
    return;
  }

  /* complementos */
  if (t.id === 'btn-add-comp') {
    const nome = $('#novo-comp-nome').value.trim();
    if (!nome) { toast('Informe o nome'); return; }
    try {
      const linha = await inserirLinha('complementos', {
        nome, categoria: $('#novo-comp-cat').value.trim() || 'Complementos',
        preco: Number($('#novo-comp-preco').value) || 0, ordem: 99
      });
      DB.complementos.push({ id: linha.id, nome: linha.nome, categoria: linha.categoria, preco: Number(linha.preco), ativo: linha.ativo });
      renderAba(); toast('Complemento adicionado');
    } catch (e) { toast('Erro: ' + e.message); }
    return;
  }
  if (d.compRemover) {
    if (!await confirmar('Remover este item do cardápio?',
                         'A remoção fica registrada no log.')) return;
    try {
      await removerLinha('complementos', d.compRemover);
      DB.complementos = DB.complementos.filter((c) => c.id !== d.compRemover);
      renderAba();
    } catch (e) { toast('Erro: ' + e.message); }
    return;
  }

  /* sabores */
  if (t.id === 'btn-add-sabor') {
    const nome = $('#novo-sabor').value.trim();
    if (!nome) { toast('Informe o sabor'); return; }
    try {
      const linha = await inserirLinha('sabores', { nome, ordem: 99 });
      DB.sabores.push({ id: linha.id, nome: linha.nome, ativo: linha.ativo });
      renderAba(); toast('Sabor adicionado');
    } catch (e) { toast('Erro: ' + e.message); }
    return;
  }
  if (d.saborRemover) {
    if (!await confirmar('Remover este item do cardápio?',
                         'A remoção fica registrada no log.')) return;
    try {
      await removerLinha('sabores', d.saborRemover);
      DB.sabores = DB.sabores.filter((s) => s.id !== d.saborRemover);
      renderAba();
    } catch (e) { toast('Erro: ' + e.message); }
    return;
  }

  /* bairros */
  if (t.id === 'btn-add-bairro') {
    const nome = $('#novo-bairro-nome').value.trim();
    if (!nome) { toast('Informe o bairro'); return; }
    try {
      const linha = await inserirLinha('bairros', { nome, taxa: Number($('#novo-bairro-taxa').value) || 0 });
      DB.config.bairros.push({ id: linha.id, nome: linha.nome, taxa: Number(linha.taxa) });
      renderAba(); toast('Bairro adicionado');
    } catch (e) { toast('Erro: ' + e.message); }
    return;
  }
  if (d.bairroRemover) {
    try {
      await removerLinha('bairros', d.bairroRemover);
      DB.config.bairros = DB.config.bairros.filter((b) => b.id !== d.bairroRemover);
      renderAba();
    } catch (e) { toast('Erro: ' + e.message); }
    return;
  }

  if (t.id === 'btn-sincronizar-equipe') {
    t.disabled = true; t.textContent = 'Sincronizando…';
    try {
      const n = await sincronizarEquipe();
      toast(n + (n === 1 ? ' conta na equipe' : ' contas na equipe'));
      renderAba();
    } catch (e) {
      t.disabled = false; t.textContent = 'Sincronizar com o Supabase';
      mostrarAvisoEquipe(e.message);
    }
    return;
  }

  if (t.id === 'btn-salvar-config') { guardarConfig(); return; }
});

/* Edição de texto/preço: salva ao sair do campo, não a cada tecla. */
document.addEventListener('change', async (ev) => {
  const t = ev.target;
  const d = t.dataset || {};

  try {
    if (t.id === 'chk-som') { somLigado = t.checked; if (somLigado) tocarAlerta(); return; }

    if (d.diaAberto) {
      const dia = d.diaAberto;
      $(`[data-dia-abre="${dia}"]`).disabled = !t.checked;
      $(`[data-dia-fecha="${dia}"]`).disabled = !t.checked;
      return;
    }

    if (t.id === 'max-comp') {
      DB.config.maxComplementos = Number(t.value) || 0;
      await salvarConfig(DB.config); return;
    }

    if (d.tamNome || d.tamPreco) {
      const id = d.tamNome || d.tamPreco;
      // Alterar preço é ação crítica: pede confirmação antes de gravar.
      if (d.tamPreco) {
        const antes = (() => {
          let v = null;
          DB.produtos.forEach((p) => p.tamanhos.forEach((x) => { if (x.id === id) v = x.preco; }));
          return v;
        })();
        const novoValor = Number(t.value) || 0;
        if (antes !== novoValor && !await confirmar(
              `Alterar o preço de ${brl(antes)} para ${brl(novoValor)}?`,
              'O novo valor passa a valer na loja imediatamente.')) {
          t.value = antes;
          return;
        }
      }
      const campo = d.tamNome ? { nome: t.value } : { preco: Number(t.value) || 0 };
      await salvarLinha('tamanhos', id, campo);
      DB.produtos.forEach((p) => p.tamanhos.forEach((x) => {
        if (x.id === id) Object.assign(x, d.tamNome ? { nome: t.value } : { preco: Number(t.value) || 0 });
      }));
      toast('Salvo'); return;
    }
    if (d.tamAtivo) {
      await salvarLinha('tamanhos', d.tamAtivo, { ativo: t.checked });
      DB.produtos.forEach((p) => p.tamanhos.forEach((x) => { if (x.id === d.tamAtivo) x.ativo = t.checked; }));
      return;
    }
    if (d.papelDe) {
      const linha = t.closest('tr');
      const email = linha ? linha.querySelector('td').textContent.trim() : 'esta conta';
      const souEu = linha && linha.textContent.includes('você');
      const anterior = [...t.options].find((o) => o.defaultSelected);

      if (!await confirmar(
            `Mudar ${souEu ? 'o seu próprio papel' : esc(email)} para ${t.value}?`,
            souEu ? 'Você pode perder acesso a partes do painel imediatamente.'
                  : DESCRICAO_PAPEL[t.value])) {
        if (anterior) t.value = anterior.value;
        return;
      }
      try {
        await definirPapel(d.papelDe, t.value);
        toast('Papel atualizado');
        renderAba();
      } catch (e) {
        if (anterior) t.value = anterior.value;
        mostrarAvisoEquipe(e.message);
      }
      return;
    }

    if (d.ativoDe) {
      const liberar = t.checked;
      if (!await confirmar(liberar ? 'Liberar o acesso desta conta?' : 'Bloquear o acesso desta conta?',
            liberar ? 'A pessoa volta a conseguir entrar no painel.'
                    : 'A pessoa perde o acesso imediatamente. O histórico dela no registro é mantido.')) {
        t.checked = !liberar;
        return;
      }
      try {
        await definirAtivo(d.ativoDe, liberar);
        toast(liberar ? 'Acesso liberado' : 'Acesso bloqueado');
        renderAba();
      } catch (e) {
        t.checked = !liberar;
        mostrarAvisoEquipe(e.message);
      }
      return;
    }

    if (d.prodDesc) {
      await salvarLinha('produtos', d.prodDesc, { descricao: t.value.trim() });
      DB.produtos.find((p) => p.id === d.prodDesc).descricao = t.value.trim();
      toast('Descrição salva');
      return;
    }
    if (d.prodAtivo) {
      await salvarLinha('produtos', d.prodAtivo, { ativo: t.checked });
      DB.produtos.find((p) => p.id === d.prodAtivo).ativo = t.checked;
      return;
    }
    if (d.compNome || d.compPreco) {
      const id = d.compNome || d.compPreco;
      const campo = d.compNome ? { nome: t.value } : { preco: Number(t.value) || 0 };
      await salvarLinha('complementos', id, campo);
      Object.assign(DB.complementos.find((c) => c.id === id), campo);
      toast('Salvo'); return;
    }
    if (d.compAtivo) {
      await salvarLinha('complementos', d.compAtivo, { ativo: t.checked });
      DB.complementos.find((c) => c.id === d.compAtivo).ativo = t.checked;
      return;
    }
    if (d.saborNome) {
      await salvarLinha('sabores', d.saborNome, { nome: t.value });
      DB.sabores.find((s) => s.id === d.saborNome).nome = t.value;
      toast('Salvo'); return;
    }
    if (d.saborAtivo) {
      await salvarLinha('sabores', d.saborAtivo, { ativo: t.checked });
      DB.sabores.find((s) => s.id === d.saborAtivo).ativo = t.checked;
      return;
    }
  } catch (e) {
    toast('Não foi possível salvar: ' + e.message);
  }
});
