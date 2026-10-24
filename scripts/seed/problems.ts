/**
 * Seed content. Every problem carries a reference solution and tests; the seed script runs the
 * reference solution against ALL tests in the sandbox before publishing, so the expected outputs
 * are verified rather than assumed.
 */
export interface SeedProblem {
  title: string;
  difficulty: "easy" | "medium" | "hard";
  topic: string;
  company?: string;
  statement: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string;
  examples: { input: string; output: string; explanation?: string }[];
  mode: "function" | "program";
  signature?: string;
  /**
   * Optional full driver for class-design problems (LRU Cache, Min Stack, Trie…): a complete `Main` with the
   * editable region between STUDENT CODE START/END marker lines. Leave `signature` empty when using it.
   * The driver reads the operations from stdin and prints the whole output itself.
   */
  boilerplate?: string;
  compare?: "exact" | "trim" | "tokens" | "float" | "json" | "unordered" | "unordered_deep";
  reference: string;
  /**
   * Optional extra languages. Each needs its own reference solution; the C++ / C wrapper is generated from the
   * same Java `signature` (C only supports a subset of types — see harness-c.ts). `boilerplate` / `starter` override
   * the generated ones (custom drivers).
   */
  languages?: Partial<Record<"cpp" | "c", { reference: string; boilerplate?: string; starter?: string }>>;
  publicTests: { input: string; output: string }[];
  hiddenTests: { input: string; output: string; label?: string }[];
  marks?: number;
  minutes?: number;
}

const big = (n: number, ch: string) => ch.repeat(n);

export const PROBLEMS: SeedProblem[] = [
  {
    title: "Reverse Only the Letters",
    difficulty: "easy",
    topic: "Strings + Two Pointers",
    company: "Accenture",
    marks: 10,
    minutes: 15,
    statement: `An Accenture security team masks product codes before sharing them with a vendor.

Masking reverses the order of the **letters** in the code, while every non-letter stays exactly where it is.

Letters are the ASCII characters \`A–Z\` and \`a–z\`. Digits and symbols are never moved.`,
    inputFormat: "One line containing the code.",
    outputFormat: "The masked code.",
    constraints: "1 ≤ code.length() ≤ 100000\nThe code contains printable ASCII characters only.",
    examples: [
      { input: "AB-12-CD", output: "DC-12-BA" },
      { input: "Ja#va-21", output: "av#aJ-21" },
      { input: "1234", output: "1234", explanation: "There are no letters, so nothing moves." },
      { input: "x-Y", output: "Y-x" },
    ],
    mode: "function",
    signature: "public static String maskCode(String code)",
    reference: `public static String maskCode(String code) {
    char[] chars = code.toCharArray();
    int left = 0;
    int right = chars.length - 1;
    while (left < right) {
        if (!Character.isLetter(chars[left])) {
            left++;
        } else if (!Character.isLetter(chars[right])) {
            right--;
        } else {
            char temp = chars[left];
            chars[left] = chars[right];
            chars[right] = temp;
            left++;
            right--;
        }
    }
    return new String(chars);
}`,
    publicTests: [
      { input: "AB-12-CD", output: "DC-12-BA" },
      { input: "Ja#va-21", output: "av#aJ-21" },
      { input: "1234", output: "1234" },
      { input: "x-Y", output: "Y-x" },
    ],
    hiddenTests: [
      { input: "a", output: "a", label: "single letter" },
      { input: "7", output: "7", label: "single non-letter" },
      { input: "a-b-c-d", output: "d-c-b-a", label: "letters separated by symbols" },
      { input: "!!!###$$$", output: "!!!###$$$", label: "symbols only" },
      { input: "AbCdEf", output: "fEdCbA", label: "mixed case" },
      { input: "a1b2c3d4", output: "d1c2b3a4", label: "alternating letters/digits" },
      { input: `${big(50000, "A")}-${big(49999, "b")}`, output: `${big(49999, "b")}A-${big(49999, "A")}`, label: "long input near the maximum" },
    ],
  },
  {
    title: "Two Sum Indices",
    difficulty: "easy",
    topic: "Arrays + Hashing",
    company: "TCS",
    marks: 10,
    minutes: 15,
    statement: `Given an array of integers \`nums\` and an integer \`target\`, return the **indices** of the two numbers that add up to \`target\`.

Exactly one valid pair exists. Return the smaller index first.`,
    inputFormat: "Line 1: the array elements separated by spaces.\nLine 2: the target.",
    outputFormat: "The two indices, smaller first, separated by a space.",
    constraints: "2 ≤ nums.length ≤ 10000\n−10⁹ ≤ nums[i], target ≤ 10⁹\nExactly one valid pair exists.",
    examples: [
      { input: "2 7 11 15\n9", output: "0 1", explanation: "nums[0] + nums[1] = 2 + 7 = 9." },
      { input: "3 2 4\n6", output: "1 2" },
    ],
    mode: "function",
    signature: "public static int[] twoSum(int[] nums, int target)",
    reference: `public static int[] twoSum(int[] nums, int target) {
    java.util.Map<Integer, Integer> seen = new java.util.HashMap<>();
    for (int i = 0; i < nums.length; i++) {
        Integer j = seen.get(target - nums[i]);
        if (j != null) return new int[] { j, i };
        seen.put(nums[i], i);
    }
    return new int[] { -1, -1 };
}`,
    publicTests: [
      { input: "2 7 11 15\n9", output: "0 1" },
      { input: "3 2 4\n6", output: "1 2" },
    ],
    hiddenTests: [
      { input: "3 3\n6", output: "0 1", label: "duplicates" },
      { input: "-1 -2 -3 -4 -5\n-8", output: "2 4", label: "negatives" },
      { input: "0 4 3 0\n0", output: "0 3", label: "zeros" },
      { input: "1000000000 -1000000000 5\n0", output: "0 1", label: "bounds, overflow-safe" },
      { input: `${Array.from({ length: 9999 }, (_, i) => i + 1).join(" ")} 20000\n${9999 + 20000}`, output: "9998 9999", label: "large input" },
    ],
  },
  {
    title: "Valid Palindrome",
    difficulty: "easy",
    topic: "Strings + Two Pointers",
    company: "Cognizant",
    marks: 10,
    minutes: 15,
    statement: `A phrase is a **palindrome** if, after converting all uppercase letters to lowercase and removing every character that is not a letter or a digit, it reads the same forwards and backwards.

Return \`true\` if the given string is a palindrome, otherwise \`false\`.`,
    inputFormat: "One line containing the string (may contain spaces and punctuation; may be empty).",
    outputFormat: "`true` or `false`.",
    constraints: "0 ≤ s.length() ≤ 200000\ns contains printable ASCII characters.",
    examples: [
      { input: "A man, a plan, a canal: Panama", output: "true" },
      { input: "race a car", output: "false" },
      { input: " ", output: "true", explanation: "After cleaning the string is empty, which reads the same both ways." },
    ],
    mode: "function",
    signature: "public static boolean isPalindrome(String s)",
    reference: `public static boolean isPalindrome(String s) {
    int i = 0, j = s.length() - 1;
    while (i < j) {
        while (i < j && !Character.isLetterOrDigit(s.charAt(i))) i++;
        while (i < j && !Character.isLetterOrDigit(s.charAt(j))) j--;
        if (Character.toLowerCase(s.charAt(i)) != Character.toLowerCase(s.charAt(j))) return false;
        i++;
        j--;
    }
    return true;
}`,
    publicTests: [
      { input: "A man, a plan, a canal: Panama", output: "true" },
      { input: "race a car", output: "false" },
      { input: " ", output: "true" },
    ],
    hiddenTests: [
      { input: "", output: "true", label: "empty string" },
      { input: "0P", output: "false", label: "digit vs letter" },
      { input: ".,", output: "true", label: "only punctuation" },
      { input: "Was it a car or a cat I saw?", output: "true" },
      { input: `${big(90000, "a")}b${big(90000, "a")}`, output: "true", label: "long palindrome" },
      { input: `${big(90000, "a")}bc${big(90000, "a")}`, output: "false", label: "long non-palindrome" },
    ],
  },
  {
    title: "Second Largest Distinct",
    difficulty: "medium",
    topic: "Arrays",
    company: "Capgemini",
    marks: 15,
    minutes: 20,
    statement: `Given an array of integers, return the **second largest distinct** value.

If the array has fewer than two distinct values, return \`-1\`.`,
    inputFormat: "One line: the array elements separated by spaces.",
    outputFormat: "A single integer.",
    constraints: "1 ≤ nums.length ≤ 100000\n−10⁹ ≤ nums[i] ≤ 10⁹",
    examples: [
      { input: "3 1 4 1 5", output: "4" },
      { input: "7 7 7", output: "-1", explanation: "Only one distinct value." },
    ],
    mode: "function",
    signature: "public static int secondLargest(int[] nums)",
    reference: `public static int secondLargest(int[] nums) {
    long first = Long.MIN_VALUE, second = Long.MIN_VALUE;
    for (int n : nums) {
        if (n > first) { second = first; first = n; }
        else if (n < first && n > second) { second = n; }
    }
    return second == Long.MIN_VALUE ? -1 : (int) second;
}`,
    publicTests: [
      { input: "3 1 4 1 5", output: "4" },
      { input: "7 7 7", output: "-1" },
    ],
    hiddenTests: [
      { input: "5", output: "-1", label: "single element" },
      { input: "1 2", output: "1" },
      { input: "-5 -1 -1 -3", output: "-3", label: "negatives with duplicates of max" },
      { input: "2147483647 -2147483648", output: "-2147483648", label: "int extremes" },
      { input: "10 10 9 9 8", output: "9" },
    ],
  },
  {
    title: "Count the Vowels",
    difficulty: "easy",
    topic: "Strings",
    company: "Infosys",
    marks: 5,
    minutes: 10,
    statement: "Return the number of vowels (`a`, `e`, `i`, `o`, `u`, in either case) in the given text.",
    inputFormat: "One line of text (may be empty).",
    outputFormat: "A single integer.",
    constraints: "0 ≤ text.length() ≤ 100000",
    examples: [
      { input: "Hello World", output: "3" },
      { input: "rhythm", output: "0" },
    ],
    mode: "function",
    signature: "public static int countVowels(String text)",
    reference: `public static int countVowels(String text) {
    int count = 0;
    for (char c : text.toCharArray()) {
        if ("aeiouAEIOU".indexOf(c) >= 0) count++;
    }
    return count;
}`,
    publicTests: [
      { input: "Hello World", output: "3" },
      { input: "rhythm", output: "0" },
    ],
    hiddenTests: [
      { input: "", output: "0", label: "empty" },
      { input: "AEIOUaeiou", output: "10" },
      { input: "xyz XYZ 123 !!!", output: "0" },
      { input: big(100000, "u"), output: "100000", label: "maximum length" },
    ],
  },
  {
    title: "Sum of Numbers (full program)",
    difficulty: "easy",
    topic: "Input / Output",
    marks: 5,
    minutes: 10,
    statement: "Read `n` followed by `n` integers and print their sum. This problem uses **full-program mode**: you write the whole `Main` class and read from standard input.",
    inputFormat: "Line 1: n\nLine 2: n integers separated by spaces.",
    outputFormat: "The sum of the n integers.",
    constraints: "1 ≤ n ≤ 100000\n−10⁹ ≤ each integer ≤ 10⁹\nThe sum fits in a 64-bit signed integer.",
    examples: [{ input: "3\n1 2 3", output: "6" }],
    mode: "program",
    reference: `import java.util.*;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long sum = 0;
        for (int i = 0; i < n; i++) sum += sc.nextLong();
        System.out.println(sum);
    }
}`,
    publicTests: [{ input: "3\n1 2 3", output: "6" }],
    hiddenTests: [
      { input: "1\n-5", output: "-5", label: "single negative" },
      { input: "2\n1000000000 1000000000", output: "2000000000", label: "exceeds int range" },
      { input: `5\n${[0, 0, 0, 0, 0].join(" ")}`, output: "0" },
    ],
  },
];

export interface SeedMcq {
  question: string;
  options: string[];
  correct: number[];
  explanation: string;
  topic: string;
  difficulty: "easy" | "medium" | "hard";
  company?: string;
  code?: string;
}

export const MCQS: SeedMcq[] = [
  { question: "Which data structure follows FIFO (First In, First Out)?", options: ["Stack", "Queue", "Tree", "Graph"], correct: [1], explanation: "A queue processes elements in First In, First Out order.", topic: "Data Structures", difficulty: "easy" },
  { question: "What is the time complexity of binary search on a sorted array of n elements?", options: ["O(n)", "O(log n)", "O(n log n)", "O(1)"], correct: [1], explanation: "Each step halves the search space, so it takes about log₂ n steps.", topic: "Algorithms", difficulty: "easy" },
  { question: "Which of the following are linear data structures? (select all that apply)", options: ["Array", "Linked list", "Binary tree", "Queue"], correct: [0, 1, 3], explanation: "Arrays, linked lists and queues store elements in a sequence; a binary tree is hierarchical.", topic: "Data Structures", difficulty: "easy" },
  { question: "What does the following Java code print?", code: "int x = 5;\nint y = x++ + ++x;\nSystem.out.println(y);", options: ["10", "11", "12", "13"], correct: [2], explanation: "x++ yields 5 (x becomes 6); ++x makes x 7 and yields 7. 5 + 7 = 12.", topic: "Java", difficulty: "medium", company: "TCS" },
  { question: "Which keyword prevents a Java class from being subclassed?", options: ["static", "final", "abstract", "private"], correct: [1], explanation: "A `final` class cannot be extended.", topic: "Java", difficulty: "easy" },
  { question: "Which sorting algorithm has the best worst-case time complexity?", options: ["Quick sort", "Bubble sort", "Merge sort", "Insertion sort"], correct: [2], explanation: "Merge sort is O(n log n) in every case; quick sort degrades to O(n²) in the worst case.", topic: "Algorithms", difficulty: "medium", company: "Cognizant" },
  { question: "In SQL, which clause filters groups produced by GROUP BY?", options: ["WHERE", "HAVING", "ORDER BY", "LIMIT"], correct: [1], explanation: "WHERE filters rows before grouping; HAVING filters after grouping.", topic: "SQL", difficulty: "easy" },
  { question: "What is the output of: System.out.println(10 / 4);", options: ["2.5", "2", "3", "Compilation error"], correct: [1], explanation: "Both operands are ints, so integer division truncates to 2.", topic: "Java", difficulty: "easy", company: "Infosys" },
];
