/* =========================================================
   Açaí Mais Chantilly — loja (lado do cliente)
   Lê o cardápio do cache DB (db.js) e envia o pedido
   pela função criar_pedido() do banco.
   ========================================================= */

let carrinho = [];
let montagem = null;

const $ = (sel, ctx) => (ctx || document).querySelector(sel);
const $$ = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];

/* ---------------- modais ---------------- */
function abrirModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.hidden = false;
  document.body.style.overflow = 'hidden';
}
function fecharModal(id) {
  const m = document.getElementById(id);
  if (m) m.hidden = true;
  if (!$$('.modal:not([hidden])').length) document.body.style.overflow = '';
}
function fecharTodosModais() {
  $$('.modal').forEach((m) => { m.hidden = true; });
  document.body.style.overflow = '';
}

let toastTimer = null;
function toast(msg) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
}

/* ---------------- render da loja ---------------- */
function renderLoja() {
  const c = DB.config;
  if (!c) return;

  $('#marca-nome').textContent = c.nomeLoja;
  document.title = c.nomeLoja;

  const status = $('#status-loja');
  status.className = 'pill ' + (c.aberta ? 'pill--aberta' : 'pill--fechada');
  status.innerHTML = '<span class="pill__dot"></span>' + (c.aberta ? 'Aberta agora' : 'Fechada');
  $('#aviso-fechada').hidden = !!c.aberta;

  $('#hero-meta').innerHTML = [
    `<span class="chip chip--folha">🛵 Entrega ${c.taxaEntrega > 0 ? brl(c.taxaEntrega) : 'grátis'}</span>`,
    `<span class="chip chip--flor">🏪 Retirada no balcão</span>`,
    `<span class="chip">🕐 ${esc(c.horario)}</span>`
  ].join('');

  renderProdutos();
  renderComplementos();
  renderSabores();
  renderInfo();
  renderBarra();
}

function renderProdutos() {
  const html = DB.produtos.filter((p) => p.ativo).map((p) => {
    const tamanhos = p.tamanhos.filter((t) => t.ativo).map((t) => `
      <button class="tamanho" data-produto="${p.id}" data-tamanho="${t.id}">
        <span>
          <span class="tamanho__nome">${esc(t.nome)}</span><br>
          <span class="tamanho__cta">Montar com complementos grátis</span>
        </span>
        <span class="tamanho__preco">${brl(t.preco)}</span>
      </button>`).join('');
    return `
      <article class="card-produto">
        <div class="card-produto__top">
          <span class="card-produto__icone">${/cupua/i.test(p.nome) ? '🥭' : '🫐'}</span>
          <div>
            <h3 class="card-produto__nome">${esc(p.nome)}</h3>
            <p class="card-produto__desc">${esc(p.descricao || '')}</p>
          </div>
        </div>
        <div class="tamanhos">${tamanhos || '<p class="secao__nota">Sem tamanhos disponíveis.</p>'}</div>
      </article>`;
  }).join('');
  $('#lista-produtos').innerHTML = html || '<p class="secao__nota">Cardápio em atualização.</p>';
}

function agruparComplementos(lista) {
  const grupos = {};
  lista.forEach((c) => { (grupos[c.categoria] = grupos[c.categoria] || []).push(c); });
  return grupos;
}

function renderComplementos() {
  const grupos = agruparComplementos(DB.complementos.filter((c) => c.ativo));
  $('#lista-complementos').innerHTML = Object.keys(grupos).map((g) => `
    <div class="grupo-comp">
      <h3 class="grupo-comp__titulo">${esc(g)}</h3>
      <div class="chips">
        ${grupos[g].map((c) => `<span class="chip">${esc(c.nome)}${c.preco > 0 ? ' · ' + brl(c.preco) : ''}</span>`).join('')}
      </div>
    </div>`).join('');
}

function renderSabores() {
  $('#lista-sabores').innerHTML = DB.sabores.filter((s) => s.ativo)
    .map((s) => `<span class="chip chip--flor">${esc(s.nome)}</span>`).join('');
}

function renderInfo() {
  const c = DB.config;
  const pag = [];
  if (c.pagamentos.pix) pag.push('PIX');
  if (c.pagamentos.cartao) pag.push('Cartão');
  if (c.pagamentos.dinheiro) pag.push('Dinheiro');

  $('#blocos-info').innerHTML = `
    <div class="bloco-info">
      <div class="bloco-info__rotulo">Endereço</div>
      <div class="bloco-info__valor">${esc(c.endereco)}</div>
    </div>
    <div class="bloco-info">
      <div class="bloco-info__rotulo">Horário</div>
      <div class="bloco-info__valor">${esc(c.horario)}</div>
    </div>
    <div class="bloco-info">
      <div class="bloco-info__rotulo">Pedidos e dúvidas</div>
      <div class="bloco-info__valor">${esc(formatarTelefone(c.whatsapp))}</div>
    </div>
    <div class="bloco-info">
      <div class="bloco-info__rotulo">Formas de pagamento</div>
      <div class="bloco-info__valor">${pag.join(' · ') || '—'}</div>
    </div>`;

  $('#rodape-links').innerHTML = [
    c.instagram ? `<a href="https://instagram.com/${esc(c.instagram)}" target="_blank" rel="noopener">@${esc(c.instagram)}</a>` : '',
    c.tiktok ? `<a href="https://tiktok.com/@${esc(c.tiktok)}" target="_blank" rel="noopener">TikTok @${esc(c.tiktok)}</a>` : '',
    `<a href="${waLink(c.whatsapp, 'Olá! Vim pelo site 😊')}" target="_blank" rel="noopener">WhatsApp</a>`
  ].filter(Boolean).join('');
  $('#rodape-endereco').textContent = c.endereco;
}

/* ---------------- montar item ---------------- */
function abrirMontagem(produtoId, tamanhoId) {
  const produto = DB.produtos.find((p) => p.id === produtoId);
  const tamanho = produto && produto.tamanhos.find((t) => t.id === tamanhoId);
  if (!produto || !tamanho) return;

  montagem = { produto, tamanho, sabor: '', complementos: [], obs: '', qtd: 1 };

  $('#montar-titulo').textContent = `${produto.nome} ${tamanho.nome}`;
  $('#montar-sub').textContent = `${brl(tamanho.preco)} · complementos grátis`;
  renderMontagem();
  abrirModal('modal-montar');
}

function renderMontagem() {
  const m = montagem;
  const max = DB.config.maxComplementos;
  const sabores = DB.sabores.filter((s) => s.ativo);
  let n = 1;
  let html = '';

  if (m.produto.temSabor && sabores.length) {
    html += `<div class="passo">
      <h3 class="passo__titulo"><span class="passo__num">${n++}</span>Escolha o sabor</h3>
      <div class="opcoes opcoes--linha">
        ${sabores.map((s) => `
          <label class="opcao ${m.sabor === s.nome ? 'opcao--marcada' : ''}">
            <input type="radio" name="sabor" value="${esc(s.nome)}" ${m.sabor === s.nome ? 'checked' : ''}>
            <span class="opcao__nome">${esc(s.nome)}</span>
          </label>`).join('')}
      </div>
    </div>`;
  }

  const grupos = agruparComplementos(DB.complementos.filter((c) => c.ativo));

  html += `<div class="passo">
    <h3 class="passo__titulo"><span class="passo__num">${n++}</span>Complementos</h3>
    <div class="contador-comp">
      <span>${max > 0 ? `Escolha até ${max}` : 'Escolha quantos quiser'}</span>
      <span>${m.complementos.length} selecionado${m.complementos.length === 1 ? '' : 's'}</span>
    </div>
    ${Object.keys(grupos).map((g) => `
      <p class="grupo-comp__titulo">${esc(g)}</p>
      <div class="opcoes opcoes--linha">
        ${grupos[g].map((c) => {
          const marcado = m.complementos.includes(c.id);
          const cheio = max > 0 && m.complementos.length >= max && !marcado;
          return `<label class="opcao ${marcado ? 'opcao--marcada' : ''} ${cheio ? 'opcao--bloqueada' : ''}">
            <input type="checkbox" name="comp" value="${c.id}" ${marcado ? 'checked' : ''} ${cheio ? 'disabled' : ''}>
            <span class="opcao__nome">${esc(c.nome)}</span>
            ${c.preco > 0 ? `<span class="opcao__extra">+${brl(c.preco)}</span>` : '<span class="opcao__extra">grátis</span>'}
          </label>`;
        }).join('')}
      </div>`).join('')}
  </div>`;

  html += `<div class="passo">
    <h3 class="passo__titulo"><span class="passo__num">${n}</span>Observações</h3>
    <textarea class="entrada" id="montar-obs" placeholder="Ex.: sem granulado, caprichar no leite condensado…">${esc(m.obs)}</textarea>
  </div>`;

  $('#montar-corpo').innerHTML = html;
  atualizarBotaoMontar();
}

function precoMontagem() {
  const extras = montagem.complementos.reduce((s, id) => {
    const c = DB.complementos.find((x) => x.id === id);
    return s + (c ? c.preco : 0);
  }, 0);
  return montagem.tamanho.preco + extras;
}

function atualizarBotaoMontar() {
  $('#montar-qtd').textContent = montagem.qtd;
  $('#montar-add').textContent = `Adicionar • ${brl(precoMontagem() * montagem.qtd)}`;
}

/* ---------------- carrinho ---------------- */
function addAoCarrinho() {
  const m = montagem;
  if (m.produto.temSabor && DB.sabores.filter((s) => s.ativo).length && !m.sabor) {
    toast('Escolha um sabor para continuar');
    return;
  }
  m.obs = ($('#montar-obs') && $('#montar-obs').value.trim()) || '';

  carrinho.push({
    id: uid('item'),
    tamanhoId: m.tamanho.id,
    produtoNome: m.produto.nome,
    tamanhoNome: m.tamanho.nome,
    sabor: m.sabor,
    complementosIds: [...m.complementos],
    complementos: m.complementos.map((id) => {
      const c = DB.complementos.find((x) => x.id === id);
      return c ? c.nome : '';
    }).filter(Boolean),
    obs: m.obs,
    preco: precoMontagem(),
    qtd: m.qtd
  });

  fecharModal('modal-montar');
  renderBarra();
  toast('Adicionado ao carrinho 💜');
}

const subtotalCarrinho = () => carrinho.reduce((s, i) => s + i.preco * i.qtd, 0);
const qtdCarrinho = () => carrinho.reduce((s, i) => s + i.qtd, 0);

function renderBarra() {
  const q = qtdCarrinho();
  $('#barra-carrinho').hidden = q === 0;
  $('#barra-qtd').textContent = q + (q === 1 ? ' item' : ' itens');
  $('#barra-total').textContent = brl(subtotalCarrinho());
}

function renderCarrinho() {
  const corpo = $('#carrinho-corpo');
  if (!carrinho.length) {
    corpo.innerHTML = '<div class="vazio"><div class="vazio__icone">🍧</div><p>Seu carrinho está vazio.</p></div>';
    $('#btn-ir-checkout').disabled = true;
    return;
  }
  $('#btn-ir-checkout').disabled = false;
  corpo.innerHTML = carrinho.map((i) => `
    <div class="item-carrinho">
      <div class="item-carrinho__corpo">
        <div class="item-carrinho__nome">${esc(i.produtoNome)} ${esc(i.tamanhoNome)}${i.sabor ? ' · ' + esc(i.sabor) : ''}</div>
        ${i.complementos.length ? `<div class="item-carrinho__det">➕ ${esc(i.complementos.join(', '))}</div>` : ''}
        ${i.obs ? `<div class="item-carrinho__det">📝 ${esc(i.obs)}</div>` : ''}
        <div style="margin-top:8px">
          <span class="qtd">
            <button class="qtd__btn" data-menos="${i.id}" aria-label="Diminuir">−</button>
            <span class="qtd__valor">${i.qtd}</span>
            <button class="qtd__btn" data-mais="${i.id}" aria-label="Aumentar">+</button>
          </span>
        </div>
      </div>
      <div class="item-carrinho__lado">
        <span class="item-carrinho__preco">${brl(i.preco * i.qtd)}</span>
        <button class="link-remover" data-remover="${i.id}">Remover</button>
      </div>
    </div>`).join('') + `
    <div class="resumo">
      <div class="resumo__linha"><span>Subtotal</span><span>${brl(subtotalCarrinho())}</span></div>
      <div class="resumo__linha"><span>Taxa de entrega</span><span>calculada no próximo passo</span></div>
    </div>`;
}

/* ---------------- checkout ---------------- */
function renderCheckout() {
  const c = DB.config;
  const bairros = c.bairros || [];
  const pag = c.pagamentos;

  $('#form-checkout').innerHTML = `
    <div class="passo">
      <h3 class="passo__titulo"><span class="passo__num">1</span>Seus dados</h3>
      <div class="campo">
        <label class="campo__label" for="ck-nome">Nome</label>
        <input class="entrada" id="ck-nome" autocomplete="name" placeholder="Como podemos te chamar?" required>
      </div>
      <div class="campo">
        <label class="campo__label" for="ck-fone">WhatsApp</label>
        <input class="entrada" id="ck-fone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="(12) 90000-0000" required>
      </div>
    </div>

    <div class="passo">
      <h3 class="passo__titulo"><span class="passo__num">2</span>Entrega ou retirada</h3>
      <div class="opcoes opcoes--linha">
        <label class="opcao opcao--marcada" data-tipo="entrega">
          <input type="radio" name="tipo" value="entrega" checked>
          <span class="opcao__nome">🛵 Entrega</span>
          <span class="opcao__extra">${c.taxaEntrega > 0 ? brl(c.taxaEntrega) : 'grátis'}</span>
        </label>
        <label class="opcao" data-tipo="retirada">
          <input type="radio" name="tipo" value="retirada">
          <span class="opcao__nome">🏪 Retirar</span>
          <span class="opcao__extra">grátis</span>
        </label>
      </div>

      <div id="bloco-endereco" style="margin-top:14px">
        <div class="linha-campos linha-campos--3">
          <div class="campo">
            <label class="campo__label" for="ck-rua">Rua</label>
            <input class="entrada" id="ck-rua" autocomplete="address-line1" placeholder="Rua / Avenida">
          </div>
          <div class="campo">
            <label class="campo__label" for="ck-numero">Número</label>
            <input class="entrada" id="ck-numero" placeholder="123">
          </div>
        </div>
        <div class="campo">
          <label class="campo__label" for="ck-bairro">Bairro</label>
          ${bairros.length
            ? `<select class="entrada" id="ck-bairro">
                 <option value="">Selecione o bairro</option>
                 ${bairros.map((b) => `<option value="${esc(b.nome)}" data-id="${b.id}" data-taxa="${b.taxa}">${esc(b.nome)} — ${brl(b.taxa)}</option>`).join('')}
               </select>`
            : `<input class="entrada" id="ck-bairro" placeholder="Seu bairro">`}
        </div>
        <div class="linha-campos">
          <div class="campo">
            <label class="campo__label" for="ck-compl">Complemento</label>
            <input class="entrada" id="ck-compl" placeholder="Casa, apto, bloco…">
          </div>
          <div class="campo">
            <label class="campo__label" for="ck-ref">Ponto de referência</label>
            <input class="entrada" id="ck-ref" placeholder="Perto de…">
          </div>
        </div>
      </div>

      <div id="bloco-retirada" class="aviso aviso--info" hidden>
        Retirada em <strong>${esc(c.endereco)}</strong>. Avisamos por WhatsApp quando estiver pronto.
      </div>
    </div>

    <div class="passo">
      <h3 class="passo__titulo"><span class="passo__num">3</span>Pagamento</h3>
      <div class="opcoes">
        ${pag.pix ? `<label class="opcao opcao--marcada"><input type="radio" name="pag" value="pix" checked><span class="opcao__nome">⚡ PIX</span><span class="opcao__extra">na hora</span></label>` : ''}
        ${pag.cartao ? `<label class="opcao"><input type="radio" name="pag" value="cartao" ${!pag.pix ? 'checked' : ''}><span class="opcao__nome">💳 Cartão</span><span class="opcao__extra">maquininha na entrega</span></label>` : ''}
        ${pag.dinheiro ? `<label class="opcao"><input type="radio" name="pag" value="dinheiro" ${!pag.pix && !pag.cartao ? 'checked' : ''}><span class="opcao__nome">💵 Dinheiro</span><span class="opcao__extra">na entrega</span></label>` : ''}
      </div>
      <div class="campo" id="bloco-troco" style="margin-top:12px" hidden>
        <label class="campo__label" for="ck-troco">Precisa de troco para quanto?</label>
        <input class="entrada" id="ck-troco" type="number" min="0" step="0.5" placeholder="Ex.: 50">
        <p class="campo__dica">Deixe em branco se levar o valor certo.</p>
      </div>
      <div id="bloco-pix" class="pix-box" hidden></div>
    </div>

    <div class="passo">
      <h3 class="passo__titulo"><span class="passo__num">4</span>Observação do pedido</h3>
      <textarea class="entrada" id="ck-obs" placeholder="Algo mais que devemos saber?"></textarea>
    </div>

    <div class="resumo" id="ck-resumo"></div>
    <div id="ck-erro" class="aviso aviso--erro" style="margin-top:12px" hidden></div>
  `;

  atualizarResumoCheckout();
}

function bairroSelecionado() {
  const sel = $('#ck-bairro');
  if (sel && sel.tagName === 'SELECT') {
    const op = sel.options[sel.selectedIndex];
    if (op && op.value) return { id: op.dataset.id, nome: op.value, taxa: Number(op.dataset.taxa) };
  }
  return null;
}

function taxaAtual() {
  const tipo = $('input[name="tipo"]:checked');
  if (!tipo || tipo.value === 'retirada') return 0;
  const b = bairroSelecionado();
  return b ? b.taxa : (Number(DB.config.taxaEntrega) || 0);
}

function atualizarResumoCheckout() {
  const sub = subtotalCarrinho();
  const taxa = taxaAtual();
  $('#ck-resumo').innerHTML = `
    <div class="resumo__linha"><span>Subtotal</span><span>${brl(sub)}</span></div>
    <div class="resumo__linha"><span>Taxa de entrega</span><span>${taxa > 0 ? brl(taxa) : 'Grátis'}</span></div>
    <div class="resumo__linha resumo__linha--total"><span>Total</span><span>${brl(sub + taxa)}</span></div>
    <p class="campo__dica" style="margin-top:6px">O valor final é confirmado pela loja ao registrar o pedido.</p>`;

  const pag = $('input[name="pag"]:checked');
  $('#bloco-troco').hidden = !(pag && pag.value === 'dinheiro');

  const caixaPix = $('#bloco-pix');
  if (pag && pag.value === 'pix') {
    caixaPix.hidden = false;
    renderPix(sub + taxa, caixaPix);
  } else {
    caixaPix.hidden = true;
  }
}

function renderPix(valor, caixa) {
  const p = DB.config.pix || {};
  const codigo = pixCopiaECola({
    chave: p.chave,
    beneficiario: p.beneficiario,
    cidade: p.cidade,
    valor,
    txid: 'AMC' + Date.now().toString().slice(-8)
  });
  caixa.innerHTML = `
    <div class="pix-box__qr" id="pix-qr"></div>
    <p class="campo__label">PIX copia e cola — ${brl(valor)}</p>
    <div class="pix-codigo" id="pix-codigo">${esc(codigo)}</div>
    <button type="button" class="btn btn--folha btn--bloco btn--sm" id="btn-copiar-pix">Copiar código PIX</button>
    <p class="campo__dica">Chave ${esc(p.tipoChave || '')}: <strong>${esc(p.chave || '')}</strong> · ${esc(p.beneficiario || '')}<br>
    Envie o comprovante no WhatsApp junto com o pedido.</p>`;

  const alvo = $('#pix-qr');
  alvo.innerHTML = '';
  try {
    QR.desenhar(alvo, codigo, { tamanho: 148, nivel: 'M', margem: 2 });
  } catch (e) {
    console.error('Falha ao gerar o QR Code:', e);
    alvo.innerHTML = '<span style="color:#555;font-size:12px;text-align:center;padding:8px">Use o código copia e cola abaixo</span>';
  }
}

async function copiarPix() {
  const txt = $('#pix-codigo').textContent;
  try {
    await navigator.clipboard.writeText(txt);
    toast('Código PIX copiado');
  } catch (e) {
    const r = document.createRange();
    r.selectNodeContents($('#pix-codigo'));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    toast('Selecione e copie o código');
  }
}

/* ---------------- enviar pedido ---------------- */
let enviando = false;

async function enviarPedido() {
  if (enviando) return;

  const erroEl = $('#ck-erro');
  const nome = $('#ck-nome').value.trim();
  const fone = $('#ck-fone').value.trim();
  const tipo = ($('input[name="tipo"]:checked') || {}).value || 'entrega';
  const pagamento = ($('input[name="pag"]:checked') || {}).value;

  const erros = [];
  if (nome.length < 2) erros.push('informe seu nome');
  if (digits(fone).length < 10) erros.push('informe um WhatsApp válido com DDD');
  if (!pagamento) erros.push('escolha a forma de pagamento');

  let endereco = null;
  let bairroId = null;
  if (tipo === 'entrega') {
    const rua = $('#ck-rua').value.trim();
    const numero = $('#ck-numero').value.trim();
    const b = bairroSelecionado();
    const bairro = b ? b.nome : $('#ck-bairro').value.trim();
    bairroId = b ? b.id : null;
    if (!rua) erros.push('informe a rua');
    if (!numero) erros.push('informe o número');
    if (!bairro) erros.push('informe o bairro');
    endereco = {
      rua, numero, bairro,
      complemento: $('#ck-compl').value.trim(),
      referencia: $('#ck-ref').value.trim()
    };
  }

  if (erros.length) {
    erroEl.hidden = false;
    erroEl.textContent = 'Para enviar o pedido, ' + erros.join(', ') + '.';
    erroEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  erroEl.hidden = true;

  const botao = $('#btn-enviar-pedido');
  enviando = true;
  botao.disabled = true;
  botao.textContent = 'Registrando pedido…';

  const payload = {
    tipo,
    pagamento,
    bairro_id: bairroId,
    troco: pagamento === 'dinheiro' ? Number($('#ck-troco').value) || 0 : 0,
    observacao: $('#ck-obs').value.trim(),
    cliente: { nome, telefone: formatarTelefone(fone) },
    endereco,
    itens: carrinho.map((i) => ({
      tamanho_id: i.tamanhoId,
      sabor: i.sabor,
      complementos: i.complementosIds,
      obs: i.obs,
      qtd: i.qtd
    }))
  };

  try {
    const res = await criarPedido(payload);

    const pedido = {
      numero: String(res.numero).padStart(3, '0'),
      cliente: { nome, telefone: formatarTelefone(fone) },
      tipo, endereco, pagamento,
      troco: payload.troco,
      itens: res.itens.map((i) => ({ ...i, preco: Number(i.preco) })),
      subtotal: Number(res.subtotal),
      taxa: Number(res.taxa),
      total: Number(res.total),
      observacao: payload.observacao
    };

    const texto = pedidoParaTexto(pedido, DB.config);
    const link = waLink(DB.config.whatsapp, texto);
    const janela = window.open(link, '_blank', 'noopener');

    carrinho = [];
    renderBarra();
    fecharModal('modal-checkout');
    fecharModal('modal-carrinho');
    mostrarSucesso(pedido, link, !janela);
  } catch (e) {
    erroEl.hidden = false;
    erroEl.textContent = e.message;
    erroEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } finally {
    enviando = false;
    botao.disabled = false;
    botao.textContent = 'Enviar pedido pelo WhatsApp';
  }
}

function mostrarSucesso(pedido, link, bloqueado) {
  $('#sucesso-corpo').innerHTML = `
    <div class="sucesso">
      <div class="sucesso__icone">🍧</div>
      <p>Seu pedido foi registrado com o número</p>
      <div class="sucesso__num">#${pedido.numero}</div>
      <p style="color:var(--creme-fraco);font-size:14px">
        ${bloqueado
          ? 'Toque no botão abaixo para enviar a mensagem no WhatsApp e confirmar.'
          : 'Abrimos o WhatsApp com a mensagem pronta. Se ele não abriu, use o botão abaixo.'}
      </p>
    </div>
    <a class="btn btn--folha btn--bloco" style="margin-top:16px" href="${link}" target="_blank" rel="noopener">Abrir WhatsApp com o pedido</a>
    ${pedido.pagamento === 'pix' ? `<div class="aviso aviso--info" style="margin-top:14px">
      Pagamento por PIX: envie o comprovante na conversa. Assim que confirmarmos, você recebe a mensagem de <strong>pedido recebido</strong>.
    </div>` : ''}
    <div class="resumo" style="margin-top:6px">
      <div class="resumo__linha"><span>Total</span><span>${brl(pedido.total)}</span></div>
      <div class="resumo__linha"><span>Pagamento</span><span>${LABEL_PAGAMENTO[pedido.pagamento]}</span></div>
    </div>`;
  abrirModal('modal-sucesso');
}

/* ---------------- eventos ---------------- */
document.addEventListener('click', (ev) => {
  const t = ev.target;

  if (t.closest('[data-fechar]')) { fecharModal(t.closest('.modal').id); return; }

  const tam = t.closest('.tamanho');
  if (tam) { abrirMontagem(tam.dataset.produto, tam.dataset.tamanho); return; }

  if (t.id === 'btn-abrir-carrinho') { renderCarrinho(); abrirModal('modal-carrinho'); return; }
  if (t.id === 'montar-add') { addAoCarrinho(); return; }
  if (t.id === 'montar-mais') { montagem.qtd++; atualizarBotaoMontar(); return; }
  if (t.id === 'montar-menos') { if (montagem.qtd > 1) montagem.qtd--; atualizarBotaoMontar(); return; }
  if (t.id === 'btn-copiar-pix') { copiarPix(); return; }

  if (t.dataset && t.dataset.mais) {
    carrinho.find((x) => x.id === t.dataset.mais).qtd++;
    renderCarrinho(); renderBarra(); return;
  }
  if (t.dataset && t.dataset.menos) {
    const i = carrinho.find((x) => x.id === t.dataset.menos);
    if (i.qtd > 1) i.qtd--; else carrinho = carrinho.filter((x) => x.id !== i.id);
    renderCarrinho(); renderBarra(); return;
  }
  if (t.dataset && t.dataset.remover) {
    carrinho = carrinho.filter((x) => x.id !== t.dataset.remover);
    renderCarrinho(); renderBarra(); return;
  }

  if (t.id === 'btn-ir-checkout') {
    if (!carrinho.length) return;
    const min = Number(DB.config.pedidoMinimo) || 0;
    if (min > 0 && subtotalCarrinho() < min) { toast('Pedido mínimo de ' + brl(min)); return; }
    fecharModal('modal-carrinho');
    renderCheckout();
    abrirModal('modal-checkout');
    return;
  }
  if (t.id === 'btn-enviar-pedido') { enviarPedido(); return; }

  if (t.classList && t.classList.contains('modal')) fecharModal(t.id);
});

document.addEventListener('change', (ev) => {
  const t = ev.target;

  if (t.name === 'sabor') {
    montagem.sabor = t.value;
    $$('#montar-corpo .opcao').forEach((o) => {
      const inp = $('input[name="sabor"]', o);
      if (inp) o.classList.toggle('opcao--marcada', inp.checked);
    });
    return;
  }
  if (t.name === 'comp') {
    if (t.checked) montagem.complementos.push(t.value);
    else montagem.complementos = montagem.complementos.filter((c) => c !== t.value);
    const obs = $('#montar-obs');
    if (obs) montagem.obs = obs.value;
    renderMontagem();
    return;
  }
  if (t.name === 'tipo') {
    const entrega = t.value === 'entrega';
    $('#bloco-endereco').hidden = !entrega;
    $('#bloco-retirada').hidden = entrega;
    $$('#form-checkout [data-tipo]').forEach((o) => {
      o.classList.toggle('opcao--marcada', $('input', o).checked);
    });
    atualizarResumoCheckout();
    return;
  }
  if (t.name === 'pag') {
    $$('#form-checkout input[name="pag"]').forEach((i) => {
      i.closest('.opcao').classList.toggle('opcao--marcada', i.checked);
    });
    atualizarResumoCheckout();
    return;
  }
  if (t.id === 'ck-bairro') atualizarResumoCheckout();
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    const aberto = $$('.modal:not([hidden])').pop();
    if (aberto) fecharModal(aberto.id);
  }
});
