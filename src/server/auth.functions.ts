import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Role = "superuser" | "cs" | "pending" | "denied";

export interface MeResponse {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  created_at: string;
  approved_at: string | null;
}

/**
 * Returns the current user's profile + role.
 * Uses the service-role client on the server so it bypasses transient
 * PostgREST schema-cache failures (PGRST001/002) seen from the browser
 * client right after sign-in. The userId is taken from the verified JWT.
 */
export const getMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MeResponse> => {
    const userId = context.userId;

    // Look up the auth user (for email + metadata fallback).
    const { data: userRes, error: userErr } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userErr || !userRes?.user) {
      throw new Response("User not found", { status: 404 });
    }
    const email = userRes.user.email ?? "";
    const meta = userRes.user.user_metadata ?? {};
    const fallbackName =
      (meta.full_name as string | undefined) ??
      (meta.name as string | undefined) ??
      (email ? email.split("@")[0] : null);

    // Make sure the profile + role rows exist (idempotent — safe even though a trigger also creates them).
    const isBootstrap = email.toLowerCase() === "andreduquec@gmail.com";
    await supabaseAdmin.from("user_profiles").upsert(
      {
        id: userId,
        email,
        display_name: fallbackName,
        approved_at: isBootstrap ? new Date().toISOString() : null,
      },
      { onConflict: "id", ignoreDuplicates: false },
    );
    await supabaseAdmin.from("user_roles").upsert(
      {
        user_id: userId,
        role: isBootstrap ? "superuser" : "pending",
      },
      { onConflict: "user_id", ignoreDuplicates: true },
    );

    const [{ data: profile }, { data: roleRow }] = await Promise.all([
      supabaseAdmin
        .from("user_profiles")
        .select("id,email,display_name,created_at,approved_at")
        .eq("id", userId)
        .maybeSingle(),
      supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    if (!profile) throw new Response("Profile missing", { status: 500 });

    return {
      id: profile.id,
      email: profile.email,
      display_name: profile.display_name ?? fallbackName,
      role: (roleRow?.role as Role | undefined) ?? "pending",
      created_at: profile.created_at,
      approved_at: profile.approved_at,
    };
  });

/**
 * Lets a user update their own display name. Role is NEVER updatable here.
 */
export const updateMyName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => {
    const obj = d as { display_name?: unknown };
    const name = typeof obj.display_name === "string" ? obj.display_name.trim() : "";
    if (name.length < 1 || name.length > 80) throw new Error("Nome inválido");
    return { display_name: name };
  })
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("user_profiles")
      .update({ display_name: data.display_name })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
