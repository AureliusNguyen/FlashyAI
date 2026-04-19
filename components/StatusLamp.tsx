import React from "react"
import { cn } from "../lib/cn"
import type { AgentStatus } from "../lib/types"

const LAMP: Record<AgentStatus, string> = {
  queued: "bg-muted-foreground/40",
  connecting: "bg-warning animate-pulse-amber shadow-glow-amber",
  streaming: "bg-phosphor animate-pulse-phosphor",
  complete: "bg-phosphor shadow-glow-phosphor",
  not_found: "bg-data shadow-glow-cyan",
  error: "bg-danger shadow-glow-danger",
}

export function StatusLamp({ status }: { status: AgentStatus }) {
  return <span className={cn("inline-block w-2 h-2 rounded-full", LAMP[status])} />
}
