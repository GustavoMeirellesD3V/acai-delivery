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

/* ---------------- repetição em falha passageira ----------------
   O Supabase às vezes recusa uma requisição com PGRST303
   ("JWT issued at future"): o gateway deles emite um token interno
   e o PostgREST recusa porque os relógios dos dois nós estão
   dessincronizados por alguns instantes. Não há correção do nosso
   lado — o token é emitido e julgado dentro da infraestrutura deles.
   Some sozinho em menos de um segundo, então tentamos de novo.

   Sem isto, um piscar de olhos no servidor derruba a loja inteira
   para quem estiver abrindo o site naquele instante.
---------------------------------------------------------------- */
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* Erro que vale repetir: o servidor recusou ANTES de fazer qualquer
   coisa, então repetir não duplica nada. */
function ehRecusaPassageira(erro) {
  const m = String((erro && erro.message) || erro || '');
  return /PGRST303|issued at future|JWTIssuedAtFuture|jwt.*not.*yet.*valid/i.test(m);
}

/* Erro de rede: pode ter chegado ao servidor ou não. Repetir é seguro
   para leitura, mas não para gravação. */
function ehFalhaDeRede(erro) {
  const m = String((erro && erro.message) || erro || '');
  return /Failed to fetch|NetworkError|Load failed|ERR_NETWORK|timeout|AbortError/i.test(m);
}

async function comRetentativa(fn, { tentativas = 4, repetirRede = true } = {}) {
  let ultimo;
  for (let i = 0; i < tentativas; i++) {
    try {
      return await fn();
    } catch (e) {
      ultimo = e;
      const vale = ehRecusaPassageira(e) || (repetirRede && ehFalhaDeRede(e));
      if (!vale || i === tentativas - 1) throw e;
      // 300ms, 600ms, 1200ms — com uma folga aleatória para não
      // sincronizar todos os clientes na mesma retentativa
      await espera(300 * Math.pow(2, i) + Math.random() * 200);
    }
  }
  throw ultimo;
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
  return comRetentativa(() => buscarCatalogo());
}

async function buscarCatalogo() {
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
  if (falhou) {
    const e = new Error(falhou.error.message);
    e.code = falhou.error.code;          // PGRST303 chega por aqui
    throw e;
  }

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

  // repetirRede: false é proposital. Numa falha de rede não dá para
  // saber se o pedido foi gravado antes da conexão cair — repetir
  // criaria um pedido duplicado. Já a recusa por relógio acontece
  // antes de a função rodar, então repetir é seguro.
  return comRetentativa(async () => {
    const { data, error } = await s.rpc('criar_pedido', { payload });
    if (error) {
      const e = new Error(error.message);
      e.code = error.code;
      if (ehRecusaPassageira(e)) throw e;     // deixa a retentativa pegar
      throw new Error(traduzErro(error.message));
    }
    return data;
  }, { tentativas: 3, repetirRede: false });
}

/* Traduz o erro do banco para uma frase que o cliente entende.
   O texto cru do Postgres nunca chega à tela: evita vazar nome de
   função, tabela ou qualquer detalhe interno do servidor. */
function traduzErro(msg) {
  const m = String(msg || '');

  if (m.includes('LOJA_FECHADA')) {
    return 'A loja está fechada no momento e não está aceitando pedidos. Volte no horário de atendimento.';
  }
  if (m.includes('MUITOS_PEDIDOS')) {
    return 'Muitos pedidos seguidos deste aparelho. Aguarde alguns minutos e tente de novo — '
         + 'se for urgente, chame no WhatsApp da loja.';
  }
  if (m.includes('INDISPONIVEL')) {
    return 'Um item do seu carrinho saiu do cardápio. Revise o pedido.';
  }
  if (m.includes('DADOS_INVALIDOS')) {
    // a parte depois dos dois-pontos é escrita por nós, é segura de mostrar
    const detalhe = m.split('DADOS_INVALIDOS:')[1];
    return detalhe ? 'Confira os dados: ' + detalhe.trim() + '.' : 'Confira os dados do pedido.';
  }
  if (m.includes('Failed to fetch') || m.includes('NetworkError')) {
    return 'Sem conexão com o servidor. Verifique sua internet e tente de novo.';
  }
  return 'Não foi possível registrar o pedido. Tente novamente em instantes.';
}

/* ---------------- painel: autenticação ---------------- */
async function entrar(email, senha) {
  const s = cliente();
  if (!s) throw new Error(erroConexao);
  const { data, error } = await comRetentativa(
    () => s.auth.signInWithPassword({ email, password: senha }),
    { tentativas: 3, repetirRede: false });
  if (error) {
    // Nunca dizemos se o erro foi no e-mail ou na senha: isso revelaria
    // quais contas existem (enumeração de usuários).
    if (/rate|too many/i.test(error.message)) {
      throw new Error('Muitas tentativas. Aguarde alguns minutos antes de tentar de novo.');
    }
    throw new Error('E-mail ou senha incorretos.');
  }
  await carregarPapel();
  await registrarEvento('LOGIN');
  return data.user;
}

async function sairDaConta() {
  const s = cliente();
  await registrarEvento('LOGOUT');
  pararVigia();
  papelAtual = null;
  if (s) await s.auth.signOut();
}

async function usuarioAtual() {
  const s = cliente();
  if (!s) return null;
  const { data } = await s.auth.getSession();
  return data.session ? data.session.user : null;
}

/* Papel do usuário logado: admin, gerente ou atendente.
   Vem do banco — o navegador não decide o próprio nível de acesso.
   Mesmo que alguém force este valor no DevTools, o RLS no servidor
   continua barrando: esconder botão não é controle de acesso. */
let papelAtual = null;

async function carregarPapel() {
  const s = cliente();
  if (!s) return null;
  const { data, error } = await s.rpc('meu_papel');
  papelAtual = error ? null : data;
  return papelAtual;
}

const ehAdmin   = () => papelAtual === 'admin';
const podeEditarCardapio = () => papelAtual === 'admin' || papelAtual === 'gerente';
const podeExcluirPedido  = () => papelAtual === 'admin' || papelAtual === 'gerente';

/* Sessão expira por inatividade. O Supabase mantém o token válido por
   bem mais tempo; aqui encurtamos para o balcão, onde o painel costuma
   ficar aberto num aparelho compartilhado. */
const INATIVIDADE_MAX = 8 * 60 * 60 * 1000;   // 8 horas
let ultimoUso = Date.now();
let vigia = null;

function marcarAtividade() { ultimoUso = Date.now(); }

function vigiarInatividade(aoExpirar) {
  ['click', 'keydown', 'touchstart'].forEach((ev) =>
    document.addEventListener(ev, marcarAtividade, { passive: true }));
  clearInterval(vigia);
  vigia = setInterval(() => {
    if (Date.now() - ultimoUso > INATIVIDADE_MAX) {
      clearInterval(vigia);
      aoExpirar();
    }
  }, 60000);
}

function pararVigia() { clearInterval(vigia); vigia = null; }

/* Registra no log do banco quem entrou e quem saiu. */
async function registrarEvento(acao) {
  const s = cliente();
  if (!s) return;
  try { await s.rpc('registrar_acesso', { p_acao: acao }); } catch (e) { /* log é best-effort */ }
}

/* ---------------- painel: pedidos ---------------- */
async function carregarPedidos(limite) {
  return comRetentativa(async () => {
    const s = cliente();
    const { data, error } = await s
      .from('pedidos').select('*')
      .order('criado_em', { ascending: false })
      .limit(limite || 200);
    if (error) {
      const e = new Error(error.message);
      e.code = error.code;
      throw e;
    }
    DB.pedidos = data.map(normPedido);
    return DB.pedidos;
  });
}

/* Mês sempre no horário de Brasília (UTC−3, sem horário de verão desde 2019):
   um pedido às 23h do dia 31 pertence ao dia 31, não ao mês seguinte. */
function intervaloDoMes(chave) {
  const [ano, mes] = chave.split('-').map(Number);
  const seguinte = mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, '0')}`;
  return {
    inicio: `${chave}-01T00:00:00-03:00`, fim: `${seguinte}-01T00:00:00-03:00`,
    diaInicio: `${chave}-01`, diaFim: `${seguinte}-01`
  };
}

/* Sem o limite de 200 da lista ao vivo: o mês inteiro, em páginas de 1000
   (o teto por requisição do Supabase). */
async function carregarPedidosDoMes(chave) {
  const { inicio, fim } = intervaloDoMes(chave);
  return comRetentativa(async () => {
    const s = cliente();
    const linhas = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await s
        .from('pedidos').select('*')
        .gte('criado_em', inicio).lt('criado_em', fim)
        .order('criado_em', { ascending: false })
        .range(de, de + 999);
      if (error) throw new Error(error.message);
      linhas.push(...data);
      if (data.length < 1000) break;
    }
    return linhas.map(normPedido);
  });
}

/* ---------------- painel: caixa ---------------- */
async function carregarGastosDoMes(chave) {
  const { diaInicio, diaFim } = intervaloDoMes(chave);
  return comRetentativa(async () => {
    const s = cliente();
    const { data, error } = await s
      .from('gastos').select('id,data,descricao,categoria,valor')
      .gte('data', diaInicio).lt('data', diaFim)
      .order('data', { ascending: false })
      .order('criado_em', { ascending: false });
    if (error) {
      throw new Error(/permission|policy/i.test(error.message)
        ? 'Seu perfil não tem acesso ao caixa.'
        : /gastos/.test(error.message) && /exist|schema cache/i.test(error.message)
          ? 'A tabela de gastos ainda não existe. Rode supabase/migration-caixa.sql no Supabase.'
          : error.message);
    }
    return data.map((g) => ({ ...g, valor: Number(g.valor) }));
  });
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

/* ---------------- painel: equipe ----------------
   Todas estas funções são security definer no banco e
   conferem o papel lá dentro. Chamar por fora do site,
   direto na API, esbarra na mesma checagem.
------------------------------------------------- */
function erroEquipe(msg) {
  const m = String(msg || '');
  if (m.includes('ULTIMO_ADMIN')) {
    return 'Esta é a única conta de administrador. Promova outra pessoa a administrador antes de mudar esta — '
         + 'senão ninguém conseguiria mais administrar o sistema.';
  }
  if (m.includes('SEM_PERMISSAO')) return 'Só o administrador pode gerenciar a equipe.';
  if (m.includes('PAPEL_INVALIDO')) return 'Papel inválido.';
  if (m.includes('USUARIO_NAO_ENCONTRADO')) return 'Conta não encontrada. Sincronize a equipe e tente de novo.';
  return 'Não foi possível concluir. Tente novamente.';
}

async function carregarEquipe() {
  const s = cliente();
  const { data, error } = await s.rpc('listar_equipe');
  if (error) throw new Error(erroEquipe(error.message));
  return data || [];
}

async function definirPapel(id, papel) {
  const s = cliente();
  const { error } = await s.rpc('definir_papel', { p_id: id, p_papel: papel });
  if (error) throw new Error(erroEquipe(error.message));
}

async function definirAtivo(id, ativo) {
  const s = cliente();
  const { error } = await s.rpc('definir_ativo', { p_id: id, p_ativo: ativo });
  if (error) throw new Error(erroEquipe(error.message));
}

async function sincronizarEquipe() {
  const s = cliente();
  const { data, error } = await s.rpc('sincronizar_equipe');
  if (error) throw new Error(erroEquipe(error.message));
  return data;
}

/* ---------------- painel: registro de auditoria ---------------- */
async function carregarAuditoria(limite) {
  const s = cliente();
  const { data, error } = await s
    .from('auditoria')
    .select('em,usuario,papel,acao,tabela,antes,depois')
    .order('em', { ascending: false })
    .limit(limite || 150);
  if (error) {
    throw new Error(/permission|policy/i.test(error.message)
      ? 'Seu perfil não tem acesso ao registro.' : error.message);
  }
  return data;
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
