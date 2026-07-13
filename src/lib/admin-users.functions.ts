import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

async function assertSuperuser(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Failed to verify role");
  if (!data || data.role !== "superuser") {
    throw new Response("Forbidden", { status: 403 });
  }
}

export interface AdminUserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: "superuser" | "cs" | "pending" | "denied";
  created_at: string;
  approved_at: string | null;
}

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminUserRow[]> => {
    await assertSuperuser(context.userId);
    const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] = await Promise.all([
      supabaseAdmin
        .from("user_profiles")
        .select("id,email,display_name,created_at,approved_at")
        .order("created_at", { ascending: false }),
      supabaseAdmin.from("user_roles").select("user_id,role"),
    ]);
    if (pErr) throw new Error(pErr.message);
    if (rErr) throw new Error(rErr.message);
    const roleMap = new Map<string, AdminUserRow["role"]>();
    (roles ?? []).forEach((r) => roleMap.set(r.user_id as string, r.role as AdminUserRow["role"]));
    return (profiles ?? []).map((p) => ({
      id: p.id as string,
      email: p.email as string,
      display_name: (p.display_name as string | null) ?? null,
      role: roleMap.get(p.id as string) ?? "pending",
      created_at: p.created_at as string,
      approved_at: (p.approved_at as string | null) ?? null,
    }));
  });

export const approveUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperuser(context.userId);
    const { error: rErr } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: data.userId, role: "cs" }, { onConflict: "user_id" });
    if (rErr) throw new Error(rErr.message);
    const { error: pErr } = await supabaseAdmin
      .from("user_profiles")
      .update({ approved_at: new Date().toISOString(), approved_by: context.userId })
      .eq("id", data.userId);
    if (pErr) throw new Error(pErr.message);
    return { ok: true };
  });

export const revokeUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperuser(context.userId);
    const { data: target } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (target?.role === "superuser") throw new Response("Cannot revoke superuser", { status: 400 });
    const { error: rErr } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: data.userId, role: "pending" }, { onConflict: "user_id" });
    if (rErr) throw new Error(rErr.message);
    const { error: pErr } = await supabaseAdmin
      .from("user_profiles")
      .update({ approved_at: null, approved_by: null })
      .eq("id", data.userId);
    if (pErr) throw new Error(pErr.message);
    return { ok: true };
  });

export const rejectUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperuser(context.userId);
    const { data: target } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (target?.role === "superuser") throw new Response("Cannot deny superuser", { status: 400 });
    const { error: rErr } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: data.userId, role: "denied" }, { onConflict: "user_id" });
    if (rErr) throw new Error(rErr.message);
    const { error: pErr } = await supabaseAdmin
      .from("user_profiles")
      .update({ approved_at: null, approved_by: null })
      .eq("id", data.userId);
    if (pErr) throw new Error(pErr.message);
    return { ok: true };
  });
