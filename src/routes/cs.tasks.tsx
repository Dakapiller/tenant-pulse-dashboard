import { createFileRoute } from "@tanstack/react-router";
import { CSPage } from "./cs";
import { CSSubNav } from "@/components/CSSubNav";

export const Route = createFileRoute("/cs/tasks")({
  component: CSTasksPage,
});

function CSTasksPage() {
  return (
    <div>
      <CSSubNav />
      <CSPage initialTab="contacts" />
    </div>
  );
}
