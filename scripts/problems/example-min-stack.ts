import type { SeedProblem } from "../seed/problems";

/**
 * Worked example of a CLASS-DESIGN problem: the student implements a class, and the admin's own driver
 * (the boilerplate) reads a list of operations from stdin and prints the results. Leave `signature` empty
 * and put the driver in `boilerplate`, with the student's region between the STUDENT CODE markers.
 */
const BOILERPLATE = `import java.util.*;

public class Main {
// ==== STUDENT CODE START ====
static class MinStack {
    public MinStack() {
        // initialise your data structure here
    }

    public void push(int x) {
    }

    public void pop() {
    }

    public int top() {
        return 0;
    }

    public int getMin() {
        return 0;
    }
}
// ==== STUDENT CODE END ====

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int q = sc.nextInt();
        MinStack st = new MinStack();
        StringBuilder out = new StringBuilder();
        while (q-- > 0) {
            String op = sc.next();
            switch (op) {
                case "push": st.push(sc.nextInt()); break;
                case "pop": st.pop(); break;
                case "top": out.append(st.top()).append("\\n"); break;
                default: out.append(st.getMin()).append("\\n");
            }
        }
        System.out.print(out);
    }
}
`;

const REFERENCE = `static class MinStack {
    private final Deque<int[]> s = new ArrayDeque<>();

    public MinStack() {}

    public void push(int x) {
        s.push(new int[] { x, s.isEmpty() ? x : Math.min(x, s.peek()[1]) });
    }

    public void pop() {
        s.pop();
    }

    public int top() {
        return s.peek()[0];
    }

    public int getMin() {
        return s.peek()[1];
    }
}`;

const ops = (lines: string[]) => `${lines.length}\n${lines.join("\n")}`;

const problem: SeedProblem = {
  title: "Min Stack (example)",
  difficulty: "medium",
  topic: "Stack + Design",
  marks: 10,
  statement: "Design a stack that supports push, pop, top and retrieving the minimum element, each in constant time.\n\nImplement the `MinStack` class. Operations are applied in order; `top` and `getMin` print their result on their own line.",
  inputFormat: "Line 1: Q, the number of operations\nNext Q lines: push X | pop | top | getMin",
  outputFormat: "One line per top / getMin operation",
  constraints: "1 <= Q <= 10^5\n-2^31 <= X <= 2^31 - 1\npop, top and getMin are only called on a non-empty stack",
  examples: [{ input: ops(["push 2", "push 0", "push 3", "getMin", "pop", "top", "getMin"]), output: "0\n0\n0" }],
  mode: "function",
  signature: "",
  boilerplate: BOILERPLATE,
  compare: "exact",
  reference: REFERENCE,
  publicTests: [{ input: ops(["push 2", "push 0", "push 3", "getMin", "pop", "top", "getMin"]), output: "0\n0\n0" }],
  hiddenTests: [
    { input: ops(["push -1", "push -5", "getMin", "top"]), output: "-5\n-5" },
    { input: ops(["push 5", "getMin", "top"]), output: "5\n5" },
    { input: ops(["push 3", "push 3", "push 1", "getMin", "pop", "getMin", "pop", "getMin"]), output: "1\n3\n3", label: "duplicates of the minimum" },
    { input: ops(["push 2147483647", "push -2147483648", "getMin", "pop", "getMin"]), output: "-2147483648\n2147483647", label: "int limits" },
  ],
};

export default problem;
