import { describe, expect, it } from "vitest";
import { parseQuestions, type ParsedCoding, type ParsedMcq } from "./text-parser";

const MASK = `Problem 2 — Reverse Only the Letters [Easy | Strings + Two Pointers]

An Accenture security team masks product codes before sharing them with a vendor.

Masking reverses the order of the LETTERS in the code, while every non-letter stays exactly where it is.

Function signature:

public static String maskCode(String code)

Input format:
One line containing the code.

Output format:
The masked code.

Constraints:
1 ≤ code.length() ≤ 100000

Example 1:
Input: AB-12-CD
Output: DC-12-BA

Example 2:
Input: Ja#va-21
Output: av#aJ-21

Example 3:
Input: 1234
Output: 1234

Example 4:
Input: x-Y
Output: Y-x`;

describe("parseQuestions — coding", () => {
  const { questions } = parseQuestions(MASK);
  const q = questions[0] as ParsedCoding;
  it("finds one coding problem with the metadata", () => {
    expect(questions).toHaveLength(1);
    expect(q.kind).toBe("coding");
    expect(q.title).toBe("Reverse Only the Letters");
    expect(q.difficulty).toBe("easy");
    expect(q.topic).toBe("Strings + Two Pointers");
    expect(q.tags).toEqual(["Strings", "Two Pointers"]);
  });
  it("extracts sections without altering content", () => {
    expect(q.statement_md).toContain("An Accenture security team masks product codes");
    expect(q.statement_md).toContain("Masking reverses the order of the LETTERS");
    expect(q.function_signature).toBe("public static String maskCode(String code)");
    expect(q.input_format).toBe("One line containing the code.");
    expect(q.output_format).toBe("The masked code.");
    expect(q.constraints_md).toBe("1 ≤ code.length() ≤ 100000");
  });
  it("extracts all four examples verbatim", () => {
    expect(q.examples).toEqual([
      { input: "AB-12-CD", output: "DC-12-BA", explanation: "" },
      { input: "Ja#va-21", output: "av#aJ-21", explanation: "" },
      { input: "1234", output: "1234", explanation: "" },
      { input: "x-Y", output: "Y-x", explanation: "" },
    ]);
  });
  it("does not invent company or hidden tests, and says so", () => {
    expect(q.company).toBe("");
    expect(q.flags.some((f) => f.field === "tests")).toBe(true);
    expect(q.flags.some((f) => f.field === "function_signature")).toBe(false);
  });
  it("flags what is missing instead of guessing", () => {
    const r = parseQuestions("Problem 1 - Mystery\nDo something clever.");
    const c = r.questions[0] as ParsedCoding;
    const fields = c.flags.map((f) => f.field);
    expect(fields).toEqual(expect.arrayContaining(["difficulty", "function_signature", "constraints", "examples"]));
    expect(c.examples).toEqual([]);
  });
  it("keeps multi-line inputs and per-example explanations", () => {
    const r = parseQuestions(`Problem 1 - Sum
Add numbers.
Example 1:
Input:
3
1 2 3
Output:
6
Explanation: 1+2+3 = 6`);
    const c = r.questions[0] as ParsedCoding;
    expect(c.examples[0]).toEqual({ input: "3\n1 2 3", output: "6", explanation: "1+2+3 = 6" });
  });
  it("splits several problems", () => {
    const two = MASK + "\n\nProblem 3 — Two Sum [Medium | Arrays]\nFind two numbers.\nExample 1:\nInput: 1 2\nOutput: 3";
    const r = parseQuestions(two);
    expect(r.questions).toHaveLength(2);
    expect((r.questions[1] as ParsedCoding).difficulty).toBe("medium");
  });
});

describe("parseQuestions — MCQ", () => {
  it("parses a single MCQ with answer and explanation", () => {
    const { questions } = parseQuestions(`Question 1: Which data structure follows FIFO?

A. Stack
B. Queue
C. Tree
D. Graph

Correct answer: B

Explanation:
A queue processes elements in First In, First Out order.`);
    const q = questions[0] as ParsedMcq;
    expect(q.kind).toBe("mcq");
    expect(q.statement_md).toBe("Which data structure follows FIFO?");
    expect(q.options).toEqual(["Stack", "Queue", "Tree", "Graph"]);
    expect(q.correct).toEqual([1]);
    expect(q.multi).toBe(false);
    expect(q.explanation).toContain("First In, First Out");
  });

  it("parses numbered lists with multiple answers and missing keys", () => {
    const { questions } = parseQuestions(`1. Which are prime numbers?
a) 2
b) 4
c) 5
d) 9
Answer: A, C

2. Which language runs on the JVM?
A. Java
B. Python
C. Ruby
D. Go`);
    expect(questions).toHaveLength(2);
    const a = questions[0] as ParsedMcq;
    const b = questions[1] as ParsedMcq;
    expect(a.correct).toEqual([0, 2]);
    expect(a.multi).toBe(true);
    expect(b.correct).toEqual([]);
    expect(b.flags.some((f) => f.field === "correct")).toBe(true);
  });

  it("garbage input yields flagged coding draft or nothing, never fabricated keys", () => {
    expect(parseQuestions("   \n  ").questions).toEqual([]);
    const r = parseQuestions("hello there");
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0].kind).toBe("coding");
    expect((r.questions[0] as ParsedCoding).flags.length).toBeGreaterThan(2);
  });
});
