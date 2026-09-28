/* =========================================================
   Açaí Mais Chantilly — camada de dados (Supabase)

   DB é um cache em memória do cardápio, carregado uma vez
   quando a página abre. As telas leem dele de forma síncrona;
   só a escrita vai no banco.
   ========================================================= */

let sb = null;
let erroConexao = null;

const DB = {
  config: null,
  produtos: [],
  sabores: [],
  complementos: [],
  pedidos: []
};

/* ---------------- conexão ---------------- */
function conectar() {
  const c = window.CONFIG || {};
  if (!c.SUPABASE_URL || c.SUPABASE_URL.startsWith('COLE_AQUI')) {
    erroConexao = 'O arquivo config.js ainda está com os valores de exemplo. '
                + 'Coloque a Project URL e a anon key do seu projeto no Supabase.';
    return null;
  }
  if (typeof window.supabase === 'undefined') {
    erroConexao = 'A biblioteca do Supabase não carregou. Verifique sua conexão com a internet.';
    return null;
  }
  sb = window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  return sb;
}

function cliente() {
  if (!sb) conectar();
  return sb;
}

/* ---------------- normalização ----------------
   O banco usa snake_case; as telas usam camelCase.
   A conversão fica toda aqui.
------------------------------------------------ */
function normConfig(row, bairros) {
  return {
    nomeLoja: row.nome_loja,
    endereco: row.endereco,
    horario: row.horario,
    whatsapp: row.whatsapp,
    instagram: row.instagram,
    tiktok: row.tiktok,
    aberta: row.aberta,
    fechadoManual: row.aberta === false,
    horarios: row.horarios || {},
    aceitaForaHorario: !!row.aceita_fora_horario,
    taxaEntrega: Number(row.taxa_entrega),
    pedidoMinimo: Number(row.pedido_minimo),
    maxComplementos: row.max_complementos,
    pagamentos: row.pagamentos || {},
    pix: row.pix || {},
    mensagens: row.mensagens || {},
    bairros: (bairros || []).map((b) => ({ id: b.id, nome: b.nome, taxa: Number(b.taxa) }))
  };
}

function normPedido(row) {
  return {
    id: row.id,
    numero: String(row.numero).padStart(3, '0'),
    criadoEm: row.criado_em,
    status: row.status,
    cliente: {
      nome: row.cliente_nome,
      telefone: row.cliente_telefone,
      telefoneBruto: digits(row.cliente_telefone)
    },
    tipo: row.tipo,
    endereco: row.endereco,
    pagamento: row.pagamento,
    troco: Number(row.troco),
    itens: (row.itens || []).map((i) => ({ ...i, preco: Number(i.preco) })),
    subtotal: Number(row.subtotal),
    taxa: Number(row.taxa),
    total: Number(row.total),
    observacao: row.observacao || '',
    historico: row.historico || [],
    impresso: row.impresso
  };
}

/* ---------------- carga do cardápio ---------------- */
async function carregarCatalogo() {
  const s = cliente();
  if (!s) throw new Error(erroConexao);

  const [cfg, prods, tams, sabs, comps, bairros] = await Promise.all([
    s.from('config').select('*').eq('id', 1).single(),
    s.from('produtos').select('*').order('ordem'),
    s.from('tamanhos').select('*').order('ordem'),
    s.from('sabores').select('*').order('ordem'),
    s.from('complementos').select('*').order('ordem'),
    s.from('bairros').select('*').order('nome')
  ]);

  const falhou = [cfg, prods, tams, sabs, comps, bairros].find((r) => r.error);
  if (falhou) throw new Error(falhou.error.message);

  DB.config = normConfig(cfg.data, bairros.data);

  DB.produtos = prods.data.map((p) => ({
    id: p.id,
    nome: p.nome,
    descricao: p.descricao,
    temSabor: p.tem_sabor,
    ativo: p.ativo,
    tamanhos: tams.data
      .filter((t) => t.produto_id === p.id)
      .map((t) => ({ id: t.id, nome: t.nome, preco: Number(t.preco), ativo: t.ativo }))
  }));

  DB.sabores = sabs.data.map((s2) => ({ id: s2.id, nome: s2.nome, ativo: s2.ativo }));
  DB.complementos = comps.data.map((c) => ({
    id: c.id, nome: c.nome, categoria: c.categoria, preco: Number(c.preco), ativo: c.ativo
  }));

  return DB;
}

/* ---------------- pedido do cliente ----------------
   Vai pela função criar_pedido() do banco, que recalcula
   todos os preços. O navegador não decide quanto custa.
---------------------------------------------------- */
async function criarPedido(payload) {
  const s = cliente();
  if (!s) throw new Error(erroConexao);

  const { data, error } = await s.rpc('criar_pedido', { payload });
  if (error) throw new Error(traduzErro(error.message));
  return data;
}

function traduzErro(msg) {
  const m = String(msg || '');
  if (m.includes('LOJA_FECHADA')) {
    return 'A loja está fechada no momento e não está aceitando pedidos. Volte no horário de atendimento.';
  }
  if (m.includes('Pedido mínimo')) return m.replace(/^.*?(Pedido mínimo.*?)$/s, '$1');
  if (m.includes('indisponível')) return 'Um item do seu carrinho saiu do cardápio. Revise o pedido.';
  if (m.includes('vazio')) return 'Seu carrinho está vazio.';
  if (m.includes('inválido')) return 'Confira seu nome e telefone.';
  if (m.includes('Failed to fetch') || m.includes('NetworkError')) {
    return 'Sem conexão com o servidor. Verifique sua internet e tente de novo.';
  }
  return 'Não foi possível registrar o pedido. Tente novamente em instantes.';
}

/* ---------------- painel: autenticação ---------------- */
async function entrar(email, senha) {
  const s = cliente();
  if (!s) throw new Error(erroConexao);
  const { data, error } = await s.auth.signInWithPassword({ email, password: senha });
  if (error) {
    if (/invalid login/i.test(error.message)) throw new Error('E-mail ou senha incorretos.');
    if (/email not confirmed/i.test(error.message)) throw new Error('Confirme o e-mail antes de entrar.');
    throw new Error(error.message);
  }
  return data.user;
}

async function sairDaConta() {
  const s = cliente();
  if (s) await s.auth.signOut();
}

async function usuarioAtual() {
  const s = cliente();
  if (!s) return null;
  const { data } = await s.auth.getSession();
  return data.session ? data.session.user : null;
}

/* ---------------- painel: pedidos ---------------- */
async function carregarPedidos(limite) {
  const s = cliente();
  const { data, error } = await s
    .from('pedidos').select('*')
    .order('criado_em', { ascending: false })
    .limit(limite || 200);
  if (error) throw new Error(error.message);
  DB.pedidos = data.map(normPedido);
  return DB.pedidos;
}

async function atualizarStatus(pedidoId, status) {
  const s = cliente();
  const p = DB.pedidos.find((x) => x.id === pedidoId);
  const historico = (p ? p.historico : []).concat([{ status, em: new Date().toISOString() }]);
  const { error } = await s.from('pedidos').update({ status, historico }).eq('id', pedidoId);
  if (error) throw new Error(error.message);
  if (p) { p.status = status; p.historico = historico; }
}

async function marcarImpresso(pedidoId) {
  const s = cliente();
  await s.from('pedidos').update({ impresso: true }).eq('id', pedidoId);
  const p = DB.pedidos.find((x) => x.id === pedidoId);
  if (p) p.impresso = true;
}

async function excluirPedido(pedidoId) {
  const s = cliente();
  const { error } = await s.from('pedidos').delete().eq('id', pedidoId);
  if (error) throw new Error(error.message);
  DB.pedidos = DB.pedidos.filter((p) => p.id !== pedidoId);
}

/* ---------------- painel: tempo real ---------------- */
let canal = null;

function ouvirPedidos(aoChegar, aoMudar) {
  const s = cliente();
  if (!s) return null;
  if (canal) s.removeChannel(canal);

  canal = s.channel('pedidos-ao-vivo')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedidos' }, (msg) => {
      const p = normPedido(msg.new);
      DB.pedidos.unshift(p);
      if (aoChegar) aoChegar(p);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos' }, (msg) => {
      const p = normPedido(msg.new);
      const i = DB.pedidos.findIndex((x) => x.id === p.id);
      if (i >= 0) DB.pedidos[i] = p;
      if (aoMudar) aoMudar(p);
    })
    .subscribe();

  return canal;
}

function pararDeOuvir() {
  const s = cliente();
  if (canal && s) { s.removeChannel(canal); canal = null; }
}

/* ---------------- painel: edição do cardápio ---------------- */
const paraNumero = (v) => Number(v) || 0;

async function salvarConfig(c) {
  const s = cliente();
  const { error } = await s.from('config').update({
    nome_loja: c.nomeLoja,
    endereco: c.endereco,
    horario: c.horario,
    whatsapp: c.whatsapp,
    instagram: c.instagram,
    tiktok: c.tiktok,
    aberta: c.aberta,
    horarios: c.horarios || {},
    aceita_fora_horario: !!c.aceitaForaHorario,
    taxa_entrega: paraNumero(c.taxaEntrega),
    pedido_minimo: paraNumero(c.pedidoMinimo),
    max_complementos: paraNumero(c.maxComplementos),
    pagamentos: c.pagamentos,
    pix: c.pix,
    mensagens: c.mensagens,
    atualizado_em: new Date().toISOString()
  }).eq('id', 1);
  if (error) throw new Error(error.message);
  DB.config = { ...DB.config, ...c };
}

async function salvarLinha(tabela, id, campos) {
  const s = cliente();
  const { error } = await s.from(tabela).update(campos).eq('id', id);
  if (error) throw new Error(error.message);
}

async function inserirLinha(tabela, campos) {
  const s = cliente();
  const { data, error } = await s.from(tabela).insert(campos).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function removerLinha(tabela, id) {
  const s = cliente();
  const { error } = await s.from(tabela).delete().eq('id', id);
  if (error) throw new Error(error.message);
}
