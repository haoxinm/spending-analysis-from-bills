import { ErrorState, LoadingState } from "@/components/primitives/states";
import { useToast } from "@/components/ui/use-toast";

import { EgressPreviewSection } from "./components/egress-preview-section";
import { LlmSettingsSection } from "./components/llm-settings-section";
import { PrivacySection } from "./components/privacy-section";
import { UsersAccountsSection } from "./components/users-accounts-section";
import { type LlmSettings, type PrivacySettings, useSettingsQuery, useUpdateSettings } from "./lib/hooks";

/**
 * Settings screen (P3-E): users and accounts CRUD, the LLM provider three-way choice (D2) with
 * its key/model/threshold/batch-size fields, privacy toggles, and the egress preview — "the
 * feature that earns user trust", per the plan.
 */
function SettingsScreen() {
  const { toast } = useToast();
  const settingsQuery = useSettingsQuery();
  const updateSettings = useUpdateSettings();

  if (settingsQuery.isPending) {
    return <LoadingState rows={6} />;
  }
  if (settingsQuery.isError || !settingsQuery.data) {
    return (
      <ErrorState
        title="Could not load settings"
        description={settingsQuery.isError ? String(settingsQuery.error) : undefined}
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  }

  const settings = settingsQuery.data;

  const saveLlm = (llm: LlmSettings) => {
    updateSettings.mutate(
      { ...settings, llm },
      {
        onSuccess: () => toast({ title: "LLM settings saved" }),
        onError: (err) => toast({ title: "Could not save settings", description: String(err), variant: "destructive" }),
      },
    );
  };

  const savePrivacy = (privacy: PrivacySettings) => {
    updateSettings.mutate(
      { ...settings, privacy },
      {
        onSuccess: () => toast({ title: "Privacy settings saved" }),
        onError: (err) => toast({ title: "Could not save settings", description: String(err), variant: "destructive" }),
      },
    );
  };

  return (
    <div className="flex flex-col gap-6 py-2">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Users, accounts, the LLM provider, privacy, and exactly what would be sent to it.
        </p>
      </div>
      <UsersAccountsSection />
      <LlmSettingsSection settings={settings} onSave={saveLlm} saving={updateSettings.isPending} />
      <PrivacySection settings={settings} onSave={savePrivacy} saving={updateSettings.isPending} />
      <EgressPreviewSection settings={settings} />
    </div>
  );
}

export default SettingsScreen;

export const screenMeta = { path: "/settings", title: "Settings" };
