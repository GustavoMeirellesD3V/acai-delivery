-- =========================================================
--  Endurecimento de segurança
--  Rode DEPOIS de schema.sql e migration-horarios.sql.
--  Pode rodar de novo sem medo.
--
--  O que este arquivo adiciona:
--    1. Perfis de acesso (admin / gerente / atendente)
--    2. Log de auditoria das ações administrativas
--    3. Limite de requisições na criação de pedidos
--    4. Validação forte dos dados no servidor
--    5. Políticas RLS reescritas por papel
--
--  Princípio: NEVER TRUST THE CLIENT. Tudo que chega do
--  navegador é tratado como potencialmente manipulado.
-- =========================================================


-- ---------------------------------------------------------
--  1. PERFIS DE ACESSO
--
--  A tabela auth.users é do Supabase e guarda o hash da senha
--  (bcrypt) — nunca a senha em texto. Aqui só guardamos o papel.
-- ---------------------------------------------------------

create table if not exists public.perfis (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  papel      text not null default 'atendente'
             check (papel in ('admin','gerente','atendente')),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

-- Quem já existe vira admin, para ninguém ficar trancado para fora.
insert into public.perfis (id, email, papel)
select u.id, u.email, 'admin' from auth.users u
on conflict (id) do nothing;

-- Usuário novo entra como atendente; o admin promove depois.
create or replace function public.ao_criar_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfis (id, email, papel)
  values (new.id, new.email, 'atendente')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_novo_usuario on auth.users;
create trigger trg_novo_usuario
  after insert on auth.users
  for each row execute function public.ao_criar_usuario();


-- O papel de quem está chamando agora.
-- STABLE + security definer: lê perfis sem passar pelo RLS,
-- evitando recursão infinita nas próprias políticas.
create or replace function public.meu_papel()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select papel from public.perfis
   where id = auth.uid() and ativo = true
$$;

create or replace function public.tem_papel(papeis text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.meu_papel() = any(papeis), false)
$$;

grant execute on function public.meu_papel() to authenticated;
grant execute on function public.tem_papel(text[]) to authenticated;

alter table public.perfis enable row level security;

drop policy if exists "ve o proprio perfil" on public.perfis;
create policy "ve o proprio perfil" on public.perfis
  for select to authenticated
  using (id = auth.uid() or public.tem_papel(array['admin']));

drop policy if exists "admin gerencia perfis" on public.perfis;
create policy "admin gerencia perfis" on public.perfis
  for all to authenticated
  using (public.tem_papel(array['admin']))
  with check (public.tem_papel(array['admin']));


-- ---------------------------------------------------------
--  2. LOG DE AUDITORIA
--
--  Registra quem mudou o quê e quando. Nunca grava senha,
--  token ou secret — essas colunas não existem nas tabelas
--  auditadas, e a tabela auth.users não é auditada aqui.
-- ---------------------------------------------------------

create table if not exists public.auditoria (
  id          bigserial primary key,
  em          timestamptz not null default now(),
  usuario_id  uuid,
  usuario     text,
  papel       text,
  acao        text not null,
  tabela      text not null,
  registro_id text,
  antes       jsonb,
  depois      jsonb
);
create index if not exists auditoria_em_idx on public.auditoria(em desc);

alter table public.auditoria enable row level security;

-- Só leitura, e só para admin/gerente. Ninguém escreve direto:
-- quem grava é a trigger, que roda como security definer.
drop policy if exists "leitura do log" on public.auditoria;
create policy "leitura do log" on public.auditoria
  for select to authenticated
  using (public.tem_papel(array['admin','gerente']));

create or replace function public.registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes  jsonb;
  v_depois jsonb;
  v_id     text;
begin
  if TG_OP = 'DELETE' then
    v_antes := to_jsonb(OLD);
    v_id    := coalesce((to_jsonb(OLD)->>'id'), '');
  elsif TG_OP = 'INSERT' then
    v_depois := to_jsonb(NEW);
    v_id     := coalesce((to_jsonb(NEW)->>'id'), '');
  else
    v_antes  := to_jsonb(OLD);
    v_depois := to_jsonb(NEW);
    v_id     := coalesce((to_jsonb(NEW)->>'id'), '');
    -- nada mudou de fato: não polui o log
    if v_antes = v_depois then return NEW; end if;
  end if;

  insert into public.auditoria (usuario_id, usuario, papel, acao, tabela, registro_id, antes, depois)
  values (
    auth.uid(),
    coalesce((select email from public.perfis where id = auth.uid()), 'anônimo'),
    public.meu_papel(),
    TG_OP, TG_TABLE_NAME, v_id, v_antes, v_depois
  );

  return coalesce(NEW, OLD);
end $$;

do $$
declare t text;
begin
  foreach t in array array['produtos','tamanhos','complementos','sabores','bairros','config','pedidos']
  loop
    execute format('drop trigger if exists trg_auditoria on public.%I', t);
    execute format(
      'create trigger trg_auditoria after insert or update or delete on public.%I
       for each row execute function public.registrar_auditoria()', t);
  end loop;
end $$;


-- ---------------------------------------------------------
--  3. LIMITE DE REQUISIÇÕES (rate limiting)
--
--  Sem isso, um script consegue criar milhares de pedidos.
--  Contamos por IP e por telefone numa janela deslizante.
--  O IP vem do cabeçalho que o Supabase repassa ao Postgres.
-- ---------------------------------------------------------

create table if not exists public.tentativas (
  id    bigserial primary key,
  chave text not null,
  tipo  text not null,
  em    timestamptz not null default now()
);
create index if not exists tentativas_busca_idx on public.tentativas(tipo, chave, em desc);

alter table public.tentativas enable row level security;
-- ninguém lê nem escreve direto; só as funções security definer

create or replace function public.ip_do_cliente()
returns text
language plpgsql
stable
as $$
declare cab text;
begin
  begin
    cab := current_setting('request.headers', true)::json->>'x-forwarded-for';
  exception when others then
    cab := null;
  end;
  -- x-forwarded-for pode vir "cliente, proxy1, proxy2"
  return coalesce(split_part(cab, ',', 1), 'desconhecido');
end $$;

/* Conta tentativas na janela e grava a atual.
   Devolve false quando estourou o limite. */
create or replace function public.dentro_do_limite(
  p_tipo text, p_chave text, p_max int, p_janela interval)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if p_chave is null or p_chave = '' then return true; end if;

  delete from public.tentativas where em < now() - interval '1 day';

  select count(*) into n from public.tentativas
   where tipo = p_tipo and chave = p_chave and em > now() - p_janela;

  if n >= p_max then return false; end if;

  insert into public.tentativas (tipo, chave) values (p_tipo, p_chave);
  return true;
end $$;


-- ---------------------------------------------------------
--  4. VALIDAÇÃO DOS DADOS DO PEDIDO
--
--  Toda validação acontece aqui, no servidor. O que o
--  navegador valida é só conforto para o cliente.
-- ---------------------------------------------------------

create or replace function public.limpar_texto(txt text, tamanho int)
returns text
language sql
immutable
as $$
  -- tira caracteres de controle e corta no tamanho máximo
  select left(btrim(regexp_replace(coalesce(txt, ''), '[\x00-\x1F\x7F]', ' ', 'g')), tamanho)
$$;


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
  v_pag          text;
  v_bairro_id    uuid;
  v_nome         text;
  v_fone         text;
  v_fone_digitos text;
  v_end          jsonb;
  v_ip           text;
  n_itens        int;
  novo           public.pedidos%rowtype;
begin
  select * into cfg from public.config where id = 1;
  if not found then
    raise exception 'Configuração da loja não encontrada';
  end if;

  -- ---- limite de requisições ----
  v_ip := public.ip_do_cliente();
  if not public.dentro_do_limite('pedido_ip', v_ip, 12, interval '10 minutes') then
    raise exception 'MUITOS_PEDIDOS';
  end if;

  -- ---- loja aberta? ----
  if not public.loja_aberta() and not cfg.aceita_fora_horario then
    raise exception 'LOJA_FECHADA';
  end if;

  -- ---- dados do cliente ----
  v_nome := public.limpar_texto(payload->'cliente'->>'nome', 80);
  v_fone := public.limpar_texto(payload->'cliente'->>'telefone', 20);
  v_fone_digitos := regexp_replace(v_fone, '\D', '', 'g');

  if length(v_nome) < 2 then
    raise exception 'DADOS_INVALIDOS: informe seu nome';
  end if;
  if length(v_fone_digitos) < 10 or length(v_fone_digitos) > 13 then
    raise exception 'DADOS_INVALIDOS: telefone precisa ter DDD e número válidos';
  end if;

  -- limite por telefone: evita um mesmo número inundando a loja
  if not public.dentro_do_limite('pedido_fone', v_fone_digitos, 6, interval '30 minutes') then
    raise exception 'MUITOS_PEDIDOS';
  end if;

  -- ---- entrega ou retirada ----
  v_tipo := coalesce(payload->>'tipo', 'entrega');
  if v_tipo not in ('entrega','retirada') then
    raise exception 'DADOS_INVALIDOS: tipo de entrega';
  end if;

  if v_tipo = 'entrega' then
    v_end := jsonb_build_object(
      'rua',         public.limpar_texto(payload->'endereco'->>'rua', 120),
      'numero',      public.limpar_texto(payload->'endereco'->>'numero', 12),
      'bairro',      public.limpar_texto(payload->'endereco'->>'bairro', 60),
      'complemento', public.limpar_texto(payload->'endereco'->>'complemento', 60),
      'referencia',  public.limpar_texto(payload->'endereco'->>'referencia', 120)
    );
    if length(v_end->>'rua') < 3 or length(v_end->>'numero') < 1 or length(v_end->>'bairro') < 2 then
      raise exception 'DADOS_INVALIDOS: endereço incompleto';
    end if;
  end if;

  -- ---- forma de pagamento ----
  v_pag := payload->>'pagamento';
  if v_pag is null or v_pag not in ('pix','cartao','dinheiro') then
    raise exception 'DADOS_INVALIDOS: forma de pagamento';
  end if;
  if not (cfg.pagamentos ? v_pag) or (cfg.pagamentos->>v_pag)::boolean is not true then
    raise exception 'DADOS_INVALIDOS: forma de pagamento indisponível';
  end if;

  -- ---- itens ----
  n_itens := jsonb_array_length(coalesce(payload->'itens','[]'::jsonb));
  if n_itens = 0 then
    raise exception 'DADOS_INVALIDOS: o pedido está vazio';
  end if;
  if n_itens > 40 then
    raise exception 'DADOS_INVALIDOS: pedido com itens demais';
  end if;

  for item in select * from jsonb_array_elements(payload->'itens')
  loop
    -- o id precisa ser um uuid de verdade; qualquer outra coisa é recusada
    if (item->>'tamanho_id') !~ '^[0-9a-fA-F-]{36}$' then
      raise exception 'DADOS_INVALIDOS: item do pedido';
    end if;

    -- PREÇO VEM DO BANCO, nunca do navegador
    select * into tam from public.tamanhos
      where id = (item->>'tamanho_id')::uuid and ativo = true;
    if not found then
      raise exception 'INDISPONIVEL: tamanho fora do cardápio';
    end if;

    select * into prod from public.produtos where id = tam.produto_id and ativo = true;
    if not found then
      raise exception 'INDISPONIVEL: produto fora do cardápio';
    end if;

    qtd := greatest(1, least(coalesce((item->>'qtd')::int, 1), 50));

    comp_ids := coalesce(
      (select array_agg(value::text::uuid)
         from jsonb_array_elements_text(coalesce(item->'complementos','[]'::jsonb))
        where value::text ~ '^[0-9a-fA-F-]{36}$'),
      '{}'::uuid[]);

    if cfg.max_complementos > 0 and coalesce(array_length(comp_ids, 1), 0) > cfg.max_complementos then
      raise exception 'DADOS_INVALIDOS: máximo de % complementos por copo', cfg.max_complementos;
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
      -- o sabor precisa existir no cardápio; senão entra vazio
      'sabor',        coalesce((select s.nome from public.sabores s
                                 where s.nome = item->>'sabor' and s.ativo = true), ''),
      'complementos', to_jsonb(coalesce(nomes_comp,'{}')),
      'obs',          public.limpar_texto(item->>'obs', 300),
      'preco',        preco_item,
      'qtd',          qtd
    );
  end loop;

  -- ---- taxa de entrega: também do banco ----
  if v_tipo = 'entrega' then
    v_bairro_id := case when (payload->>'bairro_id') ~ '^[0-9a-fA-F-]{36}$'
                        then (payload->>'bairro_id')::uuid else null end;
    if v_bairro_id is not null then
      select b.taxa into v_taxa from public.bairros b where b.id = v_bairro_id;
    end if;
    v_taxa := coalesce(v_taxa, cfg.taxa_entrega);
  else
    v_taxa := 0;
  end if;

  if cfg.pedido_minimo > 0 and v_subtotal < cfg.pedido_minimo then
    raise exception 'DADOS_INVALIDOS: pedido mínimo de R$ %', cfg.pedido_minimo;
  end if;

  insert into public.pedidos (
    cliente_nome, cliente_telefone, tipo, endereco, pagamento, troco,
    itens, subtotal, taxa, total, observacao, historico
  ) values (
    v_nome, v_fone, v_tipo,
    case when v_tipo = 'entrega' then v_end else null end,
    v_pag,
    least(greatest(coalesce((payload->>'troco')::numeric, 0), 0), 10000),
    itens_final, v_subtotal, v_taxa, v_subtotal + v_taxa,
    public.limpar_texto(payload->>'observacao', 500),
    jsonb_build_array(jsonb_build_object('status','novo','em', now()))
  )
  returning * into novo;

  -- devolve só o necessário para a tela de confirmação:
  -- nada de dados de outros clientes, nada de colunas internas
  return jsonb_build_object(
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
--  5. POLÍTICAS RLS POR PAPEL
--
--  admin     → tudo
--  gerente   → cardápio, preços, horários, pedidos
--  atendente → só pedidos (ver e mudar status)
--
--  O visitante continua só lendo o cardápio.
-- ---------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['config','produtos','tamanhos','complementos','sabores','bairros']
  loop
    execute format('drop policy if exists "leitura publica" on public.%I', t);
    execute format(
      'create policy "leitura publica" on public.%I for select to anon, authenticated using (true)', t);

    execute format('drop policy if exists "lojista escreve" on public.%I', t);
    execute format('drop policy if exists "gerencia cardapio" on public.%I', t);
    execute format(
      'create policy "gerencia cardapio" on public.%I for all to authenticated
         using (public.tem_papel(array[''admin'',''gerente'']))
         with check (public.tem_papel(array[''admin'',''gerente'']))', t);
  end loop;
end $$;

drop policy if exists "lojista gerencia pedidos" on public.pedidos;
drop policy if exists "equipe ve pedidos" on public.pedidos;
create policy "equipe ve pedidos" on public.pedidos
  for select to authenticated
  using (public.tem_papel(array['admin','gerente','atendente']));

drop policy if exists "equipe atualiza pedidos" on public.pedidos;
create policy "equipe atualiza pedidos" on public.pedidos
  for update to authenticated
  using (public.tem_papel(array['admin','gerente','atendente']))
  with check (public.tem_papel(array['admin','gerente','atendente']));

-- excluir pedido é ação destrutiva: só admin e gerente
drop policy if exists "chefia exclui pedidos" on public.pedidos;
create policy "chefia exclui pedidos" on public.pedidos
  for delete to authenticated
  using (public.tem_papel(array['admin','gerente']));


-- ---------------------------------------------------------
--  6. LOG DE ACESSO (login / logout / expiração)
--
--  Chamado pelo site. Nunca recebe nem grava senha ou token:
--  só o que aconteceu, quem e quando.
-- ---------------------------------------------------------
create or replace function public.registrar_acesso(p_acao text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  if p_acao not in ('LOGIN','LOGOUT','SESSAO_EXPIRADA') then return; end if;

  insert into public.auditoria (usuario_id, usuario, papel, acao, tabela, registro_id)
  values (
    auth.uid(),
    coalesce((select email from public.perfis where id = auth.uid()), '?'),
    public.meu_papel(),
    p_acao, 'sessao', auth.uid()::text
  );
end $$;

grant execute on function public.registrar_acesso(text) to authenticated;
