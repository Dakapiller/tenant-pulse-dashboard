import { createFileRoute, Outlet } from "@tanstack/react-router";
import { CSSubNav } from "@/components/CSSubNav";

export const Route = createFileRoute("/cs")({
  component: CSLayout,
});

function CSLayout() {
  return (
    <div>
      <CSSubNav />
      <Outlet />
    </div>
  );
}
