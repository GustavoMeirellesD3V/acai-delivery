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

/* ---------------- abas ---------------- */
function renderAba() {
  $$('#abas .aba').forEach((b) => b.classList.toggle('aba--ativa', b.dataset.aba === abaAtual));
  const alvo = $('#painel-conteudo');
  if (abaAtual === 'pedidos') alvo.innerHTML = htmlPedidos();
  else if (abaAtual === 'cardapio') alvo.innerHTML = htmlCardapio();
  else if (abaAtual === 'complementos') alvo.innerHTML = htmlComplementos();
  else if (abaAtual === 'sabores') alvo.innerHTML = htmlSabores();
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
          <button class="btn btn--sm btn--perigo" data-excluir="${p.id}">Excluir</button>
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
        <p class="caixa__sub">${esc(p.descricao || '')}</p>
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
    if (t.dataset.confirmar !== '1') { t.dataset.confirmar = '1'; t.textContent = 'Confirmar exclusão'; return; }
    try { await excluirPedido(d.excluir); renderAba(); toast('Pedido excluído'); }
    catch (e) { toast('Erro: ' + e.message); }
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
