/** Code shared by the C and C++ harnesses (valid in both languages). */

/**
 * Format a double (or float) the way Java's Double.toString / Float.toString does: the shortest digits that
 * round-trip, plain notation for 1e-3 <= |v| < 1e7 ("3.5", "100.0"), otherwise scientific ("1.0E10").
 * That keeps `exact` comparison working whatever language the student used.
 */
export const WPT_FMT_DOUBLE = String.raw`static void wptFmtD(char* out, double v, int isFloat) {
    if (v != v) { strcpy(out, "NaN"); return; }
    if (v > 1.7976931348623157e308) { strcpy(out, "Infinity"); return; }
    if (v < -1.7976931348623157e308) { strcpy(out, "-Infinity"); return; }
    if (v == 0) { strcpy(out, (1.0 / v < 0) ? "-0.0" : "0.0"); return; }
    char sci[48]; int p;
    for (p = 1; p <= 17; p++) {
        snprintf(sci, sizeof sci, "%.*e", p - 1, v);
        double back = strtod(sci, 0);
        if (isFloat ? ((float)back == (float)v) : (back == v)) break;
    }
    char digits[24]; int nd = 0; int neg = 0;
    const char* s = sci;
    if (*s == '-') { neg = 1; s++; }
    for (; *s && *s != 'e'; s++) if (*s != '.') digits[nd++] = *s;
    int ex = atoi(s + 1);
    while (nd > 1 && digits[nd - 1] == '0') nd--;
    digits[nd] = 0;
    char* o = out;
    if (neg) *o++ = '-';
    if (ex >= -3 && ex < 7) {
        if (ex >= 0) {
            for (int i = 0; i <= ex; i++) *o++ = i < nd ? digits[i] : '0';
            *o++ = '.';
            if (nd > ex + 1) for (int i = ex + 1; i < nd; i++) *o++ = digits[i]; else *o++ = '0';
        } else {
            *o++ = '0'; *o++ = '.';
            for (int i = 0; i < -ex - 1; i++) *o++ = '0';
            for (int i = 0; i < nd; i++) *o++ = digits[i];
        }
    } else {
        *o++ = digits[0]; *o++ = '.';
        if (nd > 1) for (int i = 1; i < nd; i++) *o++ = digits[i]; else *o++ = '0';
        o += sprintf(o, "E%d", ex);
    }
    *o = 0;
}`;

/** Silences "defined but not used" warnings for the platform helpers a given problem does not need. */
export const WPT_PRAGMAS = `#pragma GCC diagnostic ignored "-Wunused-function"\n#pragma GCC diagnostic ignored "-Wunused-variable"\n`;
