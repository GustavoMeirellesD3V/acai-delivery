-- =========================================================
--  Caixa: gastos da loja
--  Rode DEPOIS de migration-seguranca.sql.
--  Pode rodar de novo sem medo.
--
--  O faturamento vem da tabela de pedidos; aqui ficam só os
--  gastos lançados à mão. Lucro do mês = faturamento − gastos.
-- =========================================================

create table if not exists public.gastos (
  id          uuid primary key default gen_random_uuid(),
  data        date not null default (now() at time zone 'America/Sao_Paulo')::date,
  descricao   text not null check (length(trim(descricao)) between 1 and 120),
  categoria   text not null default 'Outros',
  valor       numeric(10,2) not null check (valor > 0),
  criado_por  uuid default auth.uid(),
  criado_em   timestamptz not null default now()
);
create index if not exists gastos_data_idx on public.gastos(data desc);

alter table public.gastos enable row level security;

-- Dinheiro da loja: só admin e gerente veem e lançam.
-- Atendente e visitante não leem nada.
drop policy if exists "chefia gerencia gastos" on public.gastos;
create policy "chefia gerencia gastos" on public.gastos
  for all to authenticated
  using (public.tem_papel(array['admin','gerente']))
  with check (public.tem_papel(array['admin','gerente']));

-- Lançar e excluir gasto fica no registro de atividade.
drop trigger if exists trg_auditoria on public.gastos;
create trigger trg_auditoria after insert or update or delete on public.gastos
  for each row execute function public.registrar_auditoria();

-- A API do Supabase guarda a estrutura do banco em cache; sem isto a
-- tabela nova pode demorar a aparecer para o painel.
notify pgrst, 'reload schema';
