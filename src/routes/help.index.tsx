import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/help/")({
  component: () => <Navigate to="/help/score" />,
});
