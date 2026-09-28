-- =========================================================
--  Horário de funcionamento automático
--
--  Rode no SQL Editor DEPOIS do schema.sql.
--  Pode rodar de novo sem medo.
--
--  A loja passa a abrir e fechar sozinha pelo horário.
--  O campo "aberta" vira o interruptor de emergência:
--    aberta = true  → segue o horário abaixo
--    aberta = false → fechada agora, independente do horário
-- =========================================================

alter table public.config
  add column if not exists horarios jsonb not null default '{}'::jsonb,
  add column if not exists aceita_fora_horario boolean not null default false;

-- Horário inicial: todos os dias das 14h às 23h.
-- Chaves 0..6 = domingo..sábado.
update public.config
   set horarios = jsonb_build_object(
     '0', jsonb_build_object('abre','14:00','fecha','23:00','fechado',false),
     '1', jsonb_build_object('abre','14:00','fecha','23:00','fechado',false),
     '2', jsonb_build_object('abre','14:00','fecha','23:00','fechado',false),
     '3', jsonb_build_object('abre','14:00','fecha','23:00','fechado',false),
     '4', jsonb_build_object('abre','14:00','fecha','23:00','fechado',false),
     '5', jsonb_build_object('abre','14:00','fecha','23:00','fechado',false),
     '6', jsonb_build_object('abre','14:00','fecha','23:00','fechado',false))
 where id = 1 and (horarios is null or horarios = '{}'::jsonb);


-- ---------------------------------------------------------
--  "14:30" → 870 minutos. Devolve null se o formato não servir.
-- ---------------------------------------------------------
create or replace function public.hhmm_para_minutos(txt text)
returns int
language sql
immutable
as $$
  select case
    when txt ~ '^\d{1,2}:\d{2}$'
     and split_part(txt, ':', 1)::int between 0 and 23
     and split_part(txt, ':', 2)::int between 0 and 59
    then split_part(txt, ':', 1)::int * 60 + split_part(txt, ':', 2)::int
    else null
  end
$$;


-- ---------------------------------------------------------
--  A loja está aberta neste instante?
--  Mesma regra do site, calculada no fuso de São Paulo.
-- ---------------------------------------------------------
create or replace function public.loja_aberta()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cfg        public.config%rowtype;
  agora      timestamp;
  dia        int;
  minutos    int;
  h          jsonb;
  abre       int;
  fecha      int;
begin
  select * into cfg from public.config where id = 1;
  if not found then return true; end if;

  -- interruptor de emergência: fecha na hora
  if cfg.aberta is false then return false; end if;

  -- sem horário configurado: considera aberta
  if cfg.horarios is null or cfg.horarios = '{}'::jsonb then return true; end if;

  agora   := now() at time zone 'America/Sao_Paulo';
  dia     := extract(dow from agora)::int;                       -- 0 = domingo
  minutos := extract(hour from agora)::int * 60 + extract(minute from agora)::int;

  -- turno de hoje
  h := cfg.horarios -> dia::text;
  if h is not null and coalesce((h->>'fechado')::boolean, false) = false then
    abre  := public.hhmm_para_minutos(h->>'abre');
    fecha := public.hhmm_para_minutos(h->>'fecha');
    if abre is not null and fecha is not null then
      if fecha > abre and minutos >= abre and minutos < fecha then return true; end if;
      if fecha < abre and minutos >= abre then return true; end if;  -- vira a madrugada
    end if;
  end if;

  -- turno de ontem que atravessou a meia-noite (ex.: 18:00 → 02:00)
  h := cfg.horarios -> (((dia + 6) % 7))::text;
  if h is not null and coalesce((h->>'fechado')::boolean, false) = false then
    abre  := public.hhmm_para_minutos(h->>'abre');
    fecha := public.hhmm_para_minutos(h->>'fecha');
    if abre is not null and fecha is not null and fecha < abre and minutos < fecha then
      return true;
    end if;
  end if;

  return false;
end $$;

grant execute on function public.loja_aberta() to anon, authenticated;
grant execute on function public.hhmm_para_minutos(text) to anon, authenticated;


-- ---------------------------------------------------------
--  criar_pedido passa a recusar pedido com a loja fechada.
--  Sem isso, a checagem existiria só no navegador — e bastaria
--  abrir o console para furar a fila.
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
  v_taxa         numeric(10,2);
  v_tipo         text;
  v_bairro_id    uuid;
  novo           public.pedidos%rowtype;
begin
  select * into cfg from public.config where id = 1;
  if not found then
    raise exception 'Configuração da loja não encontrada';
  end if;

  -- loja fechada
  if not public.loja_aberta() and not cfg.aceita_fora_horario then
    raise exception 'LOJA_FECHADA';
  end if;

  v_tipo := coalesce(payload->>'tipo', 'entrega');
  if v_tipo not in ('entrega','retirada') then
    raise exception 'Tipo de entrega inválido';
  end if;

  if jsonb_array_length(coalesce(payload->'itens','[]'::jsonb)) = 0 then
    raise exception 'O pedido está vazio';
  end if;

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

  if v_tipo = 'entrega' then
    v_bairro_id := nullif(payload->>'bairro_id','')::uuid;
    if v_bairro_id is not null then
      select b.taxa into v_taxa from public.bairros b where b.id = v_bairro_id;
    end if;
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
