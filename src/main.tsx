import React from "react";
import { createRoot } from "react-dom/client";
import { PortalProvider } from "@interchained/portal-react";
import { routes } from "@portal/routes";
import contract from "../app.contract";
import "./index.css";

function NotFound(): React.ReactElement {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-6">
      <p className="font-mono text-sm text-accent-soft">404</p>
      <h1 className="text-3xl font-bold">This handle isn&apos;t claimed yet</h1>
      <a href="/" className="text-accent-soft underline underline-offset-4">
        Claim it on NEDB Links
      </a>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("root element missing");

createRoot(root).render(
  <React.StrictMode>
    <PortalProvider routes={routes} contract={contract} notFound={NotFound} />
  </React.StrictMode>,
);
