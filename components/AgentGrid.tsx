import React, { useMemo } from "react"
import type { AgentState } from "../lib/types"
import { AgentCard } from "./AgentCard"

interface AgentGridProps {
  agents: AgentState[]
}

export function AgentGrid({ agents }: AgentGridProps) {
  // Find the agent with the lowest price
  const bestAgentId = useMemo(() => {
    let bestId: string | null = null
    let bestPrice = Infinity
    for (const a of agents) {
      if (a.status !== "complete" || !a.result?.price) continue
      const p = parseFloat(a.result.price.replace(/[^0-9.]/g, ""))
      if (!isNaN(p) && p < bestPrice) { bestPrice = p; bestId = a.id }
    }
    return bestId
  }, [agents])

  if (agents.length === 0) {
    return (
      <div className="px-4 py-6 text-center font-mono-display text-[10px] tracking-[0.22em] uppercase text-muted-foreground/60">
        NO PROBES IN THIS CHANNEL
      </div>
    )
  }

  return (
    <div className="p-3">
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className="font-mono-display text-[10px] tracking-[0.25em] uppercase text-primary">
          ▸ ACTIVE PROBES
        </span>
        <span className="flex-1 border-b border-dashed border-border" />
        <span className="font-mono-display text-[9px] tracking-[0.2em] uppercase text-muted-foreground">
          [{agents.length} DISPATCHED]
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {agents.map((agent, i) => (
          <AgentCard key={agent.id} agent={agent} index={i} isBestDeal={agent.id === bestAgentId} />
        ))}
      </div>
    </div>
  )
}
