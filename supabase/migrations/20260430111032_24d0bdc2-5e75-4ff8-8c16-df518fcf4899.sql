CREATE TABLE public.changelog_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  version text NOT NULL UNIQUE,
  released_at date NOT NULL DEFAULT CURRENT_DATE,
  title text NOT NULL,
  summary text,
  entries jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_changelog_released_at ON public.changelog_entries (released_at DESC);

ALTER TABLE public.changelog_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read changelog"
ON public.changelog_entries
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Superuser inserts changelog"
ON public.changelog_entries
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'superuser'::public.app_role));

CREATE POLICY "Superuser updates changelog"
ON public.changelog_entries
FOR UPDATE
USING (public.has_role(auth.uid(), 'superuser'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'superuser'::public.app_role));

CREATE POLICY "Superuser deletes changelog"
ON public.changelog_entries
FOR DELETE
USING (public.has_role(auth.uid(), 'superuser'::public.app_role));

CREATE OR REPLACE FUNCTION public.touch_changelog_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_changelog_updated_at
BEFORE UPDATE ON public.changelog_entries
FOR EACH ROW EXECUTE FUNCTION public.touch_changelog_updated_at();

INSERT INTO public.changelog_entries (version, released_at, title, summary, entries) VALUES
('1.0.0', CURRENT_DATE, 'Lançamento inicial do Tenant Pulse',
 'Primeira versão pública da plataforma de monitorização de saúde de tenants.',
 '[
   {"type":"feature","text":"Dashboard de visão geral com indicadores de GMV, receita, jogos online e taxa transacionada"},
   {"type":"feature","text":"Página de Clubes com filtros por estado, score e prioridade"},
   {"type":"feature","text":"Página Em Risco com clubes que precisam de atenção imediata"},
   {"type":"feature","text":"Gestão de tarefas de Customer Success por semana, com geração automática a partir das variações mensais"},
   {"type":"feature","text":"Health Score automático por clube (0-100) com 4 regras de variação e mínimo dinâmico baseado em outcomes recentes"},
   {"type":"feature","text":"Histórico completo de alterações de score, status de relação e tarefas por tenant"},
   {"type":"feature","text":"Autenticação com aprovação manual: novos utilizadores ficam pendentes até serem autorizados por um superuser"},
   {"type":"feature","text":"Painel de administração de utilizadores (apenas superusers)"},
   {"type":"feature","text":"Centro de Ajuda com explicação detalhada do score e changelog dinâmico"}
 ]'::jsonb);