/* =========================================================
   Conexão com o Supabase — Açaí Mais Chantilly
   Supabase → Connect, ou Settings → API Keys / Data API
   ========================================================= */

window.CONFIG = {
  SUPABASE_URL: 'https://wigzwawwjtzppqtitnps.supabase.co',

  // Chave publishable: pública por design, pode ir para o GitHub.
  // Quem protege os dados são as políticas RLS do supabase/schema.sql.
  // NUNCA coloque aqui a chave secret / service_role.
  SUPABASE_ANON_KEY: 'sb_publishable_qfGkrVjd5fMx_k5dGOYhKQ_d0Zachmx'
};
