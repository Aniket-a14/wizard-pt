"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { addStudent, resetStudentPasswordAction, setStudentActiveAction } from "@/lib/actions/students";

function Credentials({ email, password, onClose }: { email?: string; password: string; onClose: () => void }) {
  return (
    <div className="space-y-2 rounded-md border border-border-strong bg-surface-2 p-3 text-sm" data-testid="new-credentials">
      <p className="font-medium">Share these with the student — the password is shown only now.</p>
      {email && <p>Email: <code className="font-mono">{email}</code></p>}
      <p>Password: <code className="font-mono" data-testid="new-password">{password}</code></p>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => navigator.clipboard?.writeText(email ? `Email: ${email}\nPassword: ${password}` : password).then(() => toast.success("Copied"), () => toast.error("Could not copy"))}>Copy</Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}

export function AddStudent() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [made, setMade] = useState<{ email: string; password: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <Panel>
      <PanelHeader title="Add a student" />
      <form className="grid gap-3 p-4 md:grid-cols-4" onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addStudent({ name, email, password: password || undefined });
          if (!r.ok) return void toast.error(r.error);
          setMade({ email: r.email, password: r.password });
          setName(""); setEmail(""); setPassword("");
          router.refresh();
        });
      }}>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></Field>
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Password (optional)" hint="Leave blank to generate one"><Input value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" /></Field>
        <div className="flex items-start pt-5"><Button type="submit" variant="primary" disabled={pending || !name.trim() || !email.trim()}>Add student</Button></div>
      </form>
      {made && <div className="px-4 pb-4"><Credentials {...made} onClose={() => setMade(null)} /></div>}
    </Panel>
  );
}

export function StudentActions({ id, name, active }: { id: string; name: string; active: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pw, setPw] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <Button size="sm" disabled={pending || !active} onClick={() => {
          if (!confirm(`Set a new password for ${name}? Their current password stops working.`)) return;
          start(async () => { const r = await resetStudentPasswordAction(id); if (r.ok) setPw(r.password); else toast.error(r.error); });
        }}>Reset password</Button>
        <Button size="sm" variant={active ? "ghost" : "secondary"} disabled={pending} onClick={() => {
          if (active && !confirm(`Deactivate ${name}? They are signed out and cannot sign in. Their history is kept and you can reactivate them.`)) return;
          start(async () => { const r = await setStudentActiveAction(id, !active); if (r.ok) { toast.success(active ? "Deactivated" : "Reactivated"); router.refresh(); } else toast.error(r.error); });
        }}>{active ? "Deactivate" : "Reactivate"}</Button>
      </div>
      {pw && <Credentials password={pw} onClose={() => setPw(null)} />}
    </div>
  );
}
