"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { startQuizAttempt } from "@/lib/actions/student-quiz";

export function StartQuiz({ assessmentId, resume }: { assessmentId: string; resume: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="primary"
      size="lg"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await startQuizAttempt(assessmentId);
          if (!r.ok) return void toast.error(r.error);
          router.refresh();
        })
      }
    >
      {pending ? "Starting…" : resume ? "Resume quiz" : "Start quiz"}
    </Button>
  );
}
