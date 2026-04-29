import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** ISO date (YYYY-MM-DD) for the Monday of the current week (UTC). */
function currentWeekStart(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

const AUTO_REASON = "Acompanhamento semanal automático";
const AUTO_CTA = "Verificar estado do clube e prevenir churn.";

export const Route = createFileRoute("/api/public/hooks/generate-weekly-tasks")({
  server: {
    handlers: {
      POST: async () => {
        const weekStart = currentWeekStart();

        // Latest cs_tenant_status row per tenant — gives us club_status, health_score, is_priority.
        const { data: statusRows, error: statusErr } = await supabaseAdmin
          .from("cs_tenant_status")
          .select("tenant_name, club_status, health_score, is_priority, recorded_at")
          .order("recorded_at", { ascending: false });
        if (statusErr) {
          return new Response(JSON.stringify({ error: statusErr.message }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }

        type Latest = { club_status: string | null; health_score: number | null; is_priority: boolean | null };
        const latestByTenant = new Map<string, Latest>();
        const healthByTenant = new Map<string, number>();
        for (const r of (statusRows ?? []) as Array<{
          tenant_name: string; club_status: string | null;
          health_score: number | null; is_priority: boolean | null;
        }>) {
          if (!latestByTenant.has(r.tenant_name)) {
            latestByTenant.set(r.tenant_name, {
              club_status: r.club_status,
              health_score: r.health_score,
              is_priority: r.is_priority,
            });
          }
          if (!healthByTenant.has(r.tenant_name) && r.health_score != null) {
            healthByTenant.set(r.tenant_name, Number(r.health_score));
          }
        }

        // Tenants we know about (anyone with snapshots OR a status row).
        const { data: snapTenants } = await supabaseAdmin
          .from("tenant_snapshots")
          .select("tenant_name");
        const allTenants = new Set<string>();
        for (const r of (snapTenants ?? []) as { tenant_name: string }[]) allTenants.add(r.tenant_name);
        for (const n of latestByTenant.keys()) allTenants.add(n);

        // Existing pending auto tasks for this week — to avoid duplicates.
        const { data: existing } = await supabaseAdmin
          .from("cs_tasks")
          .select("tenant_name")
          .eq("week_start", weekStart)
          .eq("status", "pending");
        const haveTask = new Set<string>();
        for (const r of (existing ?? []) as { tenant_name: string }[]) haveTask.add(r.tenant_name);

        const toInsert: Array<{
          tenant_name: string; reason: string; cta: string; priority: number;
          flags: string[]; week_start: string; status: string;
        }> = [];

        for (const tenant of allTenants) {
          const latest = latestByTenant.get(tenant);
          const status = (latest?.club_status ?? "active") as string;
          if (status === "churned" || status === "closed") continue;
          const score = healthByTenant.get(tenant) ?? 100;
          const priority = !!latest?.is_priority;
          const eligible = priority || score < 40;
          if (!eligible) continue;
          if (haveTask.has(tenant)) continue;
          toInsert.push({
            tenant_name: tenant,
            reason: AUTO_REASON,
            cta: AUTO_CTA,
            priority: priority ? 90 : 60,
            flags: priority ? ["priority"] : ["auto_weekly"],
            week_start: weekStart,
            status: "pending",
          });
        }

        if (toInsert.length > 0) {
          const { error: insErr } = await supabaseAdmin.from("cs_tasks").insert(toInsert);
          if (insErr) {
            return new Response(JSON.stringify({ error: insErr.message }), {
              status: 500, headers: { "Content-Type": "application/json" },
            });
          }
        }

        return new Response(JSON.stringify({
          ok: true,
          weekStart,
          created: toInsert.length,
          skipped_existing: allTenants.size - toInsert.length,
        }), { headers: { "Content-Type": "application/json" } });
      },
    },
  },
});
