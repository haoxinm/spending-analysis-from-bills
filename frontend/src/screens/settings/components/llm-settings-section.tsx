import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/components/primitives/states";
import { useToast } from "@/components/ui/use-toast";

import { type LlmSettings, type Settings, useClearApiKey, useSetApiKey, useTestLlm } from "../lib/hooks";

const MODES = [
  {
    value: "none" as const,
    label: "No LLM — rules only",
    consequence:
      "Nothing is ever sent anywhere. Unmatched merchants land in Needs Review for you to classify by hand. This is a fully supported mode, not a degraded one.",
  },
  {
    value: "local" as const,
    label: "Local (Ollama / LM Studio)",
    consequence: "Nothing leaves your machine — descriptions go only to the local model you point at below.",
  },
  {
    value: "remote" as const,
    label: "Remote API",
    consequence: "Descriptions are sent to the provider below, over the network, for classification.",
  },
];

function needsApiBase(llm: LlmSettings): boolean {
  return llm.provider === "ollama" || llm.provider === "lm_studio";
}

function needsApiKey(llm: LlmSettings): boolean {
  return llm.mode === "remote";
}

export interface LlmSettingsSectionProps {
  settings: Settings;
  onSave: (llm: LlmSettings) => void;
  saving: boolean;
}

/** LLM provider / model / base URL / key / threshold / batch size, plus D2's three-way mode
 * choice, each labelled with its egress consequence in plain language. The key field is
 * write-only (I7): it is never fetched, never rendered, and the input is cleared on save. */
export function LlmSettingsSection({ settings, onSave, saving }: LlmSettingsSectionProps) {
  const { toast } = useToast();
  const [draft, setDraft] = React.useState<LlmSettings>(settings.llm);
  const [apiKeyInput, setApiKeyInput] = React.useState("");
  const setApiKey = useSetApiKey();
  const clearApiKey = useClearApiKey();
  const testLlm = useTestLlm();

  React.useEffect(() => {
    setDraft(settings.llm);
  }, [settings.llm]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.llm);

  const update = <K extends keyof LlmSettings>(key: K, value: LlmSettings[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveKey = () => {
    if (!draft.provider) {
      toast({ title: "Pick a provider before saving a key", variant: "destructive" });
      return;
    }
    if (!apiKeyInput) return;
    setApiKey.mutate(
      { provider: draft.provider, apiKey: apiKeyInput },
      {
        onSuccess: () => {
          setApiKeyInput("");
          toast({ title: "API key saved to the Keychain" });
        },
        onError: (err) => toast({ title: "Could not save API key", description: String(err), variant: "destructive" }),
      },
    );
  };

  const handleClearKey = () => {
    if (!draft.provider) return;
    clearApiKey.mutate(
      { provider: draft.provider },
      {
        onSuccess: () => toast({ title: "API key removed" }),
        onError: (err) => toast({ title: "Could not remove API key", description: String(err), variant: "destructive" }),
      },
    );
  };

  const handleTest = () => {
    testLlm.mutate(undefined, {
      onSuccess: (result) => {
        toast({
          title: result?.ok ? "LLM round trip succeeded" : "LLM round trip failed",
          description: result?.detail ?? undefined,
          variant: result?.ok ? "success" : "destructive",
        });
      },
      onError: (err) => toast({ title: "Could not test LLM", description: String(err), variant: "destructive" }),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>LLM provider</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2" role="radiogroup" aria-label="LLM mode">
          {MODES.map((mode) => (
            <label
              key={mode.value}
              className="flex cursor-pointer flex-col gap-0.5 rounded-md border border-border p-3 hover:bg-muted/50"
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="llm-mode"
                  value={mode.value}
                  checked={draft.mode === mode.value}
                  onChange={() => update("mode", mode.value)}
                />
                <span className="text-sm font-medium">{mode.label}</span>
              </span>
              <span className="pl-6 text-xs text-muted-foreground">{mode.consequence}</span>
            </label>
          ))}
        </fieldset>

        {draft.mode !== "none" ? (
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Provider</span>
              <Input
                value={draft.provider}
                onChange={(e) => update("provider", e.target.value)}
                placeholder="anthropic, openai, ollama, …"
                className="w-48"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Model</span>
              <Input value={draft.model} onChange={(e) => update("model", e.target.value)} className="w-48" />
            </label>
            {needsApiBase(draft) ? (
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Base URL</span>
                <Input
                  value={draft.api_base}
                  onChange={(e) => update("api_base", e.target.value)}
                  placeholder="http://localhost:11434"
                  className="w-56"
                />
              </label>
            ) : null}
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Batch size</span>
              <Input
                type="number"
                min={1}
                value={draft.batch_size}
                onChange={(e) => update("batch_size", Number(e.target.value))}
                className="w-24"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Timeout (s)</span>
              <Input
                type="number"
                min={1}
                value={draft.timeout_s}
                onChange={(e) => update("timeout_s", Number(e.target.value))}
                className="w-24"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Confidence threshold</span>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={draft.confidence_threshold}
                onChange={(e) => update("confidence_threshold", Number(e.target.value))}
                className="w-24"
              />
            </label>
          </div>
        ) : null}

        {needsApiKey(draft) ? (
          <div className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">API key</span>
              <Badge variant={draft.has_key ? "default" : "secondary"}>
                {draft.has_key ? "Key on file" : "No key on file"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Stored in the macOS Keychain (I7). Write-only: it is never fetched back or shown here.
            </p>
            <div className="flex items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">New key for {draft.provider || "the provider"}</span>
                <Input
                  type="password"
                  autoComplete="off"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  className="w-64"
                  aria-label="New API key"
                />
              </label>
              <Button size="sm" onClick={handleSaveKey} disabled={!apiKeyInput || setApiKey.isPending}>
                Save key
              </Button>
              {draft.has_key ? (
                <Button size="sm" variant="outline" onClick={handleClearKey} disabled={clearApiKey.isPending}>
                  Remove key
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button onClick={() => onSave(draft)} disabled={!dirty || saving}>
            Save LLM settings
          </Button>
          {draft.mode !== "none" ? (
            <Button variant="outline" onClick={handleTest} disabled={testLlm.isPending}>
              {testLlm.isPending ? "Testing…" : "Test connection"}
            </Button>
          ) : null}
        </div>
        {testLlm.isPending ? <LoadingState rows={1} /> : null}
        {testLlm.isError ? <ErrorState description={String(testLlm.error)} /> : null}
      </CardContent>
    </Card>
  );
}
