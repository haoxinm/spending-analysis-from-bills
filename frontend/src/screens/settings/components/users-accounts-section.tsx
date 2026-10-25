import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingState } from "@/components/primitives/states";
import { useToast } from "@/components/ui/use-toast";

import {
  type Account,
  type AccountUpdate,
  type Issuer,
  type User,
  useAccountsQuery,
  useCreateAccount,
  useCreateUser,
  useDeleteUser,
  useIssuersQuery,
  useUpdateAccount,
  useUpdateUser,
  useUsersQuery,
} from "../lib/hooks";

const ACCOUNT_TYPES = ["credit", "checking", "savings"] as const;

function issuerName(issuers: Issuer[] | undefined, issuerId: number | null): string {
  if (issuerId === null) return "Unassigned";
  return issuers?.find((i) => i.id === issuerId)?.name ?? `#${issuerId}`;
}

function AccountRow({
  account,
  issuers,
}: {
  account: Account;
  issuers: Issuer[] | undefined;
}) {
  const { toast } = useToast();
  const updateAccount = useUpdateAccount();
  // `Account` (the GET response) never carries `mask` (I1b: local-only, like the API key) — only
  // `AccountCreate`/`AccountUpdate` accept it. So the mask field here is write-only, like the API
  // key field: it starts blank and a save only sends a mask when the user typed a new one.
  const [maskInput, setMaskInput] = React.useState("");
  const [accountType, setAccountType] = React.useState(account.account_type);
  const [currency, setCurrency] = React.useState(account.currency);

  const dirty = maskInput !== "" || accountType !== account.account_type || currency !== account.currency;

  const handleSave = () => {
    const body: AccountUpdate = { account_type: accountType, currency };
    if (maskInput) body.mask = maskInput;
    updateAccount.mutate(
      { id: account.id, body },
      {
        onError: (err) => toast({ title: "Could not update account", description: String(err), variant: "destructive" }),
        onSuccess: () => {
          setMaskInput("");
          toast({ title: "Account updated" });
        },
      },
    );
  };

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Issuer</span>
        <Badge variant="outline">{issuerName(issuers, account.issuer_id)}</Badge>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Type</span>
        <select
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          value={accountType}
          onChange={(e) => setAccountType(e.target.value as Account["account_type"])}
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Set mask (last 4)</span>
        <Input
          value={maskInput}
          maxLength={4}
          placeholder="••••"
          className="w-20"
          onChange={(e) => setMaskInput(e.target.value)}
          aria-label={`Set mask for account ${account.id}`}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Currency</span>
        <Input
          value={currency}
          maxLength={3}
          className="w-20"
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          aria-label={`Currency for account ${account.id}`}
        />
      </label>
      <Button size="sm" variant="secondary" disabled={!dirty || updateAccount.isPending} onClick={handleSave}>
        Save
      </Button>
    </div>
  );
}

function NewAccountForm({ userId, issuers }: { userId: number; issuers: Issuer[] | undefined }) {
  const { toast } = useToast();
  const createAccount = useCreateAccount();
  const [accountType, setAccountType] = React.useState<Account["account_type"]>("credit");
  const [mask, setMask] = React.useState("");
  const [currency, setCurrency] = React.useState("USD");
  const [issuerId, setIssuerId] = React.useState<string>("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createAccount.mutate(
      {
        user_id: userId,
        account_type: accountType,
        mask,
        currency,
        issuer_id: issuerId ? Number(issuerId) : null,
      },
      {
        onError: (err) => toast({ title: "Could not add account", description: String(err), variant: "destructive" }),
        onSuccess: () => {
          setMask("");
          toast({ title: "Account added" });
        },
      },
    );
  };

  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={handleSubmit}>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Type</span>
        <select
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          value={accountType}
          onChange={(e) => setAccountType(e.target.value as Account["account_type"])}
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Issuer</span>
        <select
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          value={issuerId}
          onChange={(e) => setIssuerId(e.target.value)}
        >
          <option value="">Unassigned</option>
          {issuers?.map((issuer) => (
            <option key={issuer.id} value={issuer.id}>
              {issuer.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Mask (last 4)</span>
        <Input
          value={mask}
          maxLength={4}
          className="w-20"
          onChange={(e) => setMask(e.target.value)}
          aria-label="New account mask"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Currency</span>
        <Input
          value={currency}
          maxLength={3}
          className="w-20"
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          aria-label="New account currency"
        />
      </label>
      <Button type="submit" size="sm" disabled={createAccount.isPending}>
        Add account
      </Button>
    </form>
  );
}

function UserCard({ user, accounts, issuers }: { user: User; accounts: Account[]; issuers: Issuer[] | undefined }) {
  const { toast } = useToast();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const [name, setName] = React.useState(user.name);

  const renameDirty = name.trim() !== "" && name !== user.name;

  const handleRename = () => {
    updateUser.mutate(
      { id: user.id, body: { name } },
      {
        onError: (err) => toast({ title: "Could not rename user", description: String(err), variant: "destructive" }),
      },
    );
  };

  const handleSetDefault = () => {
    updateUser.mutate(
      { id: user.id, body: { is_default: true } },
      {
        onError: (err) =>
          toast({ title: "Could not set default user", description: String(err), variant: "destructive" }),
      },
    );
  };

  const handleDelete = () => {
    if (!window.confirm(`Delete ${user.name}? This cannot be undone.`)) return;
    deleteUser.mutate(user.id, {
      onError: (err) => toast({ title: "Could not delete user", description: String(err), variant: "destructive" }),
      onSuccess: () => toast({ title: `${user.name} deleted` }),
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 w-40"
            aria-label={`Name for ${user.name}`}
          />
          {user.is_default ? <Badge>Default</Badge> : null}
        </div>
        <div className="flex items-center gap-2">
          {renameDirty ? (
            <Button size="sm" variant="secondary" onClick={handleRename} disabled={updateUser.isPending}>
              Rename
            </Button>
          ) : null}
          {!user.is_default ? (
            <Button size="sm" variant="outline" onClick={handleSetDefault} disabled={updateUser.isPending}>
              Make default
            </Button>
          ) : null}
          <Button size="sm" variant="destructive" onClick={handleDelete} disabled={deleteUser.isPending}>
            Delete
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No accounts yet.</p>
        ) : (
          accounts.map((account) => <AccountRow key={account.id} account={account} issuers={issuers} />)
        )}
        <NewAccountForm userId={user.id} issuers={issuers} />
      </CardContent>
    </Card>
  );
}

function NewUserForm() {
  const { toast } = useToast();
  const createUser = useCreateUser();
  const [name, setName] = React.useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createUser.mutate(
      { name: name.trim(), is_default: false },
      {
        onError: (err) => toast({ title: "Could not add user", description: String(err), variant: "destructive" }),
        onSuccess: () => {
          setName("");
          toast({ title: "User added" });
        },
      },
    );
  };

  return (
    <form className="flex items-end gap-2" onSubmit={handleSubmit}>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">New user name</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="New user name" />
      </label>
      <Button type="submit" disabled={createUser.isPending || !name.trim()}>
        Add user
      </Button>
    </form>
  );
}

/** Users and accounts CRUD (P3-E section). The account/user assignment itself (D4) happens on
 * the Import screen; this section is where they are created, renamed and corrected afterwards. */
export function UsersAccountsSection() {
  const usersQuery = useUsersQuery();
  const accountsQuery = useAccountsQuery();
  const issuersQuery = useIssuersQuery();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users and accounts</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {usersQuery.isPending ? <LoadingState rows={2} /> : null}
        {usersQuery.isError ? (
          <ErrorState description={String(usersQuery.error)} onRetry={() => void usersQuery.refetch()} />
        ) : null}
        {usersQuery.data && usersQuery.data.length === 0 ? (
          <EmptyState title="No users yet" description="Add the first user to get started." />
        ) : null}
        {usersQuery.data?.map((user) => (
          <UserCard
            key={user.id}
            user={user}
            accounts={accountsQuery.data?.filter((a) => a.user_id === user.id) ?? []}
            issuers={issuersQuery.data}
          />
        ))}
        <NewUserForm />
      </CardContent>
    </Card>
  );
}
