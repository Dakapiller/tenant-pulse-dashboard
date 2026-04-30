## Problema confirmado

Testei o fluxo no preview:

- Já estás autenticado com Google (`andreduquec@gmail.com`, role `superuser` na BD).
- Em qualquer rota (`/`, `/login`) a página fica eternamente em **"A carregar…"**.
- O `AuthContext` nunca passa `loading` para `false`.

A BD e as RLS estão OK (verifiquei: o perfil existe e as policies permitem `auth.uid() = id`). O problema é puramente client-side no `AuthContext`.

## Causa

No `src/contexts/AuthContext.tsx` o `setLoading(false)` está atrás de um `await loadProfile()` dentro do `.then()` do `getSession()`:

```ts
void supabase.auth.getSession().then(async ({ data: { session: s } }) => {
  ...
  if (s?.user) await loadProfile(s.user.id);  // se isto pendura, nunca chega abaixo
  setLoading(false);
});
```

Se a query a `user_profiles` falhar/travar (já vimos um `PGRST001 - Database client error` no console), o gate fica preso. Além disso o `onAuthStateChange` corre em paralelo e também chama `loadProfile`, podendo competir com o flow inicial.

Este é o anti-padrão clássico do Supabase: nunca fazer `await` de queries dentro do callback de auth, nem segurar o `loading` enquanto se carrega o perfil.

## Correção

Reescrever `src/contexts/AuthContext.tsx`:

1. **Separar `loading` (sessão) de `profileLoading` (perfil)**. O `loading` da sessão fecha assim que sabemos se há ou não sessão — não espera pelo perfil.
2. No `.then()` do `getSession()`: definir `session`/`user` e `setLoading(false)` **imediatamente**. Disparar `loadProfile` em paralelo via `setTimeout(..., 0)` (sem `await`).
3. No `onAuthStateChange`: já está a usar `setTimeout` (bom). Manter, mas garantir que não duplica a chamada inicial — usar uma flag para o load do perfil só correr uma vez por user id.
4. Tornar `loadProfile` resiliente: em vez de `setProfile(null)` em erro (que faz o gate cair em "Aguarda aprovação" / loop), manter o profile anterior e só definir `null` na primeira tentativa. Adicionar 1 retry simples com pequeno backoff para o caso `PGRST001`.

Atualizar `src/routes/__root.tsx` no `AuthGate`:

- Renderizar "A carregar perfil…" só durante um curto intervalo; se o perfil não vier ao fim de ~3 s mas o user existe, mostrar uma mensagem com botão "Tentar novamente" / "Sair" (para não ficar eternamente preso se a BD estiver mesmo down).

Não tocar em mais nada (login form, OAuth, admin, RLS, migrations).

## Ficheiros a editar

- `src/contexts/AuthContext.tsx` — restructurar o effect, separar loadings, retry no `loadProfile`.
- `src/routes/__root.tsx` — `AuthGate` com fallback amigável quando o perfil demora/falha.

## Como vais validar

Depois da mudança vou navegar a `/` no preview e confirmar que entras direto na app (já estás logado e és `superuser`).
