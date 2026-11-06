/**
 * Config editor: a native <textarea> for editing (so undo, IME and selection
 * behave normally) with a syntax-highlighted copy of the text drawn underneath,
 * plus line numbers. Only the visible lines are highlighted, so large
 * subscription files stay responsive.
 */
import React from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useT } from "@/i18n";
import { cx } from "@/components/ui";
import { BLOCK_START, blockLines, tokenizeLine, type Tok } from "./yaml";
import "./editor.css";

const LH = 19; // line height (px) — must match editor.css
const PAD_Y = 8;
const OVERSCAN = 8;
const MAX_MATCHES = 5000;

export interface YamlEditorHandle {
  focus: () => void;
  gotoLine: (line: number) => void;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSave?: () => void;
  /** 1-based line to mark as the error location */
  errorLine?: number | null;
  placeholder?: string;
  autoFocus?: boolean;
}

/** Replace a range through the browser's editing pipeline so Ctrl+Z keeps working. */
function replaceRange(ta: HTMLTextAreaElement, start: number, end: number, text: string, selStart?: number, selEnd?: number) {
  ta.focus();
  ta.setSelectionRange(start, end);
  if (!document.execCommand("insertText", false, text)) {
    ta.setRangeText(text, start, end, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (selStart !== undefined) ta.setSelectionRange(selStart, selEnd ?? selStart);
}

/** Full lines covered by the selection: [lineStart, lineEnd) offsets. */
function selectedLines(v: string, s: number, e: number) {
  const ls = v.lastIndexOf("\n", s - 1) + 1;
  const endAt = e > s && v[e - 1] === "\n" ? e - 1 : e;
  let le = v.indexOf("\n", endAt);
  if (le < 0) le = v.length;
  return [ls, le] as const;
}

function lowerBound(arr: number[], x: number) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export const YamlEditor = React.forwardRef<YamlEditorHandle, Props>(function YamlEditor(
  { value, onChange, onSave, errorLine, placeholder, autoFocus },
  ref,
) {
  const t = useT();
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  const findRef = React.useRef<HTMLInputElement>(null);
  const [scroll, setScroll] = React.useState({ top: 0, left: 0 });
  const [viewH, setViewH] = React.useState(480);
  const [caret, setCaret] = React.useState({ line: 1, col: 1 });
  const [findOpen, setFindOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [matchIdx, setMatchIdx] = React.useState(0);
  const cache = React.useRef(new Map<string, Tok[]>());

  const lines = React.useMemo(() => value.split("\n"), [value]);
  const blocks = React.useMemo(() => blockLines(lines), [lines]);
  const lineStarts = React.useMemo(() => {
    const out = new Array<number>(lines.length);
    let off = 0;
    for (let i = 0; i < lines.length; i++) {
      out[i] = off;
      off += lines[i].length + 1;
    }
    return out;
  }, [lines]);

  /* ---------- find ---------- */
  const matches = React.useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return [] as number[];
    const hay = value.toLowerCase();
    const out: number[] = [];
    for (let i = hay.indexOf(q); i >= 0 && out.length < MAX_MATCHES; i = hay.indexOf(q, i + q.length)) out.push(i);
    return out;
  }, [value, query]);
  const current = matches.length ? Math.min(matchIdx, matches.length - 1) : -1;

  const lineOf = React.useCallback((pos: number) => Math.max(0, lowerBound(lineStarts, pos + 1) - 1), [lineStarts]);

  const scrollToLine = React.useCallback(
    (line: number) => {
      const ta = taRef.current;
      if (!ta) return;
      const y = PAD_Y + line * LH;
      if (y < ta.scrollTop + LH || y > ta.scrollTop + ta.clientHeight - 2 * LH) ta.scrollTop = Math.max(0, y - ta.clientHeight / 2);
    },
    [],
  );

  const selectMatch = React.useCallback(
    (i: number, focus = false) => {
      const ta = taRef.current;
      if (!ta || !matches.length) return;
      const idx = ((i % matches.length) + matches.length) % matches.length;
      setMatchIdx(idx);
      const start = matches[idx];
      if (focus) ta.focus();
      ta.setSelectionRange(start, start + query.length);
      const line = lineOf(start);
      scrollToLine(line);
      // bring the match into view horizontally too
      const col = start - lineStarts[line];
      const approx = col * 7.2;
      if (approx < ta.scrollLeft || approx > ta.scrollLeft + ta.clientWidth - 60) ta.scrollLeft = Math.max(0, approx - 80);
    },
    [matches, query, lineOf, lineStarts, scrollToLine],
  );

  React.useEffect(() => setMatchIdx(0), [query]);

  const openFind = () => {
    const ta = taRef.current;
    if (ta) {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (sel && !sel.includes("\n")) setQuery(sel);
    }
    setFindOpen(true);
    requestAnimationFrame(() => {
      findRef.current?.focus();
      findRef.current?.select();
    });
  };
  const closeFind = () => {
    setFindOpen(false);
    taRef.current?.focus();
  };

  /* ---------- imperative handle ---------- */
  React.useImperativeHandle(
    ref,
    () => ({
      focus: () => taRef.current?.focus(),
      gotoLine: (line: number) => {
        const ta = taRef.current;
        if (!ta) return;
        const i = Math.min(Math.max(1, line), lines.length) - 1;
        ta.focus();
        ta.setSelectionRange(lineStarts[i], lineStarts[i]);
        scrollToLine(i);
        ta.scrollLeft = 0;
        setCaret({ line: i + 1, col: 1 });
      },
    }),
    [lines.length, lineStarts, scrollToLine],
  );

  /* ---------- layout tracking ---------- */
  React.useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const ro = new ResizeObserver(() => setViewH(ta.clientHeight));
    ro.observe(ta);
    setViewH(ta.clientHeight);
    if (autoFocus) {
      ta.focus();
      ta.setSelectionRange(0, 0);
    }
    return () => ro.disconnect();
  }, [autoFocus]);

  const syncCaret = () => {
    const ta = taRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const line = lineOf(pos);
    setCaret({ line: line + 1, col: pos - lineStarts[line] + 1 });
  };
  // positions shift when the text changes; re-read the caret afterwards
  React.useEffect(syncCaret, [lineStarts]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- keyboard ---------- */
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const mod = e.ctrlKey || e.metaKey;
    const v = ta.value;
    const s = ta.selectionStart;
    const en = ta.selectionEnd;

    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSave?.();
      return;
    }
    if (mod && e.key.toLowerCase() === "f") {
      e.preventDefault();
      openFind();
      return;
    }
    if (e.key === "F3" || (mod && e.key.toLowerCase() === "g")) {
      e.preventDefault();
      if (matches.length) selectMatch(current + (e.shiftKey ? -1 : 1), true);
      else openFind();
      return;
    }
    if (e.key === "Escape" && findOpen) {
      e.preventDefault();
      e.nativeEvent.stopPropagation();
      setFindOpen(false);
      return;
    }
    if (mod && e.key === "/") {
      e.preventDefault();
      const [ls, le] = selectedLines(v, s, en);
      const rows = v.slice(ls, le).split("\n");
      const filled = rows.filter((r) => r.trim());
      const commented = filled.length > 0 && filled.every((r) => /^\s*#/.test(r));
      const minInd = Math.min(...filled.map((r) => r.match(/^\s*/)![0].length), Infinity);
      const next = rows
        .map((r) => (commented ? r.replace(/^(\s*)# ?/, "$1") : r.trim() ? r.slice(0, minInd) + "# " + r.slice(minInd) : r))
        .join("\n");
      replaceRange(ta, ls, le, next, ls, ls + next.length);
      return;
    }
    if (e.key === "Tab" && !mod && !e.altKey) {
      e.preventDefault();
      const multi = v.slice(s, en).includes("\n");
      if (!e.shiftKey && !multi) {
        replaceRange(ta, s, en, "  ");
        return;
      }
      const [ls, le] = selectedLines(v, s, en);
      const rows = v.slice(ls, le).split("\n");
      const next = rows.map((r) => (e.shiftKey ? r.replace(/^( {1,2}|\t)/, "") : r ? "  " + r : r)).join("\n");
      if (next === v.slice(ls, le)) return;
      if (multi) replaceRange(ta, ls, le, next, ls, ls + next.length);
      else {
        const removed = v.slice(ls, le).length - next.length;
        replaceRange(ta, ls, le, next, Math.max(ls, s - removed));
      }
      return;
    }
    if (e.key === "Enter" && !mod && !e.altKey && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const ls = v.lastIndexOf("\n", s - 1) + 1;
      const before = v.slice(ls, s);
      let indent = before.match(/^\s*/)![0];
      const item = before.match(/^(\s*)((?:-\s+)+)(?=\S)/);
      if (item && /^[^#\s][^#]*?:(\s|$)/.test(before.slice(item[0].length))) indent = " ".repeat(item[0].length); // "- name: x" → align with "name"
      const tail = before.replace(/\s+#.*$/, "").trimEnd();
      if (tail.endsWith(":") || BLOCK_START.test(tail.trim())) indent += "  ";
      replaceRange(ta, s, en, "\n" + indent);
      return;
    }
  };

  /* ---------- render ---------- */
  const first = Math.max(0, Math.floor((scroll.top - PAD_Y) / LH) - OVERSCAN);
  const last = Math.min(lines.length, Math.ceil((scroll.top + viewH) / LH) + OVERSCAN);
  if (cache.current.size > 20000) cache.current.clear();

  const rows: React.ReactNode[] = [];
  const nums: React.ReactNode[] = [];
  const marks: React.ReactNode[] = [];
  const qLen = query.length;
  for (let i = first; i < last; i++) {
    const text = lines[i];
    const inBlock = blocks[i] === 1;
    const key = (inBlock ? "\u0001" : "") + text;
    let toks = cache.current.get(key);
    if (!toks) {
      toks = tokenizeLine(text, inBlock);
      cache.current.set(key, toks);
    }
    // find matches on this line, in line-relative offsets
    const ranges: { s: number; e: number; cur: boolean }[] = [];
    if (qLen && matches.length) {
      const ls = lineStarts[i];
      for (let m = lowerBound(matches, ls); m < matches.length && matches[m] < ls + text.length; m++)
        ranges.push({ s: matches[m] - ls, e: Math.min(text.length, matches[m] - ls + qLen), cur: m === current });
    }
    const top = PAD_Y + i * LH;
    rows.push(
      <div key={i} className="ce-line" style={{ top }}>
        {renderTokens(toks, ranges)}
      </div>,
    );
    const isErr = errorLine === i + 1;
    nums.push(
      <div key={i} className={cx("ce-num", caret.line === i + 1 && "active", isErr && "error")} style={{ top }}>
        {i + 1}
      </div>,
    );
    if (isErr) marks.push(<div key={`e${i}`} className="ce-row error" style={{ top }} />);
  }
  if (caret.line - 1 >= first && caret.line - 1 < last)
    marks.push(<div key="caret" className="ce-row active" style={{ top: PAD_Y + (caret.line - 1) * LH }} />);

  const digits = String(lines.length).length;

  return (
    <div className="ce">
      <div className="ce-main">
        <div className="ce-gutter" style={{ width: `calc(${Math.max(2, digits)}ch + 22px)` }} aria-hidden>
          <div style={{ transform: `translateY(${-scroll.top}px)` }}>{nums}</div>
        </div>
        <div className="ce-area">
          <div className="ce-rows" aria-hidden>
            <div style={{ transform: `translateY(${-scroll.top}px)` }}>{marks}</div>
          </div>
          <div className="ce-hl" aria-hidden>
            <div style={{ transform: `translate(${-scroll.left}px, ${-scroll.top}px)` }}>{rows}</div>
          </div>
          {!value && placeholder && <div className="ce-placeholder">{placeholder}</div>}
          <textarea
            ref={taRef}
            className="ce-input"
            value={value}
            wrap="off"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            onChange={(e) => onChange(e.target.value)}
            onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft })}
            onKeyDown={onKeyDown}
            onSelect={syncCaret}
            onKeyUp={syncCaret}
            onMouseUp={syncCaret}
          />
          {findOpen && (
            <div className="ce-find" onMouseDown={(e) => e.stopPropagation()}>
              <input
                ref={findRef}
                className="ce-find-input"
                value={query}
                placeholder={t("profiles.findPh")}
                spellCheck={false}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "F3") {
                    e.preventDefault();
                    selectMatch(current + (e.shiftKey ? -1 : 1));
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.nativeEvent.stopPropagation();
                    closeFind();
                  }
                }}
              />
              <span className={cx("ce-find-count", query && !matches.length && "none")}>
                {query ? (matches.length ? `${current + 1}/${matches.length}${matches.length >= MAX_MATCHES ? "+" : ""}` : t("profiles.findNone")) : ""}
              </span>
              <button className="ce-find-btn" title={t("profiles.findPrev")} disabled={!matches.length} onClick={() => selectMatch(current - 1)}>
                <ArrowUp size={12} />
              </button>
              <button className="ce-find-btn" title={t("profiles.findNext")} disabled={!matches.length} onClick={() => selectMatch(current + 1)}>
                <ArrowDown size={12} />
              </button>
              <button className="ce-find-btn" title={t("common.close")} onClick={closeFind}>
                <X size={12} />
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="ce-status">
        <span>{t("profiles.editorPos", { line: caret.line, col: caret.col })}</span>
        <span className="ce-status-dim">{t("profiles.editorLines", { n: lines.length })}</span>
        <span className="ce-status-spacer" />
        <span className="ce-status-dim">{t("profiles.editorHints")}</span>
        <span className="ce-status-lang">YAML</span>
      </div>
    </div>
  );
});

function renderTokens(toks: Tok[], ranges: { s: number; e: number; cur: boolean }[]): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let pos = 0;
  let k = 0;
  for (const tok of toks) {
    const end = pos + tok.s.length;
    if (!ranges.length) {
      out.push(
        <span key={k++} className={`tk-${tok.t}`}>
          {tok.s}
        </span>,
      );
    } else {
      // split the token where find matches start/stop
      let p = pos;
      while (p < end) {
        const r = ranges.find((x) => x.e > p && x.s < end && x.s <= p);
        const nextStart = ranges.filter((x) => x.s > p && x.s < end).reduce((a, x) => Math.min(a, x.s), end);
        const stop = r ? Math.min(r.e, end) : nextStart;
        out.push(
          <span key={k++} className={cx(`tk-${tok.t}`, r && "ce-mark", r?.cur && "cur")}>
            {tok.s.slice(p - pos, stop - pos)}
          </span>,
        );
        p = stop;
      }
    }
    pos = end;
  }
  return out;
}
