import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import "@fontsource-variable/space-grotesk";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import { NotFound } from "./components/layout/not-found.js";
import { routeTree } from "./routeTree.gen.ts";
import "./styles/globals.css";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultNotFoundComponent: NotFound,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
    {/* The design's toast: a dark pill centered at the bottom of the viewport. */}
    <Toaster
      position="bottom-center"
      duration={2200}
      toastOptions={{
        unstyled: true,
        className:
          "mx-auto w-fit rounded-lg bg-ink px-5.5 py-3 text-center font-sans text-sm font-medium text-white",
      }}
    />
  </StrictMode>,
);
