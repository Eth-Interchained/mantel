/**
 * JSON renderer — the manifest itself, served as an API response.
 *
 * Deliberately trivial: it proves that "renderer" is not a euphemism for
 * "web page". The manifest is the product; this surface just hands it over.
 */

import { defineRenderer } from "../registry";

export const jsonRenderer = defineRenderer({
  id: "json",
  name: "JSON",
  description: "The Identity Manifest as structured JSON — the API surface.",
  consumes: ["exportable"],
  render: (manifest) => ({
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify({ manifest }, null, 2),
  }),
});
