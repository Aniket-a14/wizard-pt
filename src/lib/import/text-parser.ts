/**
 * Deterministic raw-text → structured question parser.
 *
 * Rules: never invent content. Anything that cannot be identified reliably is left empty and
 * added to `flags` so the admin reviews it. Answer keys, reference solutions and hidden tests
 * are never fabricated.
 */

export type Difficulty = "easy" | "medium" | "hard";

export interface ImportFlag {
  field: string;
  message: string;
}

export interface ParsedExample {
  input: string;
  output: string;
  explanation: string;
}

export interface ParsedCoding {
  kind: "coding";
  title: string;
  difficulty: Difficulty | null;
  topic: string;
  tags: string[];
  company: string;
  statement_md: string;
  input_format: string;
  output_format: string;
  constraints_md: string;
  function_signature: string;
  examples: ParsedExample[];
  flags: ImportFlag[];
  raw: string;
}

export interface ParsedMcq {
  kind: "mcq";
  title: string;
  difficulty: Difficulty | null;
  topic: string;
  tags: string[];
  company: string;
  statement_md: string;
  options: string[];
  correct: number[];
  multi: boolean;
  explanation: string;
  flags: ImportFlag[];
  raw: string;
}

export type ParsedQuestion = ParsedCoding | ParsedMcq;

export interface ParseResult {
  questions: ParsedQuestion[];
  warnings: string[];
}

// ------------------------------------------------------------------ helpers

const HEADING_RE = /^\s*(?:problem|question|q|challenge|coding\s+problem|task)\s*#?\s*(\d+)\s*[\.\):\-–—]*\s*(.*)$/i;
const NUM_SPLIT_RE = /^\s*(?:q(?:uestion)?\s*)?(\d{1,3})\s*[\.\)]\s+\S/i;
const OPTION_RE = /^\s*\(?([A-Ha-h])[\.\):]\s+(\S.*)$/;
const ANSWER_RE = /^\s*(?:correct\s+(?:answer|option|choice)s?|answer|ans|key|correct)\s*(?:option)?\s*[:\-=]\s*(.+)$/i;
const MCQ_EXPL_RE = /^\s*(?:explanation|solution|rationale|reason)\s*[:\-]\s*(.*)$/i;
const SIG_RE = /^\s*((?:public|private|protected)?\s*(?:static\s+)?[A-Za-z_][\w<>\[\], ?]*\s+[A-Za-z_$][\w$]*\s*\([^)]*\))\s*\{?\s*;?\s*$/;

function normaliseDifficulty(s: string): Difficulty | null {
  const t = s.trim().toLowerCase();
  if (/^(easy|simple|basic|beginner|l1|level\s*1)$/.test(t)) return "easy";
  if (/^(medium|moderate|intermediate|l2|level\s*2)$/.test(t)) return "medium";
  if (/^(hard|difficult|advanced|l3|level\s*3)$/.test(t)) return "hard";
  return null;
}

function splitTags(topic: string): string[] {
  return topic
    .split(/\s*(?:\+|,|\/|&|;)\s*/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function trimBlock(lines: string[]): string {
  let s = 0;
  let e = lines.length;
  while (s < e && lines[s].trim() === "") s++;
  while (e > s && lines[e - 1].trim() === "") e--;
  return lines.slice(s, e).join("\n");
}

interface HeadingInfo {
  title: string;
  difficulty: Difficulty | null;
  topic: string;
  company: string;
}

function parseHeadingRest(rest: string): HeadingInfo {
  let title = rest.trim();
  let difficulty: Difficulty | null = null;
  let topic = "";
  const company = "";
  // Trailing bracket group: [Easy | Strings + Two Pointers]
  const m = /\s*[\[\(]([^\]\)]*)[\]\)]\s*$/.exec(title);
  if (m) {
    const parts = m[1].split(/\s*[|·•,]\s*/).map((p) => p.trim()).filter(Boolean);
    const rest2: string[] = [];
    for (const p of parts) {
      const d = normaliseDifficulty(p);
      if (d && !difficulty) difficulty = d;
      else rest2.push(p);
    }
    if (difficulty || rest2.length) {
      title = title.slice(0, m.index).trim();
      topic = rest2.join(" | ");
    }
  }
  title = title.replace(/^[\-–—:\s]+/, "").replace(/[\-–—:\s]+$/, "");
  return { title, difficulty, topic, company };
}

// ------------------------------------------------------------------ block splitting

interface Block {
  heading: string | null;
  lines: string[];
}

export function splitBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const headingIdx = lines.map((l, i) => (HEADING_RE.test(l) ? i : -1)).filter((i) => i >= 0);

  const cut = (idx: number[], headingLine: boolean): Block[] => {
    const blocks: Block[] = [];
    for (let k = 0; k < idx.length; k++) {
      const start = idx[k];
      const end = k + 1 < idx.length ? idx[k + 1] : lines.length;
      blocks.push({ heading: headingLine ? lines[start] : null, lines: lines.slice(headingLine ? start + 1 : start, end) });
    }
    return blocks;
  };

  if (headingIdx.length >= 1) {
    const blocks = cut(headingIdx, true);
    const pre = trimBlock(lines.slice(0, headingIdx[0]));
    // Text before the first heading is usually a document title/intro; ignore it silently.
    void pre;
    return blocks;
  }

  const numIdx = lines.map((l, i) => (NUM_SPLIT_RE.test(l) ? i : -1)).filter((i) => i >= 0);
  if (numIdx.length >= 2) {
    const blocks = cut(numIdx, false);
    const withOptions = blocks.filter((b) => b.lines.filter((l) => OPTION_RE.test(l)).length >= 2).length;
    if (withOptions >= Math.ceil(blocks.length / 2)) return blocks;
  }
  return [{ heading: null, lines }];
}

// ------------------------------------------------------------------ MCQ

function hasOptions(lines: string[]): boolean {
  return lines.filter((l) => OPTION_RE.test(l)).length >= 2;
}

function parseMcq(block: Block): ParsedMcq {
  const flags: ImportFlag[] = [];
  const lines = [...block.lines];
  let info: HeadingInfo = { title: "", difficulty: null, topic: "", company: "" };
  let firstLine = "";
  if (block.heading) {
    const m = HEADING_RE.exec(block.heading)!;
    firstLine = m[2];
  } else if (lines.length) {
    // numbered style: first line carries the number, e.g. "1. Which data structure…"
    firstLine = lines[0].replace(/^\s*(?:q(?:uestion)?\s*)?\d{1,3}\s*[\.\)]\s*/i, "");
    lines.shift();
  }
  // Optional [Easy | Topic] prefix/suffix on the first line.
  const pre = /^\s*[\[\(]([^\]\)]*)[\]\)]\s*(.*)$/.exec(firstLine);
  if (pre && pre[1].split(/\s*[|·•,]\s*/).some((p) => normaliseDifficulty(p) || p.length > 0) && /[|]|easy|medium|hard/i.test(pre[1])) {
    info = parseHeadingRest(`x [${pre[1]}]`);
    firstLine = pre[2];
  } else {
    const suffix = parseHeadingRest(firstLine);
    if (suffix.difficulty || suffix.topic) {
      info = suffix;
      firstLine = suffix.title;
    }
  }

  const stem: string[] = firstLine.trim() ? [firstLine] : [];
  const options: string[] = [];
  let answerRaw = "";
  let explanation = "";
  let mode: "stem" | "options" | "explanation" = "stem";

  for (const line of lines) {
    const ans = ANSWER_RE.exec(line);
    const expl = MCQ_EXPL_RE.exec(line);
    const opt = OPTION_RE.exec(line);
    if (ans && mode !== "explanation") {
      answerRaw = ans[1].trim();
      mode = "options";
      continue;
    }
    if (expl) {
      mode = "explanation";
      explanation = expl[1];
      continue;
    }
    if (mode === "explanation") {
      explanation += "\n" + line;
      continue;
    }
    if (opt) {
      mode = "options";
      options.push(opt[2].trim());
      continue;
    }
    if (mode === "options" && line.trim() !== "" && options.length > 0 && /^\s+\S/.test(line) && !ANSWER_RE.test(line)) {
      options[options.length - 1] += " " + line.trim(); // wrapped option text
      continue;
    }
    if (mode === "stem") stem.push(line);
    else if (line.trim() !== "") {
      // stray text after options that is not an answer/explanation → keep it visible for review
      explanation += (explanation ? "\n" : "") + line;
      flags.push({ field: "explanation", message: "Unrecognised text after the options was placed in the explanation — please check." });
    }
  }

  const statement = trimBlock(stem);
  const correct: number[] = [];
  if (answerRaw) {
    const toks = answerRaw.split(/[\s,;&]+|\band\b/i).filter(Boolean);
    for (const tk of toks) {
      const m = /^\(?([A-Ha-h])\)?[\.\):]?$/.exec(tk);
      if (m) {
        const idx = m[1].toUpperCase().charCodeAt(0) - 65;
        if (idx < options.length && !correct.includes(idx)) correct.push(idx);
      } else if (toks.indexOf(tk) === 0) {
        // "Answer: Queue" → match option text exactly
        const byText = options.findIndex((o) => o.toLowerCase() === answerRaw.toLowerCase());
        if (byText >= 0) correct.push(byText);
        break;
      }
    }
    if (correct.length === 0) flags.push({ field: "correct", message: `Could not map the answer "${answerRaw}" to an option — set the correct option(s).` });
  } else {
    flags.push({ field: "correct", message: "No answer key found — select the correct option(s) before publishing." });
  }
  if (!statement) flags.push({ field: "statement", message: "Question text is empty." });
  if (options.length < 2) flags.push({ field: "options", message: "Fewer than two options were found." });
  if (!info.difficulty) flags.push({ field: "difficulty", message: "Difficulty not specified — defaulting to Easy; please confirm." });

  const titleSource = statement.split("\n").find((l) => l.trim())?.trim() ?? "Untitled MCQ";
  return {
    kind: "mcq",
    title: titleSource.length > 90 ? titleSource.slice(0, 87) + "…" : titleSource,
    difficulty: info.difficulty,
    topic: info.topic,
    tags: splitTags(info.topic),
    company: info.company,
    statement_md: statement,
    options,
    correct,
    multi: correct.length > 1,
    explanation: trimBlock(explanation.split("\n")),
    flags,
    raw: [block.heading ?? "", ...block.lines].join("\n").trim(),
  };
}

// ------------------------------------------------------------------ coding

function matchLabel(line: string, haveExample: boolean): { key: string; value: string; num?: string } | null {
  const t = line.trim();
  if (t.length === 0 || t.length > 400) return null;
  let m: RegExpExecArray | null;
  if ((m = /^(?:function\s+|method\s+)?signature\s*[:\-]?\s*(.*)$/i.exec(t))) return { key: "signature", value: m[1] };
  if ((m = /^input\s+format\s*[:\-]?\s*(.*)$/i.exec(t))) return { key: "input_format", value: m[1] };
  if ((m = /^output\s+format\s*[:\-]?\s*(.*)$/i.exec(t))) return { key: "output_format", value: m[1] };
  if ((m = /^constraints?\s*[:\-]?\s*(.*)$/i.exec(t))) return { key: "constraints", value: m[1] };
  if ((m = /^company\s*[:\-]\s*(.+)$/i.exec(t))) return { key: "company", value: m[1] };
  if ((m = /^(?:sample\s+|test\s+)?examples?\s*#?\s*(\d+)?\s*[:\-]?\s*$/i.exec(t))) return { key: "example", value: "", num: m[1] };
  if ((m = /^(?:explanation|note|notes|hint)\s*[:\-]\s*(.*)$/i.exec(t))) return { key: "explanation", value: m[1] };
  if ((m = /^(sample\s+)?input\s*#?\s*(\d+)?\s*[:\-]\s*(.*)$/i.exec(t))) return { key: m[1] || haveExample ? "ex_input" : "input", value: m[3], num: m[2] };
  if ((m = /^(sample\s+)?output\s*#?\s*(\d+)?\s*[:\-]\s*(.*)$/i.exec(t))) return { key: m[1] || haveExample ? "ex_output" : "output", value: m[3], num: m[2] };
  return null;
}

function parseCoding(block: Block): ParsedCoding {
  const flags: ImportFlag[] = [];
  let info: HeadingInfo = { title: "", difficulty: null, topic: "", company: "" };
  let lines = [...block.lines];
  if (block.heading) {
    const m = HEADING_RE.exec(block.heading)!;
    info = parseHeadingRest(m[2]);
  } else {
    // No "Problem N" heading: use the first non-empty line as the title when it is short.
    const i = lines.findIndex((l) => l.trim() !== "");
    if (i >= 0 && lines[i].trim().length <= 120 && !matchLabel(lines[i], false)) {
      info = parseHeadingRest(lines[i].replace(/^\s*#+\s*/, ""));
      lines = lines.slice(i + 1);
    }
  }

  const desc: string[] = [];
  const sections: Record<string, string[]> = { signature: [], input_format: [], output_format: [], constraints: [], explanation: [], company: [] };
  const examples: { input: string[]; output: string[]; explanation: string[] }[] = [];
  let cur: { kind: "desc" } | { kind: "sec"; key: string } | { kind: "ex"; field: "input" | "output" | "explanation" } = { kind: "desc" };
  let fence = false;

  const ensureExample = () => {
    if (examples.length === 0) examples.push({ input: [], output: [], explanation: [] });
    return examples[examples.length - 1];
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) fence = !fence;
    const lab = fence ? null : matchLabel(line, examples.length > 0);
    if (lab) {
      switch (lab.key) {
        case "signature":
        case "input_format":
        case "output_format":
        case "constraints":
        case "company":
          cur = { kind: "sec", key: lab.key };
          if (lab.value) sections[lab.key].push(lab.value);
          continue;
        case "example":
          examples.push({ input: [], output: [], explanation: [] });
          cur = { kind: "ex", field: "input" };
          continue;
        case "input":
          cur = { kind: "sec", key: "input_format" };
          if (lab.value) sections.input_format.push(lab.value);
          continue;
        case "output":
          cur = { kind: "sec", key: "output_format" };
          if (lab.value) sections.output_format.push(lab.value);
          continue;
        case "ex_input": {
          const last = examples[examples.length - 1];
          // A second "Input:" with the previous example already complete starts a new example.
          const ex = !last || last.output.length > 0 ? (examples.push({ input: [], output: [], explanation: [] }), examples[examples.length - 1]) : last;
          ex.input = lab.value ? [lab.value] : [];
          cur = { kind: "ex", field: "input" };
          continue;
        }
        case "ex_output": {
          const ex = ensureExample();
          ex.output = lab.value ? [lab.value] : [];
          cur = { kind: "ex", field: "output" };
          continue;
        }
        case "explanation":
          if (examples.length > 0) {
            const ex = examples[examples.length - 1];
            if (lab.value) ex.explanation.push(lab.value);
            cur = { kind: "ex", field: "explanation" };
          } else {
            cur = { kind: "sec", key: "explanation" };
            if (lab.value) sections.explanation.push(lab.value);
          }
          continue;
      }
    }
    if (cur.kind === "desc") desc.push(line);
    else if (cur.kind === "sec") sections[cur.key].push(line);
    else ensureExample()[cur.field].push(line);
  }

  // Function signature: explicit section, else any line that looks like a Java method declaration.
  let signature = trimBlock(sections.signature).split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "";
  signature = signature.replace(/^`+|`+$/g, "");
  if (!signature) {
    for (const l of [...desc, ...sections.input_format]) {
      const m = SIG_RE.exec(l.trim());
      if (m && /\b(public|static)\b/.test(m[1])) {
        signature = m[1].trim();
        break;
      }
    }
  }

  const statement = trimBlock(desc);
  const parsedExamples: ParsedExample[] = examples
    .map((e) => ({ input: trimBlock(e.input), output: trimBlock(e.output), explanation: trimBlock(e.explanation) }))
    .filter((e) => e.input !== "" || e.output !== "");

  if (!info.title) flags.push({ field: "title", message: "Title not found." });
  if (!info.difficulty) flags.push({ field: "difficulty", message: "Difficulty not specified — defaulting to Easy; please confirm." });
  if (!statement) flags.push({ field: "statement", message: "Problem description not found." });
  if (!signature) flags.push({ field: "function_signature", message: "No Java function signature found — add one for function mode, or use full-program mode." });
  if (!trimBlock(sections.constraints)) flags.push({ field: "constraints", message: "No constraints found." });
  if (parsedExamples.length === 0) flags.push({ field: "examples", message: "No examples found — public test cases cannot be derived." });
  if (parsedExamples.some((e) => e.input === "" || e.output === "")) {
    flags.push({ field: "examples", message: "An example is missing its input or output." });
  }
  flags.push({ field: "tests", message: "Hidden test cases are never generated from imports — add and verify them yourself." });

  return {
    kind: "coding",
    title: info.title,
    difficulty: info.difficulty,
    topic: info.topic,
    tags: splitTags(info.topic),
    company: trimBlock(sections.company) || info.company,
    statement_md: statement,
    input_format: trimBlock(sections.input_format),
    output_format: trimBlock(sections.output_format),
    constraints_md: trimBlock(sections.constraints),
    function_signature: signature,
    examples: parsedExamples,
    flags,
    raw: [block.heading ?? "", ...block.lines].join("\n").trim(),
  };
}

// ------------------------------------------------------------------ entry point

/** Remove standalone page numbers that PDF extraction leaves between pages. */
export function stripPageNoise(text: string): string {
  return text
    .split("\n")
    .filter((l) => !/^\s*(?:page\s+)?\d{1,3}(?:\s*(?:of|\/)\s*\d{1,3})?\s*$/i.test(l))
    .join("\n");
}

export function parseQuestions(rawText: string): ParseResult {
  const text = rawText.replace(/\r\n?/g, "\n").replace(/ /g, " ");
  const warnings: string[] = [];
  if (text.trim().length === 0) return { questions: [], warnings: ["Nothing to parse — the text is empty."] };

  const blocks = splitBlocks(text).filter((b) => b.lines.some((l) => l.trim() !== "") || (b.heading && b.heading.trim() !== ""));
  const questions: ParsedQuestion[] = blocks.map((b) => (hasOptions(b.lines) ? parseMcq(b) : parseCoding(b)));
  if (questions.length === 0) warnings.push("No questions could be identified. Check the format or create the question manually.");
  return { questions, warnings };
}
