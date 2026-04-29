import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/cs")({
  // /cs alone redirects to the Tasks sub-page.
  beforeLoad: () => {
    throw redirect({ to: "/cs/tasks" });
  },
});
