import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import "@testing-library/jest-dom/vitest";

// `globals: false` in vitest.config.ts means React Testing Library's own auto-cleanup
// (which looks for a global `afterEach`) never registers, so it is wired up explicitly here.
afterEach(() => {
  cleanup();
});
