import React from "react"
import type { AgentState } from "../lib/types"
import { AgentCard } from "./AgentCard"

interface AgentGridProps {
  agents: AgentState[]
}

export function AgentGrid({ agents }: AgentGridProps) {
  if (agents.length === 0) return null

  return (
    <div className="grid grid-cols-1 gap-3 p-3">
      {agents.map((agent) => (
        <AgentCard key={agent.id} agent={agent} />
      ))}
    </div>
  )
}
