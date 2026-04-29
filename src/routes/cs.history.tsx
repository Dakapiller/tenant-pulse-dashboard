import { createFileRoute } from "@tanstack/react-router";
import { CSPage } from "./cs";
import { CSSubNav } from "@/components/CSSubNav";

export const Route = createFileRoute("/cs/history")({
  component: CSHistoryPage,
});

function CSHistoryPage() {
  return (
    <div>
      <CSSubNav />
      <CSPage initialTab="history" />
    </div>
  );
}
