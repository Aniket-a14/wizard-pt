/**
 * C function-mode harness (LeetCode-style C conventions), derived from the same typed Java signature.
 * C has no generics, so only a subset of the type grammar is available; anything else is reported with a
 * clear message and C is simply not offered for that problem.
 *
 *   Java                    C parameter(s)
 *   int long double …       int / long long / double / bool / char / short / signed char / float
 *   String                  char*
 *   int[]                   int* nums, int numsSize         (String[] -> char**, char[] -> char*)
 *   int[][]                 int** grid, int gridSize, int* gridColSize
 *   ListNode TreeNode       struct ListNode* / struct TreeNode*  (provided)
 *
 *   returns int[]           T* f(…, int* returnSize)
 *   returns int[][]         T** f(…, int* returnSize, int** returnColumnSizes)
 *   void (in place)         the first parameter is modified in place
 *
 * Returned arrays and strings may be heap-allocated (malloc) or static; the harness never frees them.
 */
import { EDIT_END, EDIT_START, RESULT_BEGIN, RESULT_END, type FunctionTemplate } from "./harness";
import { WPT_FMT_DOUBLE, WPT_PRAGMAS } from "./harness-shared";
import type { ParsedSignature } from "./signature";
import { paramTypes, returnJType } from "./signature";
import { SignatureError, typeText, type JType, type ScalarName } from "./types";

type Key = "int" | "long" | "double" | "boolean" | "char" | "short" | "byte" | "float";

const KEY: Record<Exclude<ScalarName, "String">, Key> = {
  int: "int", Integer: "int", long: "long", Long: "long", double: "double", Double: "double",
  boolean: "boolean", Boolean: "boolean", char: "char", Character: "char", short: "short", Short: "short",
  byte: "byte", Byte: "byte", float: "float", Float: "float",
};

const SPEC: Record<Key, { type: string; parse: string; put: string; zero: string }> = {
  int: { type: "int", parse: "(int)strtoll(t, 0, 10)", put: 'snprintf(t, 64, "%d", v)', zero: "0" },
  long: { type: "long long", parse: "strtoll(t, 0, 10)", put: 'snprintf(t, 64, "%lld", v)', zero: "0" },
  double: { type: "double", parse: "strtod(t, 0)", put: "wptFmtD(t, v, 0)", zero: "0.0" },
  float: { type: "float", parse: "(float)strtod(t, 0)", put: "wptFmtD(t, (double)v, 1)", zero: "0.0f" },
  boolean: { type: "bool", parse: "(tolower((unsigned char)t[0]) == 't')", put: 'strcpy(t, v ? "true" : "false")', zero: "false" },
  char: { type: "char", parse: "t[0]", put: "t[0] = v; t[1] = 0", zero: "'\\0'" },
  short: { type: "short", parse: "(short)strtol(t, 0, 10)", put: 'snprintf(t, 64, "%d", (int)v)', zero: "0" },
  byte: { type: "signed char", parse: "(signed char)strtol(t, 0, 10)", put: 'snprintf(t, 64, "%d", (int)v)', zero: "0" },
};

type Kind =
  | { k: "scalar"; key: Key }
  | { k: "string" }
  | { k: "arr1"; elem: Key | "String" }
  | { k: "grid"; key: Key }
  | { k: "node"; name: "ListNode" | "TreeNode" }
  | { k: "void" };

const SUPPORTED = "int/long/double/boolean/char/short/byte/float, String, arrays of those (int[], String[], char[]), 2-D arrays of scalars (int[][], char[][]), ListNode and TreeNode";

function classify(t: JType, where: string): Kind {
  if (t.k === "void") return { k: "void" };
  if (t.k === "scalar") return t.name === "String" ? { k: "string" } : { k: "scalar", key: KEY[t.name] };
  if (t.k === "node") return { k: "node", name: t.name };
  if (t.k === "array") {
    const e = t.of;
    if (e.k === "scalar") return { k: "arr1", elem: e.name === "String" ? "String" : KEY[e.name] };
    if (e.k === "array" && e.of.k === "scalar" && e.of.name !== "String") return { k: "grid", key: KEY[e.of.name] };
  }
  throw new SignatureError(`C cannot express ${where} of type ${typeText(t)}. C supports: ${SUPPORTED}.`);
}

const ctype = (key: Key) => SPEC[key].type;

interface Param { name: string; kind: Kind }

function plan(sig: ParsedSignature): { params: Param[]; ret: Kind } {
  const params = paramTypes(sig).map((p) => ({ name: p.name, kind: classify(p.j, `parameter "${p.name}"`) }));
  const ret = classify(returnJType(sig), "the return value");
  const generated = new Set<string>(["returnSize", "returnColumnSizes"]);
  for (const p of params) {
    if (p.kind.k === "arr1" || p.kind.k === "grid") generated.add(`${p.name}Size`);
    if (p.kind.k === "grid") generated.add(`${p.name}ColSize`);
  }
  for (const p of params) {
    if (generated.has(p.name)) throw new SignatureError(`In C, the parameter name "${p.name}" clashes with a generated size parameter. Rename it.`);
  }
  if (ret.k === "void") {
    const first = params[0]?.kind;
    if (!first || !(first.k === "arr1" || first.k === "grid" || first.k === "node")) {
      throw new SignatureError("In C, an in-place (void) method must take an array, 2-D array or node as its first parameter.");
    }
  }
  return { params, ret };
}

/** Why C cannot be offered for this signature, or null when it can. */
export function cUnsupportedReason(sig: ParsedSignature): string | null {
  try {
    plan(sig);
    return null;
  } catch (e) {
    if (e instanceof SignatureError) return e.message;
    throw e;
  }
}

function elemC(k: Kind & { k: "arr1" }): string {
  return k.elem === "String" ? "char*" : ctype(k.elem);
}

function paramDecl(p: Param): string {
  const k = p.kind;
  switch (k.k) {
    case "scalar": return `${ctype(k.key)} ${p.name}`;
    case "string": return `char* ${p.name}`;
    case "arr1": return `${elemC(k)}* ${p.name}, int ${p.name}Size`;
    case "grid": return `${ctype(k.key)}** ${p.name}, int ${p.name}Size, int* ${p.name}ColSize`;
    case "node": return `struct ${k.name}* ${p.name}`;
    case "void": return "";
  }
}

function retDecl(ret: Kind): { type: string; extra: string[] } {
  switch (ret.k) {
    case "void": return { type: "void", extra: [] };
    case "scalar": return { type: ctype(ret.key), extra: [] };
    case "string": return { type: "char*", extra: [] };
    case "arr1": return { type: `${elemC(ret)}*`, extra: ["int* returnSize"] };
    case "grid": return { type: `${ctype(ret.key)}**`, extra: ["int* returnSize", "int** returnColumnSizes"] };
    case "node": return { type: `struct ${ret.name}*`, extra: [] };
  }
}

export function cDeclaration(sig: ParsedSignature): string {
  const { params, ret } = plan(sig);
  const r = retDecl(ret);
  return `${r.type} ${sig.name}(${[...params.map(paramDecl), ...r.extra].join(", ")})`;
}

// ------------------------------------------------------------------------------------------ runtime

const CORE = String.raw`
typedef struct { char* p; size_t n, cap; } WptB;
static void wptCat(WptB* b, const char* s, size_t k) {
    if (b->n + k + 1 > b->cap) { b->cap = (b->n + k + 1) * 2; b->p = (char*)realloc(b->p, b->cap); }
    memcpy(b->p + b->n, s, k); b->n += k; b->p[b->n] = 0;
}
static void wptCs(WptB* b, const char* s) { wptCat(b, s, strlen(s)); }

static char* wptLine(void) {
    size_t cap = 256, len = 0; char* b = (char*)malloc(cap); int c;
    while ((c = getchar()) != EOF && c != '\n') { if (len + 1 >= cap) { cap *= 2; b = (char*)realloc(b, cap); } b[len++] = (char)c; }
    if (len && b[len - 1] == '\r') len--;
    b[len] = 0; return b;
}
static char* wptTrim(char* s) {
    while (*s && isspace((unsigned char)*s)) s++;
    size_t n = strlen(s);
    while (n && isspace((unsigned char)s[n - 1])) s[--n] = 0;
    return s;
}
/* splits in place on whitespace; returns the token count (tokens point into line) */
static int wptWords(char* line, char*** out) {
    int n = 0, cap = 16; char** w = (char**)malloc(cap * sizeof(char*)); char* p = line;
    for (;;) {
        while (*p && isspace((unsigned char)*p)) p++;
        if (!*p) break;
        if (n == cap) { cap *= 2; w = (char**)realloc(w, cap * sizeof(char*)); }
        w[n++] = p;
        while (*p && !isspace((unsigned char)*p)) p++;
        if (*p) *p++ = 0;
    }
    *out = w; return n;
}
static void wptFail(const char* m) { fprintf(stderr, "runtime error: %s\n", m); exit(1); }
`;

function scalarFns(key: Key): string {
  const s = SPEC[key];
  return `static ${s.type} wptParse_${key}(const char* t) { return ${s.parse}; }
static void wptPut_${key}(WptB* b, ${s.type} v) { char t[64]; ${s.put}; wptCs(b, t); }`;
}

function read1(key: Key): string {
  const s = SPEC[key];
  return `static ${s.type}* wptRead1_${key}(int* n) {
    char* line = wptLine(); char** w; int k = wptWords(line, &w);
    ${s.type}* r = (${s.type}*)malloc((k ? k : 1) * sizeof(${s.type}));
    for (int i = 0; i < k; i++) r[i] = wptParse_${key}(w[i]);
    *n = k; return r;
}
static void wptPut1_${key}(WptB* b, ${s.type}* a, int n) { for (int i = 0; i < n; i++) { if (i) wptCs(b, " "); wptPut_${key}(b, a[i]); } }`;
}

function readGrid(key: Key): string {
  const s = SPEC[key];
  const row = key === "char"
    ? `{ size_t m = strlen(line); r[i] = (char*)malloc(m + 1); memcpy(r[i], line, m + 1); (*cols)[i] = (int)m; }`
    : `{ char** w; int m = wptWords(line, &w); r[i] = (${s.type}*)malloc((m ? m : 1) * sizeof(${s.type})); for (int j = 0; j < m; j++) r[i][j] = wptParse_${key}(w[j]); (*cols)[i] = m; }`;
  const put = key === "char"
    ? "wptCat(b, g[i], (size_t)cols[i]);"
    : `for (int j = 0; j < cols[i]; j++) { if (j) wptCs(b, " "); wptPut_${key}(b, g[i][j]); }`;
  return `static ${s.type}** wptReadGrid_${key}(int* n, int** cols) {
    *n = atoi(wptTrim(wptLine()));
    ${s.type}** r = (${s.type}**)malloc((*n ? *n : 1) * sizeof(${s.type}*)); *cols = (int*)malloc((*n ? *n : 1) * sizeof(int));
    for (int i = 0; i < *n; i++) { char* line = wptLine(); ${row} }
    return r;
}
static void wptPutGrid_${key}(WptB* b, ${s.type}** g, int n, int* cols) { for (int i = 0; i < n; i++) { if (i) wptCs(b, "\\n"); ${put} } }`;
}

const STRINGS_FNS = String.raw`static char** wptReadStrings(int* n) {
    *n = atoi(wptTrim(wptLine()));
    char** r = (char**)malloc((*n ? *n : 1) * sizeof(char*));
    for (int i = 0; i < *n; i++) r[i] = wptLine();
    return r;
}
static void wptPutStrings(WptB* b, char** a, int n) { for (int i = 0; i < n; i++) { if (i) wptCs(b, "\n"); wptCs(b, a[i] ? a[i] : "null"); } }`;

const CHARS_FNS = String.raw`static char* wptReadChars(int* n) { char* s = wptLine(); *n = (int)strlen(s); return s; }`;

const COMMAS = String.raw`/* "[1,2,3]" -> comma separated tokens (brackets and spaces removed) */
static int wptCommas(char* line, char*** out) {
    int n = 0, cap = 16; char** w = (char**)malloc(cap * sizeof(char*)); char* p = line;
    while (*p && *p != '[') p++;
    if (*p == '[') p++;
    for (;;) {
        while (*p && isspace((unsigned char)*p)) p++;
        if (!*p || *p == ']') break;
        if (n == cap) { cap *= 2; w = (char**)realloc(w, cap * sizeof(char*)); }
        w[n++] = p;
        while (*p && *p != ',' && *p != ']') p++;
        char* e = p; while (e > w[n - 1] && isspace((unsigned char)e[-1])) e--;
        int stop = (*p == ']' || !*p);
        if (*p == ',') p++;
        *e = 0;
        if (stop) break;
    }
    *out = w; return n;
}`;

const LIST_FNS = String.raw`static struct ListNode* wptReadList(void) {
    char* line = wptLine(); char** w; int n = wptCommas(line, &w);
    struct ListNode* head = 0; struct ListNode* tail = 0;
    for (int i = 0; i < n; i++) {
        struct ListNode* x = (struct ListNode*)malloc(sizeof(struct ListNode));
        x->val = (int)strtoll(w[i], 0, 10); x->next = 0;
        if (tail) tail->next = x; else head = x;
        tail = x;
    }
    return head;
}
static void wptPutList(WptB* b, struct ListNode* v) {
    char t[32]; long guard = 0; wptCs(b, "[");
    for (struct ListNode* p = v; p; p = p->next) { if (++guard > 1000000) wptFail("the returned list has a cycle or is too long"); if (guard > 1) wptCs(b, ","); snprintf(t, sizeof t, "%d", p->val); wptCs(b, t); }
    wptCs(b, "]");
}`;

const TREE_FNS = String.raw`static struct TreeNode* wptReadTree(void) {
    char* line = wptLine(); char** w; int n = wptCommas(line, &w);
    if (n == 0 || strcmp(w[0], "null") == 0) return 0;
    struct TreeNode** q = (struct TreeNode**)malloc(n * sizeof(struct TreeNode*)); int qh = 0, qt = 0;
    struct TreeNode* root = (struct TreeNode*)calloc(1, sizeof(struct TreeNode)); root->val = (int)strtoll(w[0], 0, 10);
    q[qt++] = root; int i = 1;
    while (qh < qt && i < n) {
        struct TreeNode* c = q[qh++];
        if (i < n && strcmp(w[i], "null") != 0) { c->left = (struct TreeNode*)calloc(1, sizeof(struct TreeNode)); c->left->val = (int)strtoll(w[i], 0, 10); q[qt++] = c->left; } i++;
        if (i < n && strcmp(w[i], "null") != 0) { c->right = (struct TreeNode*)calloc(1, sizeof(struct TreeNode)); c->right->val = (int)strtoll(w[i], 0, 10); q[qt++] = c->right; } i++;
    }
    return root;
}
static void wptPutTree(WptB* b, struct TreeNode* v) {
    if (!v) { wptCs(b, "[]"); return; }
    long cap = 64, n = 0, guard = 0; struct TreeNode** q = (struct TreeNode**)malloc(cap * sizeof(struct TreeNode*)); long qh = 0;
    q[n++] = v;
    /* breadth-first with explicit nulls; trailing nulls trimmed afterwards */
    char** out = 0; long on = 0, ocap = 0; char t[32];
    while (qh < n) {
        struct TreeNode* c = q[qh++];
        if (on == ocap) { ocap = ocap ? ocap * 2 : 64; out = (char**)realloc(out, ocap * sizeof(char*)); }
        if (!c) { out[on++] = (char*)"null"; continue; }
        if (++guard > 1000000) wptFail("the returned tree has a cycle or is too large");
        snprintf(t, sizeof t, "%d", c->val); out[on] = (char*)malloc(strlen(t) + 1); strcpy(out[on++], t);
        if (n + 2 > cap) { cap *= 2; q = (struct TreeNode**)realloc(q, cap * sizeof(struct TreeNode*)); }
        q[n++] = c->left; q[n++] = c->right;
    }
    while (on > 0 && strcmp(out[on - 1], "null") == 0) on--;
    wptCs(b, "[");
    for (long i = 0; i < on; i++) { if (i) wptCs(b, ","); wptCs(b, out[i]); }
    wptCs(b, "]");
}`;

const NODE_STRUCTS = {
  ListNode: "struct ListNode {\n    int val;\n    struct ListNode* next;\n};",
  TreeNode: "struct TreeNode {\n    int val;\n    struct TreeNode* left;\n    struct TreeNode* right;\n};",
};

// ------------------------------------------------------------------------------------ code generation

export function buildCTemplate(sig: ParsedSignature): FunctionTemplate & { declaration: string } {
  const { params, ret } = plan(sig);
  const pieces = new Set<string>(); // ordered, de-duplicated helper source
  const add = (s: string) => pieces.add(s);
  let usesDouble = false;
  const needScalar = (key: Key) => { if (key === "double" || key === "float") usesDouble = true; add(scalarFns(key)); };

  const reads: string[] = [];
  const args: string[] = [];
  for (const p of params) {
    const k = p.kind;
    switch (k.k) {
      case "scalar":
        needScalar(k.key);
        reads.push(k.key === "char"
          ? `char ${p.name}; { char* l = wptLine(); ${p.name} = l[0]; }`
          : `${ctype(k.key)} ${p.name}; { char* l = wptTrim(wptLine()); ${p.name} = wptParse_${k.key}(l); }`);
        args.push(p.name);
        break;
      case "string":
        reads.push(`char* ${p.name} = wptLine();`);
        args.push(p.name);
        break;
      case "arr1":
        if (k.elem === "String") { add(STRINGS_FNS); reads.push(`int ${p.name}Size; char** ${p.name} = wptReadStrings(&${p.name}Size);`); }
        else if (k.elem === "char") { add(CHARS_FNS); reads.push(`int ${p.name}Size; char* ${p.name} = wptReadChars(&${p.name}Size);`); }
        else { needScalar(k.elem); add(read1(k.elem)); reads.push(`int ${p.name}Size; ${ctype(k.elem)}* ${p.name} = wptRead1_${k.elem}(&${p.name}Size);`); }
        args.push(p.name, `${p.name}Size`);
        break;
      case "grid":
        needScalar(k.key); add(readGrid(k.key));
        reads.push(`int ${p.name}Size; int* ${p.name}ColSize; ${ctype(k.key)}** ${p.name} = wptReadGrid_${k.key}(&${p.name}Size, &${p.name}ColSize);`);
        args.push(p.name, `${p.name}Size`, `${p.name}ColSize`);
        break;
      case "node":
        add(COMMAS); add(LIST_FNS_FOR[k.name]);
        reads.push(`struct ${k.name}* ${p.name} = ${k.name === "ListNode" ? "wptReadList" : "wptReadTree"}();`);
        args.push(p.name);
        break;
      case "void": break;
    }
  }

  /** Statement(s) appending value `v` of kind `k` (with its size variables) to wptB. */
  const put = (k: Kind, v: string, sizes: { n: string; cols?: string }): string => {
    switch (k.k) {
      case "scalar": needScalar(k.key); return `wptPut_${k.key}(&wptB, ${v});`;
      case "string": return `wptCs(&wptB, ${v} ? ${v} : "null");`;
      case "arr1":
        if (k.elem === "String") { add(STRINGS_FNS); return `wptPutStrings(&wptB, ${v}, ${sizes.n});`; }
        if (k.elem === "char") return `wptCat(&wptB, ${v}, (size_t)${sizes.n});`;
        needScalar(k.elem); add(read1(k.elem)); return `wptPut1_${k.elem}(&wptB, ${v}, ${sizes.n});`;
      case "grid": needScalar(k.key); add(readGrid(k.key)); return `wptPutGrid_${k.key}(&wptB, ${v}, ${sizes.n}, ${sizes.cols});`;
      case "node": add(COMMAS); add(LIST_FNS_FOR[k.name]); return `${k.name === "ListNode" ? "wptPutList" : "wptPutTree"}(&wptB, ${v});`;
      case "void": return "";
    }
  };

  let call: string;
  let emit: string;
  if (ret.k === "void") {
    const first = params[0];
    call = `${sig.name}(${args.join(", ")});`;
    emit = put(first.kind, first.name, { n: `${first.name}Size`, cols: `${first.name}ColSize` });
  } else if (ret.k === "arr1") {
    call = `int returnSize = 0; ${retDecl(ret).type} wptResult = ${sig.name}(${[...args, "&returnSize"].join(", ")});`;
    emit = put(ret, "wptResult", { n: "returnSize" });
  } else if (ret.k === "grid") {
    call = `int returnSize = 0; int* returnColumnSizes = 0; ${retDecl(ret).type} wptResult = ${sig.name}(${[...args, "&returnSize", "&returnColumnSizes"].join(", ")});`;
    emit = put(ret, "wptResult", { n: "returnSize", cols: "returnColumnSizes" });
  } else {
    call = `${retDecl(ret).type} wptResult = ${sig.name}(${args.join(", ")});`;
    emit = put(ret, "wptResult", { n: "0" });
  }

  const nodes = [...params.map((p) => p.kind), ret].filter((k): k is Extract<Kind, { k: "node" }> => k.k === "node").map((k) => k.name);
  const structs = [...new Set(nodes)].map((n) => NODE_STRUCTS[n]).join("\n\n");

  const prefix =
    "#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <math.h>\n#include <ctype.h>\n#include <stdbool.h>\n#include <limits.h>\n#include <stdint.h>\n\n" +
    `${structs ? `${structs}\n\n` : ""}${EDIT_START}\n`;

  const helpers = [CORE, usesDouble ? WPT_FMT_DOUBLE : "", ...pieces].filter(Boolean).join("\n");
  const suffix = `${EDIT_END}

/* ---- platform runner (not editable) ---- */
${WPT_PRAGMAS}${helpers}

int main(void) {
${reads.map((r) => `    ${r}`).join("\n")}
    ${call}
    WptB wptB = {0, 0, 0}; wptCs(&wptB, "");
    ${emit}
    fflush(stdout);
    printf("\\n${RESULT_BEGIN}\\n%s\\n${RESULT_END}\\n", wptB.p);
    fflush(stdout);
    return 0;
}
`;

  const declaration = cDeclaration(sig);
  let body = "    /* Write your solution here */\n";
  if (ret.k === "arr1") body += "    *returnSize = 0;\n    return NULL;\n";
  else if (ret.k === "grid") body += "    *returnSize = 0;\n    *returnColumnSizes = NULL;\n    return NULL;\n";
  else if (ret.k === "string") body += '    return "";\n';
  else if (ret.k === "node") body += "    return NULL;\n";
  else if (ret.k === "scalar") body += `    return ${SPEC[ret.key].zero};\n`;
  const nodeNote = [...new Set(nodes)].map((n) => (n === "ListNode" ? "/* struct ListNode { int val; struct ListNode* next; }; */\n" : "/* struct TreeNode { int val; struct TreeNode* left; struct TreeNode* right; }; */\n")).join("");
  return { prefix, suffix, declaration, starterMethod: `${nodeNote}${declaration} {\n${body}}\n`, starterBody: body };
}

const LIST_FNS_FOR: Record<"ListNode" | "TreeNode", string> = { ListNode: LIST_FNS, TreeNode: TREE_FNS };
