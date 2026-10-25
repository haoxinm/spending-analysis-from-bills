import * as React from "react";

import { Button } from "@/components/ui/button";

import { testPii } from "../lib/pii";

export interface PiiTryItProps {
  /** The current (possibly unsaved) entries. */
  terms: string[];
}

/** "Try it": paste sample text and see it with the entries removed. Calls the local
 * `/settings/pii-test` endpoint only; nothing is stored or sent anywhere, and the sample and the
 * entries are never put in toasts or logs. */
export function PiiTryIt({ terms }: PiiTryItProps) {
  const [sample, setSample] = React.useState("");
  const [result, setResult] = React.useState<{ redacted_text: string; count: number } | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  // Editing the sample or the entries makes the previous result stale.
  React.useEffect(() => {
    setResult(null);
  }, [sample, terms]);

  const run = async () => {
    setBusy(true);
    setFailed(false);
    try {
      setResult(await testPii(sample, terms));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-input p-3">
      <label className="text-sm font-medium" htmlFor="pii-try-it-sample">
        Try it
      </label>
      <p className="text-xs text-muted-foreground">
        Paste a line of sample text to see what would be removed. This runs on this computer only.
      </p>
      <textarea
        id="pii-try-it-sample"
        value={sample}
        onChange={(e) => setSample(e.target.value)}
        rows={3}
        className="w-full rounded-md border border-input bg-transparent p-2 text-sm"
        placeholder="e.g. ZELLE FROM DOE, JANE 312.555.0100"
      />
      <div>
        <Button size="sm" variant="secondary" onClick={() => void run()} disabled={busy || sample.trim() === ""}>
          Test redaction
        </Button>
      </div>
      {failed ? <p className="text-xs text-destructive">Could not run the test.</p> : null}
      {result ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground" data-testid="pii-try-it-count">
            {result.count} personal-info {result.count === 1 ? "match" : "matches"} removed
          </p>
          <pre data-testid="pii-try-it-result" className="whitespace-pre-wrap rounded bg-muted p-2 text-sm">
            {result.redacted_text}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
