import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/cs")({
  component: CSLayout,
});

function CSLayout() {
  return <Outlet />;
}
