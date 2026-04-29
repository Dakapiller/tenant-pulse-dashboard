import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

async function assertSuperuser(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error("Failed to verify role");
  if (!data || data.role !== "superuser") {
    throw new Response("Forbidden", { status: 403 });
  }
}

export const approveUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperuser(context.userId);
    const { error } = await supabaseAdmin
      .from("user_profiles")
      .update({ role: "cs", approved_at: new Date().toISOString(), approved_by: context.userId })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const revokeUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperuser(context.userId);
    // never revoke superuser
    const { data: target } = await supabaseAdmin
      .from("user_profiles")
      .select("role")
      .eq("id", data.userId)
      .maybeSingle();
    if (target?.role === "superuser") throw new Response("Cannot revoke superuser", { status: 400 });
    const { error } = await supabaseAdmin
      .from("user_profiles")
      .update({ role: "pending", approved_at: null, approved_by: null })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const rejectUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperuser(context.userId);
    const { data: target } = await supabaseAdmin
      .from("user_profiles")
      .select("role")
      .eq("id", data.userId)
      .maybeSingle();
    if (target?.role === "superuser") throw new Response("Cannot delete superuser", { status: 400 });
    // delete auth user — cascade will remove user_profiles row
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
