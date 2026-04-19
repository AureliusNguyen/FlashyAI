import React from "react"
import { cn } from "../lib/cn"
import type { AgentStatus } from "../lib/types"

const LABEL: Record<AgentStatus, string> = {
  queued: "STANDBY",
  connecting: "HANDSHAKE",
  streaming: "LIVE FEED",
  complete: "ACQUIRED",
  not_found: "NULL",
  error: "ABORT",
}

const TONE: Record<AgentStatus, string> = {
  queued: "text-muted-foreground border-border",
  connecting: "text-warning border-warning/50",
  streaming: "text-phosphor border-phosphor/50",
  complete: "text-phosphor border-phosphor/50",
  not_found: "text-data border-data/50",
  error: "text-danger border-danger/50",
}

export function StatusBracket({ status }: { status: AgentStatus }) {
  return (
    <span className={cn(
      "font-mono-display text-[9px] tracking-[0.22em] uppercase px-1.5 py-0.5 border",
      TONE[status]
    )}>
      [ {LABEL[status]} ]
    </span>
  )
}
