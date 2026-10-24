"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { changePassword, updateDisplayName } from "@/lib/actions/account";

export function AccountSettings({ email, displayName }: { email: string; displayName: string }) {
  const [name, setName] = useState(displayName);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Panel>
        <PanelHeader title="Profile" />
        <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await updateDisplayName(name); if (r.ok) toast.success("Name updated"); else toast.error(r.error); }); }}>
          <Field label="Email"><Input value={email} disabled readOnly /></Field>
          <Field label="Display name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
          <Button type="submit" variant="primary" disabled={pending || !name.trim() || name === displayName}>Save</Button>
        </form>
      </Panel>
      <Panel>
        <PanelHeader title="Change password" />
        <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); if (pw !== pw2) return void toast.error("Passwords don't match"); start(async () => { const r = await changePassword(pw); if (r.ok) { toast.success("Password changed"); setPw(""); setPw2(""); } else toast.error(r.error); }); }}>
          <Field label="New password" hint="At least 8 characters"><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field label="Confirm new password"><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
          <Button type="submit" variant="primary" disabled={pending || pw.length < 8}>Update password</Button>
        </form>
      </Panel>
    </div>
  );
}
