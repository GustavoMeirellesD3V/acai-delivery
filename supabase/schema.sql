-- =========================================================
--  Açaí Mais Chantilly — banco de dados
--  Rode este arquivo inteiro no SQL Editor do Supabase.
--  Pode rodar de novo sem medo: tudo é idempotente.
-- =========================================================

-- ---------------------------------------------------------
--  1. TABELAS
-- ---------------------------------------------------------

-- Configuração da loja (uma linha só)
create table if not exists public.config (
  id              int primary key default 1 check (id = 1),
  nome_loja       text    not null default 'Açaí Mais Chantilly',
  endereco        text    not null default '',
  horario         text    not null default '',
  whatsapp        text    not null default '',
  instagram       text    not null default '',
  tiktok          text    not null default '',
  aberta          boolean not null default true,
  taxa_entrega    numeric(10,2) not null default 0 check (taxa_entrega >= 0),
  pedido_minimo   numeric(10,2) not null default 0 check (pedido_minimo >= 0),
  max_complementos int     not null default 0 check (max_complementos >= 0),
  horarios        jsonb   not null default '{}'::jsonb,
  aceita_fora_horario boolean not null default false,
  pagamentos      jsonb   not null default '{"pix":true,"cartao":true,"dinheiro":true}'::jsonb,
  pix             jsonb   not null default '{}'::jsonb,
  mensagens       jsonb   not null default '{}'::jsonb,
  atualizado_em   timestamptz not null default now()
);

create table if not exists public.produtos (
  id         uuid primary key default gen_random_uuid(),
  nome       text    not null,
  descricao  text    not null default '',
  tem_sabor  boolean not null default false,
  ativo      boolean not null default true,
  ordem      int     not null default 0
);

create table if not exists public.tamanhos (
  id         uuid primary key default gen_random_uuid(),
  produto_id uuid    not null references public.produtos(id) on delete cascade,
  nome       text    not null,
  preco      numeric(10,2) not null check (preco >= 0),
  ativo      boolean not null default true,
  ordem      int     not null default 0
);
create index if not exists tamanhos_produto_idx on public.tamanhos(produto_id);

create table if not exists public.complementos (
  id        uuid primary key default gen_random_uuid(),
  nome      text    not null,
  categoria text    not null default 'Complementos',
  preco     numeric(10,2) not null default 0 check (preco >= 0),
  ativo     boolean not null default true,
  ordem     int     not null default 0
);

create table if not exists public.sabores (
  id    uuid primary key default gen_random_uuid(),
  nome  text    not null,
  ativo boolean not null default true,
  ordem int     not null default 0
);

create table if not exists public.bairros (
  id   uuid primary key default gen_random_uuid(),
  nome text not null,
  taxa numeric(10,2) not null default 0 check (taxa >= 0)
);

-- Numeração amigável dos pedidos (#001, #002…)
create sequence if not exists public.pedido_numero_seq start 1;

create table if not exists public.pedidos (
  id               uuid primary key default gen_random_uuid(),
  numero           int  not null default nextval('public.pedido_numero_seq'),
  criado_em        timestamptz not null default now(),
  status           text not null default 'novo'
                   check (status in ('novo','preparo','saiu','pronto','entregue','cancelado')),
  cliente_nome     text not null,
  cliente_telefone text not null,
  tipo             text not null check (tipo in ('entrega','retirada')),
  endereco         jsonb,
  pagamento        text not null check (pagamento in ('pix','cartao','dinheiro')),
  troco            numeric(10,2) not null default 0,
  itens            jsonb not null,
  subtotal         numeric(10,2) not null,
  taxa             numeric(10,2) not null,
  total            numeric(10,2) not null,
  observacao       text not null default '',
  historico        jsonb not null default '[]'::jsonb,
  impresso         boolean not null default false
);
create index if not exists pedidos_criado_idx on public.pedidos(criado_em desc);
create index if not exists pedidos_status_idx on public.pedidos(status);


-- ---------------------------------------------------------
--  2. SEGURANÇA (RLS)
--
--  Regra geral:
--    • Cardápio  → qualquer visitante LÊ, só o lojista ESCREVE.
--    • Pedidos   → visitante NÃO lê nada; cria só pela função
--                  criar_pedido(). Só o lojista lê e atualiza.
--
--  Isso é o que impede alguém de baixar a lista de telefones
--  e endereços dos seus clientes com a chave pública.
-- ---------------------------------------------------------

alter table public.config       enable row level security;
alter table public.produtos     enable row level security;
alter table public.tamanhos     enable row level security;
alter table public.complementos enable row level security;
alter table public.sabores      enable row level security;
alter table public.bairros      enable row level security;
alter table public.pedidos      enable row level security;

-- Leitura pública do cardápio
do $$
declare t text;
begin
  foreach t in array array['config','produtos','tamanhos','complementos','sabores','bairros']
  loop
    execute format('drop policy if exists "leitura publica" on public.%I', t);
    execute format(
      'create policy "leitura publica" on public.%I for select to anon, authenticated using (true)', t);

    execute format('drop policy if exists "lojista escreve" on public.%I', t);
    execute format(
      'create policy "lojista escreve" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Pedidos: nada para o visitante. Tudo para o lojista logado.
drop policy if exists "lojista gerencia pedidos" on public.pedidos;
create policy "lojista gerencia pedidos" on public.pedidos
  for all to authenticated using (true) with check (true);


-- ---------------------------------------------------------
--  3. CRIAÇÃO DE PEDIDO
--
--  O visitante não escreve direto na tabela: chama esta função.
--  Ela RECALCULA todos os preços a partir do banco, ignorando
--  os valores que vieram do navegador — assim ninguém fecha um
--  pedido de R$ 0,00 mexendo no código da página.
-- ---------------------------------------------------------

create or replace function public.criar_pedido(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg            public.config%rowtype;
  item           jsonb;
  tam            public.tamanhos%rowtype;
  prod           public.produtos%rowtype;
  comp_ids       uuid[];
  extras         numeric(10,2);
  preco_item     numeric(10,2);
  qtd            int;
  nomes_comp     text[];
  itens_final    jsonb := '[]'::jsonb;
  v_subtotal     numeric(10,2) := 0;
  v_taxa         numeric(10,2);   -- fica nulo até ser resolvido abaixo
  v_tipo         text;
  v_bairro_id    uuid;
  novo           public.pedidos%rowtype;
begin
  select * into cfg from public.config where id = 1;
  if not found then
    raise exception 'Configuração da loja não encontrada';
  end if;

  v_tipo := coalesce(payload->>'tipo', 'entrega');
  if v_tipo not in ('entrega','retirada') then
    raise exception 'Tipo de entrega inválido';
  end if;

  if jsonb_array_length(coalesce(payload->'itens','[]'::jsonb)) = 0 then
    raise exception 'O pedido está vazio';
  end if;

  -- ---- itens: preço vem sempre do banco ----
  for item in select * from jsonb_array_elements(payload->'itens')
  loop
    select * into tam from public.tamanhos
      where id = (item->>'tamanho_id')::uuid and ativo = true;
    if not found then
      raise exception 'Tamanho indisponível no cardápio';
    end if;

    select * into prod from public.produtos where id = tam.produto_id and ativo = true;
    if not found then
      raise exception 'Produto indisponível no cardápio';
    end if;

    qtd := greatest(1, least(coalesce((item->>'qtd')::int, 1), 50));

    comp_ids := coalesce(
      (select array_agg(value::text::uuid)
         from jsonb_array_elements_text(coalesce(item->'complementos','[]'::jsonb))),
      '{}'::uuid[]);

    if cfg.max_complementos > 0 and array_length(comp_ids, 1) > cfg.max_complementos then
      raise exception 'Máximo de % complementos por copo', cfg.max_complementos;
    end if;

    select coalesce(sum(preco), 0), coalesce(array_agg(nome order by nome), '{}')
      into extras, nomes_comp
      from public.complementos
     where id = any(comp_ids) and ativo = true;

    preco_item := tam.preco + extras;
    v_subtotal := v_subtotal + preco_item * qtd;

    itens_final := itens_final || jsonb_build_object(
      'produtoNome',  prod.nome,
      'tamanhoNome',  tam.nome,
      'sabor',        coalesce(item->>'sabor',''),
      'complementos', to_jsonb(coalesce(nomes_comp,'{}')),
      'obs',          left(coalesce(item->>'obs',''), 300),
      'preco',        preco_item,
      'qtd',          qtd
    );
  end loop;

  -- ---- taxa de entrega ----
  if v_tipo = 'entrega' then
    v_bairro_id := nullif(payload->>'bairro_id','')::uuid;
    if v_bairro_id is not null then
      select b.taxa into v_taxa from public.bairros b where b.id = v_bairro_id;
    end if;
    -- bairro sem taxa própria (ou não informado) cai na taxa padrão da loja
    v_taxa := coalesce(v_taxa, cfg.taxa_entrega);
  else
    v_taxa := 0;
  end if;

  if cfg.pedido_minimo > 0 and v_subtotal < cfg.pedido_minimo then
    raise exception 'Pedido mínimo de R$ %', cfg.pedido_minimo;
  end if;

  if not (cfg.pagamentos ? (payload->>'pagamento')) or
     (cfg.pagamentos->>(payload->>'pagamento'))::boolean is not true then
    raise exception 'Forma de pagamento indisponível';
  end if;

  insert into public.pedidos (
    cliente_nome, cliente_telefone, tipo, endereco, pagamento, troco,
    itens, subtotal, taxa, total, observacao, historico
  ) values (
    left(trim(coalesce(payload->'cliente'->>'nome','')), 80),
    left(trim(coalesce(payload->'cliente'->>'telefone','')), 20),
    v_tipo,
    case when v_tipo = 'entrega' then payload->'endereco' else null end,
    payload->>'pagamento',
    coalesce((payload->>'troco')::numeric, 0),
    itens_final,
    v_subtotal,
    v_taxa,
    v_subtotal + v_taxa,
    left(coalesce(payload->>'observacao',''), 500),
    jsonb_build_array(jsonb_build_object('status','novo','em', now()))
  )
  returning * into novo;

  if length(novo.cliente_nome) < 2 or length(regexp_replace(novo.cliente_telefone,'\D','','g')) < 10 then
    raise exception 'Nome ou telefone inválido';
  end if;

  return jsonb_build_object(
    'id',       novo.id,
    'numero',   novo.numero,
    'subtotal', novo.subtotal,
    'taxa',     novo.taxa,
    'total',    novo.total,
    'itens',    novo.itens
  );
end $$;

revoke all on function public.criar_pedido(jsonb) from public;
grant execute on function public.criar_pedido(jsonb) to anon, authenticated;


-- ---------------------------------------------------------
--  4. TEMPO REAL
--  Faz o painel receber pedidos novos sem atualizar a página.
-- ---------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'pedidos'
  ) then
    alter publication supabase_realtime add table public.pedidos;
  end if;
end $$;


-- ---------------------------------------------------------
--  5. CARDÁPIO INICIAL (do cardápio impresso da loja)
--  Só insere se as tabelas estiverem vazias.
-- ---------------------------------------------------------

insert into public.config (id, nome_loja, endereco, horario, whatsapp, instagram, tiktok,
                           taxa_entrega, horarios, pagamentos, pix, mensagens)
values (
  1,
  'Açaí Mais Chantilly',
  'Rua Santo Antônio, 127 — Alto da Igreja, Cachoeira Paulista/SP',
  'Todos os dias, das 14h às 23h',
  '5512996835226',
  'acai_mais_chantilly',
  'acaimaischantilly',
  5,
  jsonb_build_object(
    '0', jsonb_build_object('abre','14:00','fecha','23:00','fechado',false),
    '1', jsonb_build_object('abre','14:00','fecha','23:00','fechado',false),
    '2', jsonb_build_object('abre','14:00','fecha','23:00','fechado',false),
    '3', jsonb_build_object('abre','14:00','fecha','23:00','fechado',false),
    '4', jsonb_build_object('abre','14:00','fecha','23:00','fechado',false),
    '5', jsonb_build_object('abre','14:00','fecha','23:00','fechado',false),
    '6', jsonb_build_object('abre','14:00','fecha','23:00','fechado',false)),
  '{"pix":true,"cartao":true,"dinheiro":true}'::jsonb,
  jsonb_build_object(
    'chave','12996835226',
    'tipoChave','Telefone',
    'beneficiario','ACAI MAIS CHANTILLY',
    'cidade','CACHOEIRA PAULISTA'),
  jsonb_build_object(
    'recebido','Oi {nome}! 💜 Recebemos seu pedido *#{numero}* aqui no Açaí Mais Chantilly. Total: *{total}* ({pagamento}). Já estamos separando tudo!',
    'preparo','Oi {nome}! 🍧 Seu pedido *#{numero}* já está sendo montado.',
    'saiu','Boa, {nome}! 🛵 Seu pedido *#{numero}* saiu para entrega e chega em instantes em {endereco}.',
    'pronto','Oi {nome}! ✅ Seu pedido *#{numero}* está pronto para retirada em {enderecoLoja}.',
    'entregue','{nome}, o pedido *#{numero}* foi entregue! 💜 Obrigado pela preferência.',
    'cancelado','Olá {nome}, precisamos cancelar o pedido *#{numero}*. Qualquer dúvida é só chamar por aqui.')
)
on conflict (id) do nothing;

do $$
declare
  id_acai uuid;
  id_cupu uuid;
begin
  if exists (select 1 from public.produtos) then
    return;
  end if;

  insert into public.produtos (nome, descricao, tem_sabor, ordem)
  values ('Açaí', 'Açaí cremoso batido na hora, com todos os complementos inclusos.', true, 1)
  returning id into id_acai;

  insert into public.produtos (nome, descricao, tem_sabor, ordem)
  values ('Cupuaçu', 'Creme de cupuaçu batido na hora, com todos os complementos inclusos.', false, 2)
  returning id into id_cupu;

  insert into public.tamanhos (produto_id, nome, preco, ordem) values
    (id_acai, '300 ml', 13, 1),
    (id_acai, '400 ml', 15, 2),
    (id_acai, '500 ml', 17, 3),
    (id_acai, '1 litro', 28, 4),
    (id_cupu, '300 ml', 15, 1),
    (id_cupu, '400 ml', 17, 2),
    (id_cupu, '500 ml', 19, 3),
    (id_cupu, '1 litro', 30, 4);

  insert into public.sabores (nome, ordem) values
    ('Natural',1),('Banana',2),('Morango',3),('Maracujá',4),
    ('Ovomaltine',5),('Ninho',6),('Morango com Banana',7),('Cupuaçu',8);

  insert into public.complementos (nome, categoria, ordem) values
    ('Leite Condensado','Complementos',1),
    ('Leite em Pó','Complementos',2),
    ('Sucrilhos','Complementos',3),
    ('Granola','Complementos',4),
    ('Jujuba','Complementos',5),
    ('Paçoca','Complementos',6),
    ('Granulado','Complementos',7),
    ('Granulado colorido','Complementos',8),
    ('Amendoim triturado','Complementos',9),
    ('Cereal Boll','Complementos',10),
    ('Cereal de Fruta','Complementos',11),
    ('Calda de Morango','Caldas',12),
    ('Calda de Chocolate','Caldas',13),
    ('Calda de chocolate com avelã','Caldas',14),
    ('Calda de Uva','Caldas',15),
    ('Calda de Amora','Caldas',16),
    ('Calda de Chiclete','Caldas',17),
    ('Calda de Caramelo','Caldas',18),
    ('Calda de Blue Ice','Caldas',19),
    ('Calda de Tuti-frutti','Caldas',20);
end $$;


-- Horário automático e recusa de pedido fora do expediente:
-- rode também supabase/migration-horarios.sql
