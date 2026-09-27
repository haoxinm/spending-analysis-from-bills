import * as React from "react";

import { apiClient, type components } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { EmptyState, ErrorState, LoadingState } from "@/components/primitives/states";

import { exportLayoutSpec, useApproveLayoutSpec, useCreateLayoutSpec, useIssuers, useLayoutSpecs, useReviseLayoutSpec } from "./hooks";

type LayoutSpec = components["schemas"]["LayoutSpec"];

function IssuerSelect({
  value,
  onChange,
  issuers,
}: {
  value: string;
  onChange: (v: string) => void;
  issuers: Array<{ id: number; name: string }>;
}) {
  return (
    <select
      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Issuer (optional)"
    >
      <option value="">No issuer (generic)</option>
      {issuers.map((issuer) => (
        <option key={issuer.id} value={String(issuer.id)}>
          {issuer.name}
        </option>
      ))}
    </select>
  );
}

function PasteSpecForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = React.useState("");
  const [specYaml, setSpecYaml] = React.useState("");
  const [issuerId, setIssuerId] = React.useState("");
  const createSpec = useCreateLayoutSpec();
  const issuersQuery = useIssuers();
  const { toast } = useToast();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length === 0 || specYaml.trim().length === 0) return;
    createSpec.mutate(
      { name: name.trim(), spec_yaml: specYaml, issuer_id: issuerId ? Number(issuerId) : null },
      {
        onSuccess: () => {
          toast({ title: "Layout spec pasted — approve it to activate it", variant: "success" });
          onDone();
        },
        onError: (err) => {
          toast({
            title: "Could not save spec",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          });
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <Input placeholder="Spec name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Spec name" />
      <IssuerSelect value={issuerId} onChange={setIssuerId} issuers={issuersQuery.data ?? []} />
      <textarea
        className="min-h-[160px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-sm"
        placeholder="Paste layout spec YAML here…"
        value={specYaml}
        onChange={(e) => setSpecYaml(e.target.value)}
        aria-label="Spec YAML"
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={createSpec.isPending}>
          {createSpec.isPending ? "Saving…" : "Save as v1"}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ReviseSpecForm({ spec, onDone }: { spec: LayoutSpec; onDone: () => void }) {
  const [specYaml, setSpecYaml] = React.useState("");
  const [issuerId, setIssuerId] = React.useState(spec.issuer_id != null ? String(spec.issuer_id) : "");
  const [loadingCurrent, setLoadingCurrent] = React.useState(true);
  const reviseSpec = useReviseLayoutSpec();
  const issuersQuery = useIssuers();
  const { toast } = useToast();

  React.useEffect(() => {
    let cancelled = false;
    setLoadingCurrent(true);
    void apiClient
      .GET("/layout-specs/{spec_id}/export", { params: { path: { spec_id: spec.id } }, parseAs: "text" })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error) setSpecYaml(String(data ?? ""));
        setLoadingCurrent(false);
      })
      .catch(() => {
        if (!cancelled) setLoadingCurrent(false);
      });
    return () => {
      cancelled = true;
    };
  }, [spec.id]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (specYaml.trim().length === 0) return;
    reviseSpec.mutate(
      { id: spec.id, body: { name: spec.name, spec_yaml: specYaml, issuer_id: issuerId ? Number(issuerId) : null } },
      {
        onSuccess: () => {
          toast({ title: `Revised ${spec.name} to v${spec.version + 1}`, variant: "success" });
          onDone();
        },
        onError: (err) => {
          toast({
            title: "Could not revise spec",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          });
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Editing creates <strong>v{spec.version + 1}</strong> — v{spec.version} is never changed (A21).
      </p>
      <IssuerSelect value={issuerId} onChange={setIssuerId} issuers={issuersQuery.data ?? []} />
      <textarea
        className="min-h-[160px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-sm"
        value={loadingCurrent ? "Loading current version…" : specYaml}
        disabled={loadingCurrent}
        onChange={(e) => setSpecYaml(e.target.value)}
        aria-label="Revised spec YAML"
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={reviseSpec.isPending || loadingCurrent}>
          {reviseSpec.isPending ? "Saving…" : `Save as v${spec.version + 1}`}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function SpecRow({ spec, issuerName }: { spec: LayoutSpec; issuerName: string | undefined }) {
  const [revising, setRevising] = React.useState(false);
  const approveSpec = useApproveLayoutSpec();
  const { toast } = useToast();

  function approve() {
    approveSpec.mutate(spec.id, {
      onSuccess: () => toast({ title: `Approved ${spec.name} v${spec.version}`, variant: "success" }),
      onError: (err) => {
        toast({
          title: "Could not approve spec",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      },
    });
  }

  async function exportSpec() {
    try {
      await exportLayoutSpec(spec.id, `${spec.name}-v${spec.version}.yaml`);
    } catch (err) {
      toast({
        title: "Could not export spec",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{spec.name}</span>
            <Badge variant="outline">v{spec.version}</Badge>
            <Badge variant={spec.approved ? "accent" : "secondary"}>
              {spec.approved ? "approved" : "pending approval"}
            </Badge>
            <Badge variant="outline">{spec.source === "pasted" ? "pasted" : "hand-mapped"}</Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            Issuer: {issuerName ?? (spec.issuer_id != null ? `#${spec.issuer_id}` : "generic (no issuer)")}
          </span>
        </div>
        <div className="flex gap-2">
          {!spec.approved ? (
            <Button size="sm" onClick={approve} disabled={approveSpec.isPending}>
              Approve
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => setRevising((r) => !r)}>
            {revising ? "Close" : "Revise"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void exportSpec()}>
            Export
          </Button>
        </div>
      </div>
      {revising ? <ReviseSpecForm spec={spec} onDone={() => setRevising(false)} /> : null}
    </div>
  );
}

export function SpecPanel() {
  const specsQuery = useLayoutSpecs();
  const issuersQuery = useIssuers();
  const [pasting, setPasting] = React.useState(false);

  const issuerNameById = React.useMemo(() => {
    const map = new Map<number, string>();
    for (const issuer of issuersQuery.data ?? []) map.set(issuer.id, issuer.name);
    return map;
  }, [issuersQuery.data]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Extractor specs ({specsQuery.data?.length ?? 0})</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setPasting((p) => !p)}>
          {pasting ? "Close" : "Paste a spec"}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          Which statements used each spec is not shown here: the statement list does not currently
          report the extractor it was parsed with (see this screen&apos;s contract notes).
        </p>
        {pasting ? <PasteSpecForm onDone={() => setPasting(false)} /> : null}
        {specsQuery.isLoading ? <LoadingState rows={3} /> : null}
        {specsQuery.isError ? (
          <ErrorState
            description={specsQuery.error instanceof Error ? specsQuery.error.message : undefined}
            onRetry={() => void specsQuery.refetch()}
          />
        ) : null}
        {specsQuery.data && specsQuery.data.length === 0 ? (
          <EmptyState
            title="No layout specs yet"
            description="Built-in layouts (A–D) need no spec. Paste one above, or hand-map one from the layout mapper."
          />
        ) : null}
        {specsQuery.data && specsQuery.data.length > 0 ? (
          <div>
            {specsQuery.data.map((spec) => (
              <SpecRow key={spec.id} spec={spec} issuerName={spec.issuer_id != null ? issuerNameById.get(spec.issuer_id) : undefined} />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
