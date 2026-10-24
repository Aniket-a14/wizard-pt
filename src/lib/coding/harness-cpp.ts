/**
 * C++ function-mode harness. The admin writes ONE typed Java signature; the C++ declaration, starter
 * code and platform `main` are derived from it with the same type grammar and the same stdin/stdout
 * encodings (see ./types), so one set of test cases works for every language.
 *
 *   Java                         C++
 *   int/short/byte/long/…        int / short / signed char / long long (wrappers map to the same type)
 *   boolean char String          bool char string
 *   T[]  List<T>                 vector<T>
 *   Set<T>  Map<K,V>             set<T>  map<K,V>
 *   ListNode TreeNode            ListNode* TreeNode* (LeetCode-style structs, provided)
 *   void (in place)              void, first parameter taken by reference
 *
 * Containers are passed by non-const reference (like LeetCode); strings by value.
 */
import { EDIT_END, EDIT_START, RESULT_BEGIN, RESULT_END, type FunctionTemplate } from "./harness";
import { WPT_FMT_DOUBLE, WPT_PRAGMAS } from "./harness-shared";
import type { ParsedSignature } from "./signature";
import { paramTypes, returnJType } from "./signature";
import { encodingOf, SignatureError, type JType, type ScalarName } from "./types";

const SCALAR: Record<ScalarName, string> = {
  int: "int", Integer: "int", long: "long long", Long: "long long", double: "double", Double: "double",
  boolean: "bool", Boolean: "bool", char: "char", Character: "char", short: "short", Short: "short",
  byte: "signed char", Byte: "signed char", float: "float", Float: "float", String: "string",
};

export function cppType(t: JType): string {
  switch (t.k) {
    case "scalar": return SCALAR[t.name];
    case "array": return `vector<${cppType(t.of)}>`;
    case "list": return `vector<${cppType(t.of)}>`;
    case "set": return `set<${cppType(t.of)}>`;
    case "map": return `map<${cppType(t.key)}, ${cppType(t.value)}>`;
    case "node": return `${t.name}*`;
    case "void": return "void";
  }
}

const byRef = (t: JType) => t.k === "array" || t.k === "list" || t.k === "set" || t.k === "map";

function usesNode(t: JType, name: "ListNode" | "TreeNode"): boolean {
  switch (t.k) {
    case "node": return t.name === name;
    case "array":
    case "list":
    case "set": return usesNode(t.of, name);
    case "map": return usesNode(t.value, name);
    default: return false;
  }
}

function defaultValue(t: JType): string | null {
  switch (t.k) {
    case "void": return null;
    case "scalar":
      return t.name === "String" ? '""' : SCALAR[t.name] === "bool" ? "false" : SCALAR[t.name] === "char" ? "'\\0'" : "0";
    case "node": return "nullptr";
    default: return `${cppType(t)}()`;
  }
}

export function cppDeclaration(sig: ParsedSignature): string {
  const params = paramTypes(sig).map((p) => `${cppType(p.j)}${byRef(p.j) ? "&" : ""} ${p.name}`);
  return `${cppType(returnJType(sig))} ${sig.name}(${params.join(", ")})`;
}

const NODE_STRUCTS = {
  ListNode: `struct ListNode {
    int val;
    ListNode* next;
    ListNode() : val(0), next(nullptr) {}
    ListNode(int x) : val(x), next(nullptr) {}
    ListNode(int x, ListNode* n) : val(x), next(n) {}
};`,
  TreeNode: `struct TreeNode {
    int val;
    TreeNode* left;
    TreeNode* right;
    TreeNode() : val(0), left(nullptr), right(nullptr) {}
    TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
    TreeNode(int x, TreeNode* l, TreeNode* r) : val(x), left(l), right(r) {}
};`,
};

// ------------------------------------------------------------------------------------------ runtime

const RUNTIME_CORE = String.raw`
${WPT_FMT_DOUBLE}

static string wptNum(double v, bool isFloat = false) { char b[64]; wptFmtD(b, v, isFloat ? 1 : 0); return b; }

static string wptReadLine() {
    string s;
    if (!getline(cin, s)) s.clear();
    if (!s.empty() && s.back() == '\r') s.pop_back();
    return s;
}
static string wptTrim(const string& s) {
    size_t a = 0, b = s.size();
    while (a < b && isspace((unsigned char)s[a])) a++;
    while (b > a && isspace((unsigned char)s[b - 1])) b--;
    return s.substr(a, b - a);
}
static vector<string> wptSplit(const string& s) {
    vector<string> out; istringstream in(s); string t;
    while (in >> t) out.push_back(t);
    return out;
}

template <class T> struct wptIsVec : false_type {};
template <class T, class A> struct wptIsVec<vector<T, A>> : true_type {};
template <class T> struct wptIsSet : false_type {};
template <class T, class C, class A> struct wptIsSet<set<T, C, A>> : true_type {};
template <class T> struct wptIsMap : false_type {};
template <class K, class V, class C, class A> struct wptIsMap<map<K, V, C, A>> : true_type {};
template <class T> constexpr bool wptIsText = is_same_v<T, string>;
template <class T> constexpr bool wptIsScalar = is_arithmetic_v<T> || wptIsText<T>;

// ---- one token / one value as plain text (test inputs and outputs) ----
template <class T> void wptTok(const string& t, T& out) {
    if constexpr (is_same_v<T, bool>) { string l; for (char c : t) l += (char)tolower((unsigned char)c); out = (l == "true"); }
    else if constexpr (is_same_v<T, char>) { out = t.empty() ? '\0' : t[0]; }
    else if constexpr (is_same_v<T, string>) { out = t; }
    else if constexpr (is_floating_point_v<T>) { out = (T)stod(t); }
    else { out = (T)stoll(t); }
}
template <class T> string wptText(const T& v) {
    if constexpr (is_same_v<T, bool>) return v ? "true" : "false";
    else if constexpr (is_same_v<T, char>) return string(1, v);
    else if constexpr (is_same_v<T, string>) return v;
    else if constexpr (is_floating_point_v<T>) return wptNum((double)v, is_same_v<T, float>);
    else return to_string((long long)v);
}
template <class C> string wptJoin(const C& c, const string& sep) {
    string r; bool first = true;
    for (const auto& e : c) { if (!first) r += sep; first = false; r += wptText(e); }
    return r;
}

static int wptInt(const string& s) { return stoi(wptTrim(s)); }

template <class T> vector<T> wptRead1() {
    vector<T> r;
    for (const string& t : wptSplit(wptReadLine())) { T v{}; wptTok(t, v); r.push_back(move(v)); }
    return r;
}
static vector<char> wptReadChars() { string s = wptReadLine(); return vector<char>(s.begin(), s.end()); }
static vector<string> wptReadStrings() {
    int n = wptInt(wptReadLine());
    vector<string> r;
    for (int i = 0; i < n; i++) r.push_back(wptReadLine());
    return r;
}
template <class T> vector<T> wptReadItems() {
    int n = wptInt(wptReadLine());
    vector<T> r;
    for (const string& t : wptSplit(wptReadLine())) { T v{}; wptTok(t, v); r.push_back(move(v)); }
    if ((int)r.size() != n) throw runtime_error("Test input says " + to_string(n) + " items but has " + to_string(r.size()));
    return r;
}
template <class T> vector<vector<T>> wptReadGrid() {
    int n = wptInt(wptReadLine());
    vector<vector<T>> g;
    for (int i = 0; i < n; i++) {
        string line = wptReadLine();
        if constexpr (is_same_v<T, char>) g.push_back(vector<char>(line.begin(), line.end()));
        else { vector<T> row; for (const string& t : wptSplit(line)) { T v{}; wptTok(t, v); row.push_back(move(v)); } g.push_back(move(row)); }
    }
    return g;
}
template <class T> string wptGridText(const vector<vector<T>>& g) {
    string r;
    for (size_t i = 0; i < g.size(); i++) {
        if (i) r += '\n';
        if constexpr (is_same_v<T, char>) r += string(g[i].begin(), g[i].end());
        else r += wptJoin(g[i], " ");
    }
    return r;
}
`;

const RUNTIME_JSON = String.raw`
// ---- JSON (nested containers, maps, nodes) ----
struct WptJ { int t = 0; bool b = false; string s; vector<WptJ> a; vector<pair<string, WptJ>> o; };  // 0 null 1 bool 2 num 3 str 4 arr 5 obj
struct WptJP {
    const string& s; size_t i = 0;
    explicit WptJP(const string& x) : s(x) {}
    void ws() { while (i < s.size() && isspace((unsigned char)s[i])) i++; }
    [[noreturn]] void fail(const string& m) { throw runtime_error("bad JSON in the test input: " + m); }
    string str() {
        if (s[i] != '"') fail("expected a string");
        i++; string out;
        while (i < s.size() && s[i] != '"') {
            if (s[i] == '\\') {
                i++; char c = s[i++];
                switch (c) {
                    case 'n': out += '\n'; break; case 't': out += '\t'; break; case 'r': out += '\r'; break;
                    case 'b': out += '\b'; break; case 'f': out += '\f'; break;
                    case 'u': { int cp = stoi(s.substr(i, 4), nullptr, 16); i += 4;
                        if (cp < 0x80) out += (char)cp;
                        else if (cp < 0x800) { out += (char)(0xC0 | (cp >> 6)); out += (char)(0x80 | (cp & 0x3F)); }
                        else { out += (char)(0xE0 | (cp >> 12)); out += (char)(0x80 | ((cp >> 6) & 0x3F)); out += (char)(0x80 | (cp & 0x3F)); }
                        break; }
                    default: out += c;
                }
            } else out += s[i++];
        }
        if (i >= s.size()) fail("unterminated string");
        i++; return out;
    }
    WptJ val() {
        ws(); if (i >= s.size()) fail("unexpected end");
        WptJ j; char c = s[i];
        if (c == '[') {
            i++; j.t = 4; ws();
            if (s[i] == ']') { i++; return j; }
            for (;;) { j.a.push_back(val()); ws(); if (s[i] == ',') { i++; continue; } if (s[i] == ']') { i++; return j; } fail("expected , or ]"); }
        }
        if (c == '{') {
            i++; j.t = 5; ws();
            if (s[i] == '}') { i++; return j; }
            for (;;) { ws(); string k = str(); ws(); if (s[i] != ':') fail("expected :"); i++; j.o.emplace_back(k, val()); ws(); if (s[i] == ',') { i++; continue; } if (s[i] == '}') { i++; return j; } fail("expected , or }"); }
        }
        if (c == '"') { j.t = 3; j.s = str(); return j; }
        size_t st = i; while (i < s.size() && !isspace((unsigned char)s[i]) && s[i] != ',' && s[i] != ']' && s[i] != '}') i++;
        string w = s.substr(st, i - st);
        if (w == "null") return j;
        if (w == "true" || w == "false") { j.t = 1; j.b = (w == "true"); return j; }
        j.t = 2; j.s = w; return j;
    }
    WptJ parse() { WptJ j = val(); ws(); if (i != s.size()) fail("unexpected data after the value"); return j; }
};

template <class T> void wptFrom(const WptJ& j, T& out);
template <class T> void wptFromKey(const string& k, T& out) { wptTok(k, out); }

template <class T> void wptFrom(const WptJ& j, T& out) {
    if constexpr (is_same_v<T, bool>) { if (j.t != 1) throw runtime_error("expected true/false in the JSON input"); out = j.b; }
    else if constexpr (is_same_v<T, char>) { if (j.s.size() != 1) throw runtime_error("expected a one-character string in the JSON input"); out = j.s[0]; }
    else if constexpr (is_same_v<T, string>) { out = j.s; }
    else if constexpr (is_arithmetic_v<T>) { if (j.t != 2 && j.t != 3) throw runtime_error("expected a number in the JSON input (null is not supported in C++)"); wptTok(j.s, out); }
    else if constexpr (wptIsVec<T>::value) { out.clear(); for (const WptJ& e : j.a) { typename T::value_type v{}; wptFrom(e, v); out.push_back(move(v)); } }
    else if constexpr (wptIsSet<T>::value) { out.clear(); for (const WptJ& e : j.a) { typename T::value_type v{}; wptFrom(e, v); out.insert(move(v)); } }
    else if constexpr (wptIsMap<T>::value) { out.clear(); for (const auto& kv : j.o) { typename T::key_type k{}; wptFromKey(kv.first, k); typename T::mapped_type v{}; wptFrom(kv.second, v); out.emplace(move(k), move(v)); } }
    else if constexpr (is_pointer_v<T>) { wptFromNode(j, out); }
}

static string wptQuote(const string& s) {
    string b = "\"";
    for (unsigned char c : s) {
        switch (c) {
            case '"': b += "\\\""; break; case '\\': b += "\\\\"; break; case '\n': b += "\\n"; break;
            case '\r': b += "\\r"; break; case '\t': b += "\\t"; break;
            default: if (c < 0x20) { char u[8]; snprintf(u, sizeof u, "\\u%04x", c); b += u; } else b += (char)c;
        }
    }
    return b + '"';
}

template <class T> string wptJson(const T& v);
template <class T> string wptKeyText(const T& k) { return wptText(k); }

template <class T> string wptJson(const T& v) {
    if constexpr (is_same_v<T, bool>) return v ? "true" : "false";
    else if constexpr (is_same_v<T, char>) return wptQuote(string(1, v));
    else if constexpr (is_same_v<T, string>) return wptQuote(v);
    else if constexpr (is_floating_point_v<T>) { if (v != v || v > 1e308 || v < -1e308) return "\"" + wptNum((double)v) + "\""; return wptNum((double)v, is_same_v<T, float>); }
    else if constexpr (is_arithmetic_v<T>) return to_string((long long)v);
    else if constexpr (wptIsVec<T>::value) { string r = "["; bool f = true; for (const auto& e : v) { if (!f) r += ','; f = false; r += wptJson(e); } return r + "]"; }
    else if constexpr (wptIsSet<T>::value) {
        vector<string> parts; for (const auto& e : v) parts.push_back(wptJson(e));
        if constexpr (!wptIsScalar<typename T::value_type>) sort(parts.begin(), parts.end());
        string r = "["; for (size_t i = 0; i < parts.size(); i++) { if (i) r += ','; r += parts[i]; } return r + "]";
    }
    else if constexpr (wptIsMap<T>::value) { string r = "{"; bool f = true; for (const auto& kv : v) { if (!f) r += ','; f = false; r += wptQuote(wptKeyText(kv.first)) + ":" + wptJson(kv.second); } return r + "}"; }
    else if constexpr (is_pointer_v<T>) return wptNodeJson(v);
    else return "null";
}
`;

const RUNTIME_LISTNODE = String.raw`
static void wptFromNode(const WptJ& j, ListNode*& out) {
    out = nullptr; ListNode* tail = nullptr;
    for (const WptJ& e : j.a) { ListNode* n = new ListNode((int)stoll(e.s)); if (tail) tail->next = n; else out = n; tail = n; }
}
static string wptNodeJson(ListNode* v) {
    string r = "["; int guard = 0;
    for (ListNode* p = v; p; p = p->next) { if (++guard > 1000000) throw runtime_error("the returned list has a cycle or is too long"); if (guard > 1) r += ','; r += to_string(p->val); }
    return r + "]";
}
`;

const RUNTIME_TREENODE = String.raw`
static void wptFromNode(const WptJ& j, TreeNode*& out) {
    out = nullptr;
    if (j.a.empty() || j.a[0].t == 0) return;
    out = new TreeNode((int)stoll(j.a[0].s));
    queue<TreeNode*> q; q.push(out); size_t i = 1;
    while (!q.empty() && i < j.a.size()) {
        TreeNode* c = q.front(); q.pop();
        if (i < j.a.size() && j.a[i].t != 0) { c->left = new TreeNode((int)stoll(j.a[i].s)); q.push(c->left); } i++;
        if (i < j.a.size() && j.a[i].t != 0) { c->right = new TreeNode((int)stoll(j.a[i].s)); q.push(c->right); } i++;
    }
}
static string wptNodeJson(TreeNode* v) {
    if (!v) return "[]";
    vector<string> out; queue<TreeNode*> q; q.push(v); int guard = 0;
    while (!q.empty()) {
        TreeNode* c = q.front(); q.pop();
        if (!c) { out.push_back("null"); continue; }
        if (++guard > 1000000) throw runtime_error("the returned tree has a cycle or is too large");
        out.push_back(to_string(c->val)); q.push(c->left); q.push(c->right);
    }
    while (!out.empty() && out.back() == "null") out.pop_back();
    string r = "["; for (size_t i = 0; i < out.size(); i++) { if (i) r += ','; r += out[i]; } return r + "]";
}
`;

// ------------------------------------------------------------------------------------ code generation

function readParam(t: JType, v: string, needs: { json: boolean }): string {
  const T = cppType(t);
  switch (encodingOf(t)) {
    case "line": {
      const n = (t as Extract<JType, { k: "scalar" }>).name;
      if (n === "String") return `string ${v} = wptReadLine();`;
      if (SCALAR[n] === "char") return `string wptL_${v} = wptReadLine(); char ${v} = wptL_${v}.empty() ? '\\0' : wptL_${v}[0];`;
      return `${T} ${v}{}; wptTok(wptTrim(wptReadLine()), ${v});`;
    }
    case "array1": return `${T} ${v} = wptRead1<${cppType((t as Extract<JType, { k: "array" }>).of)}>();`;
    case "chars": return `${T} ${v} = wptReadChars();`;
    case "strings": return `${T} ${v} = wptReadStrings();`;
    case "items": return `${T} ${v}; { auto wptI = wptReadItems<${cppType((t as Extract<JType, { k: "list" | "set" }>).of)}>(); ${t.k === "set" ? `${v}.insert(wptI.begin(), wptI.end());` : `${v} = move(wptI);`} }`;
    case "grid": return `${T} ${v} = wptReadGrid<${cppType(((t as Extract<JType, { k: "array" }>).of as Extract<JType, { k: "array" }>).of)}>();`;
    case "json": needs.json = true; return `${T} ${v}{}; { WptJ wptJv = WptJP(wptReadLine()).parse(); wptFrom(wptJv, ${v}); }`;
  }
}

/** C++ expression of type `string` writing `v` the way test outputs are written. */
function writeValue(t: JType, v: string, needs: { json: boolean }): string {
  switch (encodingOf(t)) {
    case "line": return `wptText(${v})`;
    case "array1": return `wptJoin(${v}, " ")`;
    case "chars": return `string(${v}.begin(), ${v}.end())`;
    case "strings": return `wptJoin(${v}, "\\n")`;
    case "items": {
      const e = (t as Extract<JType, { k: "list" | "set" }>).of;
      const strings = e.k === "scalar" && e.name === "String";
      return `wptJoin(${v}, ${strings ? '"\\n"' : '" "'})`;
    }
    case "grid": return `wptGridText(${v})`;
    case "json": needs.json = true; return `wptJson(${v})`;
  }
}

/** Build the trusted prefix/suffix and starter snippets for a C++ function-mode problem. */
export function buildCppTemplate(sig: ParsedSignature): FunctionTemplate & { declaration: string } {
  const params = paramTypes(sig);
  const ret = returnJType(sig);
  const all = [...params.map((p) => p.j), ret];
  const lists = all.some((t) => usesNode(t, "ListNode"));
  const trees = all.some((t) => usesNode(t, "TreeNode"));
  const needs = { json: lists || trees };

  const reads = params.map((p) => `        ${readParam(p.j, p.name, needs)}`);
  const args = params.map((p) => p.name).join(", ");
  let call: string;
  let text: string;
  if (ret.k === "void") {
    call = `        ${sig.name}(${args});`;
    text = writeValue(params[0].j, params[0].name, needs);
  } else {
    call = `        ${cppType(ret)} wptResult = ${sig.name}(${args});`;
    text = writeValue(ret, "wptResult", needs);
  }
  // wptFromNode / wptNodeJson must be declared before the generic JSON templates that call them.
  const nodeDecls: string[] = [];
  if (lists) nodeDecls.push("static void wptFromNode(const WptJ& j, ListNode*& out);\nstatic string wptNodeJson(ListNode* v);");
  if (trees) nodeDecls.push("static void wptFromNode(const WptJ& j, TreeNode*& out);\nstatic string wptNodeJson(TreeNode* v);");

  const structs = [lists ? NODE_STRUCTS.ListNode : "", trees ? NODE_STRUCTS.TreeNode : ""].filter(Boolean).join("\n\n");
  const prefix = `#include <bits/stdc++.h>\nusing namespace std;\n\n${structs ? `${structs}\n\n` : ""}${EDIT_START}\n`;

  const runtime = [
    RUNTIME_CORE,
    needs.json ? RUNTIME_JSON.replace("template <class T> void wptFrom(const WptJ& j, T& out);", `${nodeDecls.join("\n")}\ntemplate <class T> void wptFrom(const WptJ& j, T& out);`) : "",
    lists ? RUNTIME_LISTNODE : "",
    trees ? RUNTIME_TREENODE : "",
  ].join("\n");

  const suffix = `${EDIT_END}

// ---- platform runner (not editable) ----
${WPT_PRAGMAS}${runtime}
int main() {
    try {
${reads.join("\n")}
${call}
        string wptOut = ${text};
        cout.flush(); fflush(stdout);
        cout << "\\n${RESULT_BEGIN}\\n" << wptOut << "\\n${RESULT_END}\\n" << flush;
    } catch (const exception& e) {
        cerr << "runtime error: " << e.what() << endl;
        return 1;
    }
    return 0;
}
`;

  const declaration = cppDeclaration(sig);
  const dv = defaultValue(ret);
  const body = `    // Write your solution here\n${dv === null ? "" : `    return ${dv};\n`}`;
  const nodeNote = [
    lists ? "// struct ListNode { int val; ListNode* next; ListNode(int x) : val(x), next(nullptr) {} };\n" : "",
    trees ? "// struct TreeNode { int val; TreeNode* left; TreeNode* right; TreeNode(int x) : val(x), left(nullptr), right(nullptr) {} };\n" : "",
  ].join("");
  return {
    prefix,
    suffix,
    declaration,
    starterMethod: `${nodeNote}${declaration} {\n${body}}\n`,
    starterBody: body,
  };
}

export { SignatureError };
