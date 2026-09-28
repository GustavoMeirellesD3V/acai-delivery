-- =========================================================
--  Gestão de equipe pelo painel
--  Rode DEPOIS de migration-seguranca.sql.
--  Pode rodar de novo sem medo.
--
--  Permite ao admin ver quem tem acesso e trocar o papel
--  de cada pessoa entre atendente, gerente e admin.
-- =========================================================


-- ---------------------------------------------------------
--  1. TRAVA CONTRA FICAR SEM ADMIN
--
--  Sem isto, o último admin consegue se rebaixar sozinho e
--  ninguém mais administra o sistema — e não há como desfazer
--  pelo painel, porque só admin mexe em perfis.
--  A regra fica no banco, não na tela: vale mesmo para quem
--  chamar a API por fora.
-- ---------------------------------------------------------
create or replace function public.proteger_ultimo_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admins_restantes int;
begin
  -- só interessa quando um admin ativo deixa de ser admin ativo
  if TG_OP = 'UPDATE'
     and OLD.papel = 'admin' and OLD.ativo = true
     and (NEW.papel <> 'admin' or NEW.ativo = false)
  then
    select count(*) into admins_restantes
      from public.perfis
     where papel = 'admin' and ativo = true and id <> OLD.id;

    if admins_restantes = 0 then
      raise exception 'ULTIMO_ADMIN';
    end if;
  end if;

  if TG_OP = 'DELETE' and OLD.papel = 'admin' and OLD.ativo = true then
    select count(*) into admins_restantes
      from public.perfis
     where papel = 'admin' and ativo = true and id <> OLD.id;
    if admins_restantes = 0 then
      raise exception 'ULTIMO_ADMIN';
    end if;
  end if;

  return coalesce(NEW, OLD);
end $$;

drop trigger if exists trg_ultimo_admin on public.perfis;
create trigger trg_ultimo_admin
  before update or delete on public.perfis
  for each row execute function public.proteger_ultimo_admin();


-- ---------------------------------------------------------
--  2. AUDITAR MUDANÇA DE PAPEL
--  Promover alguém a admin é das ações mais sensíveis do
--  sistema: precisa ficar registrada como qualquer outra.
-- ---------------------------------------------------------
drop trigger if exists trg_auditoria on public.perfis;
create trigger trg_auditoria
  after insert or update or delete on public.perfis
  for each row execute function public.registrar_auditoria();


-- ---------------------------------------------------------
--  3. LISTAR A EQUIPE
--
--  Devolve só o necessário para a tela: e-mail, papel, estado
--  e data de entrada. Nada de hash de senha, token ou metadado
--  de sessão — esses ficam em auth.users e não saem de lá.
--
--  A checagem de admin acontece DENTRO da função: mesmo que
--  alguém chame por fora, sem passar pelo site, é barrado.
-- ---------------------------------------------------------
create or replace function public.listar_equipe()
returns table (
  id        uuid,
  email     text,
  papel     text,
  ativo     boolean,
  criado_em timestamptz,
  sou_eu    boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.tem_papel(array['admin']) then
    raise exception 'SEM_PERMISSAO';
  end if;

  return query
    select p.id,
           coalesce(p.email, u.email) as email,
           p.papel,
           p.ativo,
           p.criado_em,
           (p.id = auth.uid()) as sou_eu
      from public.perfis p
      left join auth.users u on u.id = p.id
     order by
       case p.papel when 'admin' then 1 when 'gerente' then 2 else 3 end,
       coalesce(p.email, u.email);
end $$;

grant execute on function public.listar_equipe() to authenticated;


-- ---------------------------------------------------------
--  4. TROCAR O PAPEL DE ALGUÉM
--
--  Só admin. O papel novo é validado contra uma lista fechada:
--  não adianta mandar 'superadmin' pela API.
-- ---------------------------------------------------------
create or replace function public.definir_papel(p_id uuid, p_papel text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tem_papel(array['admin']) then
    raise exception 'SEM_PERMISSAO';
  end if;
  if p_papel not in ('admin','gerente','atendente') then
    raise exception 'PAPEL_INVALIDO';
  end if;
  if not exists (select 1 from public.perfis where id = p_id) then
    raise exception 'USUARIO_NAO_ENCONTRADO';
  end if;

  -- a trava do último admin roda na trigger, antes de gravar
  update public.perfis set papel = p_papel where id = p_id;
end $$;

grant execute on function public.definir_papel(uuid, text) to authenticated;


-- ---------------------------------------------------------
--  5. ATIVAR / DESATIVAR ACESSO
--
--  Desativar é melhor que apagar: a pessoa perde o acesso na
--  hora, mas o histórico dela no log de auditoria continua
--  fazendo sentido.
-- ---------------------------------------------------------
create or replace function public.definir_ativo(p_id uuid, p_ativo boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tem_papel(array['admin']) then
    raise exception 'SEM_PERMISSAO';
  end if;
  if not exists (select 1 from public.perfis where id = p_id) then
    raise exception 'USUARIO_NAO_ENCONTRADO';
  end if;

  update public.perfis set ativo = p_ativo where id = p_id;
end $$;

grant execute on function public.definir_ativo(uuid, boolean) to authenticated;


-- ---------------------------------------------------------
--  6. SINCRONIZAR E-MAILS
--
--  Se alguém trocar o e-mail pelo painel do Supabase, a cópia
--  guardada em perfis fica velha. Isto realinha.
-- ---------------------------------------------------------
create or replace function public.sincronizar_equipe()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if not public.tem_papel(array['admin']) then
    raise exception 'SEM_PERMISSAO';
  end if;

  -- quem existe no Auth mas ainda não tem perfil entra como atendente
  insert into public.perfis (id, email, papel)
  select u.id, u.email, 'atendente' from auth.users u
  on conflict (id) do nothing;

  -- realinha os e-mails
  update public.perfis p
     set email = u.email
    from auth.users u
   where u.id = p.id and p.email is distinct from u.email;

  select count(*) into n from public.perfis;
  return n;
end $$;

grant execute on function public.sincronizar_equipe() to authenticated;
