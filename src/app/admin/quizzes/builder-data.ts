import { createClient } from "@/lib/supabase/server";

export interface BankQuestion {
  questionId: string;
  seq: number;
  title: string;
  difficulty: string;
  topic: string | null;
  marks: number;
  optionCount: number;
  correctCount: number;
  multi: boolean;
}

/** MCQs available to put in a quiz (current version of each non-archived MCQ). */
export async function loadBuilderData() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("questions")
    .select("id, seq, status, current:question_versions!questions_current_version_fk(id, title, difficulty, topic, marks, mcq_multi, options:mcq_options(id), keys:mcq_correct_options(option_id))")
    .eq("type", "mcq")
    .neq("status", "archived")
    .order("seq", { ascending: false });
  const bank: BankQuestion[] = (data ?? []).filter((q) => q.current).map((q) => ({
    questionId: q.id,
    seq: q.seq,
    title: q.current!.title,
    difficulty: q.current!.difficulty,
    topic: q.current!.topic,
    marks: Number(q.current!.marks),
    optionCount: q.current!.options.length,
    correctCount: q.current!.keys.length,
    multi: q.current!.mcq_multi,
  }));
  return { bank };
}
