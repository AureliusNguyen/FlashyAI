import React from "react"
import type { AgentState } from "../lib/types"
import { findBestDeal } from "../lib/orchestrator"

interface BestDealProps {
  agents: AgentState[]
  originalPrice?: string
}

export function BestDeal({ agents, originalPrice }: BestDealProps) {
  const best = findBestDeal(agents)
  if (!best) return null

  const originalNum = originalPrice
    ? parseFloat(originalPrice.replace(/[^0-9.]/g, ""))
    : null
  const delta = originalNum ? originalNum - best.price : null
  const pct = originalNum && delta ? Math.round((delta / originalNum) * 100) : null

  return (
    <div className="mx-3 mt-3 border border-primary/50 bg-gradient-panel shadow-readout">
      {/* Header strip */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-primary/30 bg-primary/5">
        <span className="font-mono-display text-[10px] tracking-[0.25em] uppercase text-primary">
          ▸ PRIMARY TARGET ACQUIRED
        </span>
        {best.matchType === "similar" && (
          <span className="font-mono-display text-[9px] tracking-[0.2em] px-1 border border-data/40 text-data uppercase">
            VARIANT
          </span>
        )}
      </div>

      <div className="px-3 py-3">
        {/* Price readout */}
        <div className="flex items-baseline justify-between">
          <div
            className="font-readout text-3xl font-bold text-primary"
            style={{ textShadow: "0 0 16px hsl(var(--primary) / 0.6)" }}
          >
            ${best.price.toFixed(2)}
          </div>
          <div className="font-mono-display text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
            via <span className="text-foreground">{best.site}</span>
          </div>
        </div>

        {/* Delta */}
        {delta !== null && delta > 0 && (
          <div className="mt-2 flex items-center gap-2 font-mono-display text-[10px] tracking-widest uppercase">
            <span className="text-phosphor">DELTA -${delta.toFixed(2)}</span>
            {pct !== null && <span className="text-phosphor/70">({pct}% SAVED)</span>}
          </div>
        )}

        {/* CTA */}
        {best.result.url && (
          <a
            href={best.result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 block w-full text-center py-2 border border-primary bg-primary/10 hover:bg-primary/20 font-mono-display text-[11px] tracking-[0.25em] uppercase text-primary transition-colors"
          >
            ▸ ENGAGE TARGET ↗
          </a>
        )}
      </div>
    </div>
  )
}
