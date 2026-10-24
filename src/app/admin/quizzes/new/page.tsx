import { loadBuilderData } from "../builder-data";
import { QuizBuilder } from "../quiz-builder";

export const metadata = { title: "New quiz" };

export default async function NewQuiz() {
  const { bank } = await loadBuilderData();
  return <QuizBuilder bank={bank} initial={null} />;
}
