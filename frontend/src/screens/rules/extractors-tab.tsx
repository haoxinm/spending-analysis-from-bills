import { IssuerPanel } from "./issuer-panel";
import { SpecPanel } from "./spec-panel";

/** Extractors tab (P3-F): layout specs (list/approve/revise/paste) plus issuer CRUD (§2f). */
export function ExtractorsTab() {
  return (
    <div className="flex flex-col gap-4">
      <SpecPanel />
      <IssuerPanel />
    </div>
  );
}
