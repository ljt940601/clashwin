/**
 * Small line-based YAML tokenizer for the config editor. It only colours text —
 * it never changes it — so a token stream always joins back to the exact line.
 * Clash-specific touch: rule lines ("- DOMAIN-SUFFIX,google.com,Proxy") get the
 * rule type highlighted.
 */

export type TokType =
  | "key"
  | "str"
  | "num"
  | "bool"
  | "null"
  | "comment"
  | "punct"
  | "anchor"
  | "tag"
  | "rule"
  | "doc"
  | "plain";

export interface Tok {
  t: TokType;
  s: string;
}

const NUM = /^[-+]?(?:\d[\d_]*(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+|0x[0-9a-fA-F]+|0o[0-7]+|\.inf|\.Inf|\.INF)$|^\.nan$|^\.NaN$/;
const BOOL = /^(?:true|false|True|False|TRUE|FALSE|yes|no|Yes|No|on|off|On|Off)$/;
const NUL = /^(?:null|Null|NULL|~)$/;
const RULE = /^([A-Z][A-Z0-9-]*)(,)/;
// A mapping key: quoted, or plain text up to the first ": " (or a ":" that ends the line).
const KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#'"{}[\],&*!|>%@`-][^#]*?|-[^\s#][^#]*?)(\s*)(:)(?=\s|$)/;
/** Value that opens a block scalar: "|", ">-", "|2+"… optionally followed by a comment. */
export const BLOCK_START = /(?:^|[\s:])[|>][-+0-9]*\s*(?:#.*)?$/;

function scalar(out: Tok[], text: string, ruleLine: boolean) {
  if (!text) return;
  const lead = text.match(/^\s*/)![0];
  const trail = text.slice(lead.length).match(/\s*$/)![0];
  const core = text.slice(lead.length, text.length - trail.length);
  if (lead) out.push({ t: "plain", s: lead });
  if (core) {
    if (NUM.test(core)) out.push({ t: "num", s: core });
    else if (BOOL.test(core)) out.push({ t: "bool", s: core });
    else if (NUL.test(core)) out.push({ t: "null", s: core });
    else {
      const m = ruleLine ? core.match(RULE) : null;
      if (m) {
        out.push({ t: "rule", s: m[1] }, { t: "punct", s: "," });
        const rest = core.slice(m[0].length);
        // "IP-CIDR,1.2.3.0/24,Proxy,no-resolve": colour the commas so the parts read apart
        rest.split(/(,)/).forEach((part) => part && out.push({ t: part === "," ? "punct" : "str", s: part }));
      } else out.push({ t: "str", s: core });
    }
  }
  if (trail) out.push({ t: "plain", s: trail });
}

/** Tokens for everything after "key:" or "- " — plain scalars, quotes, flow maps/lists. */
function value(out: Tok[], s: string, ruleLine: boolean) {
  let buf = "";
  let depth = 0;
  const flush = () => {
    scalar(out, buf, ruleLine && depth === 0);
    buf = "";
  };
  const atStart = () => buf.trim() === "";
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c === "#" && (i === 0 || /\s/.test(s[i - 1]))) {
      flush();
      out.push({ t: "comment", s: s.slice(i) });
      return;
    }
    if ((c === '"' || c === "'") && (depth > 0 || atStart())) {
      flush();
      let j = i + 1;
      while (j < s.length) {
        if (c === '"' && s[j] === "\\") j += 2;
        else if (s[j] === c) {
          if (c === "'" && s[j + 1] === "'") j += 2;
          else break;
        } else j++;
      }
      out.push({ t: "str", s: s.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (depth > 0 || ((c === "{" || c === "[") && atStart())) {
      if (c === "{" || c === "[") {
        flush();
        depth++;
        out.push({ t: "punct", s: c });
        i++;
        continue;
      }
      if (c === "}" || c === "]" || c === ",") {
        flush();
        if (c !== ",") depth = Math.max(0, depth - 1);
        out.push({ t: "punct", s: c });
        i++;
        continue;
      }
      if (c === ":" && (i + 1 >= s.length || /[\s,}\]]/.test(s[i + 1]))) {
        const lead = buf.match(/^\s*/)![0];
        if (lead) out.push({ t: "plain", s: lead });
        if (buf.length > lead.length) out.push({ t: "key", s: buf.slice(lead.length) });
        buf = "";
        out.push({ t: "punct", s: ":" });
        i++;
        continue;
      }
    }
    if ((c === "&" || c === "*" || c === "!") && atStart()) {
      flush();
      let j = i + 1;
      while (j < s.length && !/[\s,{}[\]]/.test(s[j])) j++;
      out.push({ t: c === "!" ? "tag" : "anchor", s: s.slice(i, j) });
      i = j;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
}

/** Tokenize one line. `inBlock` = the line is inside a "|" / ">" block scalar. */
export function tokenizeLine(line: string, inBlock = false): Tok[] {
  if (inBlock) return line ? [{ t: "str", s: line }] : [];
  const out: Tok[] = [];
  const indent = line.match(/^\s*/)![0];
  if (indent) out.push({ t: "plain", s: indent });
  let rest = line.slice(indent.length);
  if (!rest) return out;
  if (rest.startsWith("#")) {
    out.push({ t: "comment", s: rest });
    return out;
  }
  if (/^(?:---|\.\.\.)(?:\s|$)/.test(rest)) {
    out.push({ t: "doc", s: rest.slice(0, 3) });
    value(out, rest.slice(3), false);
    return out;
  }
  let listItem = false;
  for (let m = rest.match(/^-(\s+|$)/); m; m = rest.match(/^-(\s+|$)/)) {
    listItem = true;
    out.push({ t: "punct", s: "-" });
    if (m[1]) out.push({ t: "plain", s: m[1] });
    rest = rest.slice(m[0].length);
  }
  const k = rest.match(KEY);
  if (k) {
    out.push({ t: "key", s: k[1] });
    if (k[2]) out.push({ t: "plain", s: k[2] });
    out.push({ t: "punct", s: ":" });
    rest = rest.slice(k[0].length);
    listItem = false;
  }
  value(out, rest, listItem);
  return out;
}

/**
 * Per-line flag: true when the line is content of a block scalar ("key: |").
 * Linear pass, cheap enough to run on every edit.
 */
export function blockLines(lines: string[]): Uint8Array {
  const flags = new Uint8Array(lines.length);
  let blockIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;
    if (blockIndent >= 0) {
      if (!trimmed || indent > blockIndent) {
        flags[i] = 1;
        continue;
      }
      blockIndent = -1;
    }
    if (trimmed && !trimmed.startsWith("#") && BLOCK_START.test(trimmed)) {
      // the block belongs to the key on this line: "- name: |" counts from the key, not the dash
      const dash = trimmed.match(/^(-\s+)*/)![0].length;
      blockIndent = indent + dash;
    }
  }
  return flags;
}

/** "yaml: line 23: did not find expected key" → 23 (1-based). */
export function errorLine(message: string): number | null {
  const m = message.match(/\bline (\d+)\b/i) ?? message.match(/行\s*(\d+)/);
  return m ? Number(m[1]) : null;
}
