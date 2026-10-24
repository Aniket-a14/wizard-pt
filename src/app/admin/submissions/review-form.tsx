"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { saveReview } from "@/lib/actions/reviews";
import { formatDateTime } from "@/lib/utils";

export interface ReviewInitial {
  status: "reviewed" | "needs_improvement" | "accepted" | "rejected";
  marks: number | null;
  maxMarks: number | null;
  comments: string;
  suggestions: string;
  explanation: string;
  publishedAt: string | null;
}

export function ReviewForm({ target, id, initial, defaultMax, suggestedMarks }: { target: "code" | "quiz"; id: string; initial: ReviewInitial | null; defaultMax: number | null; suggestedMarks: number | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState<ReviewInitial>(initial ?? { status: "reviewed", marks: suggestedMarks, maxMarks: defaultMax, comments: "", suggestions: "", explanation: "", publishedAt: null });
  const set = <K extends keyof ReviewInitial>(k: K, v: ReviewInitial[K]) => setF((c) => ({ ...c, [k]: v }));

  function submit(publish: boolean) {
    start(async () => {
      const r = await saveReview({ target, id, status: f.status, marks: f.marks, maxMarks: f.maxMarks, comments: f.comments, suggestions: f.suggestions, explanation: f.explanation, publish });
      if (!r.ok) return void toast.error(r.error);
      setF((c) => ({ ...c, publishedAt: r.publishedAt }));
      toast.success(publish ? "Feedback published — the student is notified" : "Draft saved (not visible to the student)");
      router.refresh();
    });
  }
  return (
    <Panel>
      <PanelHeader title="Manual review" actions={f.publishedAt ? <span className="text-xs text-success">Published {formatDateTime(f.publishedAt)}</span> : initial ? <span className="text-xs text-warning">Draft — not visible to student</span> : undefined} />
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted">This is your decision, separate from the automatic test result.</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Review status" className="col-span-3 sm:col-span-1"><Select value={f.status} onChange={(e) => set("status", e.target.value as ReviewInitial["status"])}><option value="reviewed">Reviewed</option><option value="accepted">Accepted</option><option value="needs_improvement">Needs improvement</option><option value="rejected">Rejected</option></Select></Field>
          <Field label="Marks"><Input type="number" step="any" min={0} value={f.marks ?? ""} onChange={(e) => set("marks", e.target.value === "" ? null : Number(e.target.value))} /></Field>
          <Field label="Out of"><Input type="number" step="any" min={0} value={f.maxMarks ?? ""} onChange={(e) => set("maxMarks", e.target.value === "" ? null : Number(e.target.value))} /></Field>
        </div>
        <Field label="Feedback"><Textarea rows={4} value={f.comments} onChange={(e) => set("comments", e.target.value)} placeholder="Your two-pointer logic is correct, but …" /></Field>
        <Field label="Suggestions"><Textarea rows={3} value={f.suggestions} onChange={(e) => set("suggestions", e.target.value)} /></Field>
        <Field label="Explanation / model approach"><Textarea rows={3} value={f.explanation} onChange={(e) => set("explanation", e.target.value)} /></Field>
        <div className="flex gap-2">
          <Button onClick={() => submit(false)} disabled={pending}>Save draft</Button>
          <Button variant="primary" onClick={() => submit(true)} disabled={pending}>{f.publishedAt ? "Republish feedback" : "Publish feedback"}</Button>
        </div>
      </div>
    </Panel>
  );
}
