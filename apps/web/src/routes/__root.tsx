import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Header } from "../components/layout/header.js";
import { SuggestDialog } from "../components/suggest/suggest-dialog.js";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <Outlet />
      {/* Opened from the header, available on every route. */}
      <SuggestDialog />
    </div>
  );
}
