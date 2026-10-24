import { notFound } from "next/navigation";
import { z } from "zod";
import { parseQuizSettings } from "@/lib/mcq/settings";
import { createClient } from "@/lib/supabase/server";
import { loadBuilderData } from "../builder-data";
import { QuizBuilder } from "../quiz-builder";

export const metadata = { title: "Quiz" };

export default async function EditQuiz({ params }: PageProps<"/admin/quizzes/[id]">) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const a = await supabase.from("assessments").select("id, title, description, status, settings, results_released_at, answers_released_at, assessment_questions(question_version_id, ordering, marks, v:question_versions(question_id, title, version)), attempts:assessment_attempts(id, status)").eq("id", id).maybeSingle();
  if (!a.data) notFound();
  const { bank } = await loadBuilderData();
  const selected = [...a.data.assessment_questions].sort((x, y) => x.ordering - y.ordering).map((q) => ({ questionId: q.v!.question_id, title: q.v!.title, version: q.v!.version, marks: Number(q.marks) }));
  return (
    <QuizBuilder
      bank={bank}
      initial={{
        id: a.data.id,
        title: a.data.title,
        description: a.data.description ?? "",
        status: a.data.status as "draft",
        settings: parseQuizSettings(a.data.settings),
        selected,
        attempts: a.data.attempts.filter((t) => t.status === "submitted").length,
        resultsReleased: !!a.data.results_released_at,
        answersReleased: !!a.data.answers_released_at,
      }}
    />
  );
}
