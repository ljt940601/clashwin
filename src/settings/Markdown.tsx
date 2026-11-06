/**
 * Minimal Markdown for release notes: headings, bullet/numbered lists, code fences,
 * **bold**, `code` and links. Builds React elements (no HTML injection); links open in
 * the system browser.
 */
import React from "react";
import { backend } from "@/lib/backend";

type Block =
  | { k: "h"; level: number; text: string }
  | { k: "li"; text: string; depth: number; n?: string }
  | { k: "p"; text: string }
  | { k: "code"; text: string }
  | { k: "hr" };

function parse(src: string): Block[] {
  const text = src
    .replace(/\r\n/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?(details|summary|p|div|br|sub|sup)\b[^>]*>/gi, "");
  const out: Block[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) body.push(lines[i]);
      out.push({ k: "code", text: body.join("\n") });
      continue;
    }
    const t = line.trim();
    if (!t) continue;
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^(#{1,6})\s+(.*)$/))) out.push({ k: "h", level: m[1].length, text: m[2].replace(/\s+#+$/, "") });
    else if (/^([-*_])\1{2,}$/.test(t)) out.push({ k: "hr" });
    else if ((m = line.match(/^(\s*)[-*+]\s+(.*)$/))) out.push({ k: "li", text: m[2], depth: Math.min(2, Math.floor(m[1].length / 2)) });
    else if ((m = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/))) out.push({ k: "li", text: m[3], depth: Math.min(2, Math.floor(m[1].length / 2)), n: m[2] });
    else {
      const prev = out[out.length - 1];
      // soft-wrapped paragraph lines join up
      if (prev?.k === "p" && lines[i - 1]?.trim()) prev.text += " " + t;
      else out.push({ k: "p", text: t });
    }
  }
  return out;
}

/** Short label for long GitHub links: ".../pull/123" → "#123". */
function linkLabel(url: string): string {
  const m = url.match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:pull|issues)\/(\d+)/);
  if (m) return `#${m[1]}`;
  const c = url.match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/compare\/(.+)$/);
  if (c) return c[1];
  return url.replace(/^https?:\/\//, "");
}

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      title={href}
      onClick={(e) => {
        e.preventDefault();
        backend.openUrl(href).catch(() => {});
      }}
    >
      {children}
    </a>
  );
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    if (m[1]) out.push(<code key={k++}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k++}>{m[2].slice(2, -2)}</strong>);
    else if (m[3])
      out.push(
        <Link key={k++} href={m[5]}>
          {m[4]}
        </Link>,
      );
    else if (m[6])
      out.push(
        <Link key={k++} href={m[6]}>
          {linkLabel(m[6])}
        </Link>,
      );
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = React.useMemo(() => parse(text), [text]);
  return (
    <div className={className ? `md ${className}` : "md"}>
      {blocks.map((b, i) => {
        switch (b.k) {
          case "h":
            return (
              <div key={i} className={`md-h md-h${Math.min(b.level, 3)}`}>
                {inline(b.text)}
              </div>
            );
          case "li":
            return (
              <div key={i} className="md-li" style={{ paddingLeft: 14 + b.depth * 14 }}>
                <span className="md-bullet">{b.n ? `${b.n}.` : "•"}</span>
                <span>{inline(b.text)}</span>
              </div>
            );
          case "code":
            return (
              <pre key={i} className="md-code">
                {b.text}
              </pre>
            );
          case "hr":
            return <hr key={i} className="md-hr" />;
          default:
            return (
              <p key={i} className="md-p">
                {inline(b.text)}
              </p>
            );
        }
      })}
    </div>
  );
}
