import React from "react";
import "./charts.css";

export interface RankItem {
  name: string;
  value: number;
  /** Optional display override for the name (e.g. flag + localized country). */
  label?: React.ReactNode;
}

/**
 * Leaderboard rows: rank number, name with a thin proportional bar beneath it,
 * value right-aligned. Used by Top Rules / Domains / Nodes / Policy Groups.
 */
export function RankList({
  items,
  color,
  format,
  limit = 5,
  track = false,
  onItemClick,
  emptyText,
}: {
  items: RankItem[];
  color: string;
  format: (v: number) => string;
  limit?: number;
  track?: boolean;
  onItemClick?: (item: RankItem) => void;
  emptyText?: React.ReactNode;
}) {
  const rows = items.slice(0, limit);
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (!rows.length) return <div className="ch-rank-empty">{emptyText ?? "—"}</div>;
  return (
    <div className="ch-rank">
      {rows.map((r, i) => {
        const w = max > 0 ? Math.max(0.006, r.value / max) : 0;
        const bar = <div className="ch-rank-bar" style={{ width: `${w * 100}%`, background: color }} />;
        return (
          <div className="ch-rank-row" key={`${r.name}-${i}`}>
            <span className="ch-rank-idx">{i + 1}</span>
            <div className="ch-rank-main">
              <div className="ch-rank-line">
                <span
                  className={`ch-rank-name${onItemClick ? " link" : ""}`}
                  title={r.name}
                  onClick={onItemClick ? () => onItemClick(r) : undefined}
                >
                  {r.label ?? r.name}
                </span>
                <span className="ch-rank-val">{format(r.value)}</span>
              </div>
              {track ? <div className="ch-rank-track">{bar}</div> : bar}
            </div>
          </div>
        );
      })}
    </div>
  );
}
