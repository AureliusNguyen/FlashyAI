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
  const savings = originalNum ? originalNum - best.price : null

  return (
    <div className="mx-3 mb-3 p-4 rounded-lg bg-gradient-to-r from-green-900/40 to-emerald-900/40 border border-green-800/50">
      <div className="text-xs text-green-400 uppercase tracking-wider mb-1">
        Best Deal Found
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-green-300">
          ${best.price.toFixed(2)}
        </span>
        <span className="text-sm text-zinc-400">on {best.site}</span>
      </div>
      {savings && savings > 0 && (
        <div className="text-sm text-green-400 mt-1">
          Save ${savings.toFixed(2)} vs current page
        </div>
      )}
      {best.result.url && (
        <a
          href={best.result.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-2 px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-500 text-white rounded-md transition-colors"
        >
          Go to {best.site}
        </a>
      )}
    </div>
  )
}
