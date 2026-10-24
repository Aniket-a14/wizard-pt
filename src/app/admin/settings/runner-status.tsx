"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";

export function RunnerStatus({ provider }: { provider: string }) {
  const [state, setState] = useState<{ loading: boolean; checks?: Record<string, { ok: boolean; detail: string }>; error?: string }>({ loading: false });
  async function check() {
    setState({ loading: true });
    try {
      const r = await fetch("/api/health", { cache: "no-store" });
      const j = await r.json();
      setState({ loading: false, checks: j.checks, error: r.ok ? undefined : j.error });
    } catch {
      setState({ loading: false, error: "Could not reach the server" });
    }
  }
  return (
    <Panel>
      <PanelHeader title="Code execution" actions={<Button size="sm" onClick={check} disabled={state.loading}>{state.loading ? "Checking…" : "Test connection"}</Button>} />
      <div className="space-y-2 p-4 text-sm">
        <p>Provider: <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">{provider}</code> — student code always runs in an isolated sandbox, never in the web server.</p>
        {state.error && <p className="text-danger">{state.error}</p>}
        {state.checks && Object.entries(state.checks).map(([k, c]) => (<p key={k}><span className={c.ok ? "text-success" : "text-danger"}>{c.ok ? "●" : "●"}</span> <span className="capitalize">{k}</span>: {c.detail}</p>))}
      </div>
    </Panel>
  );
}
