import React from "react"
import type { AgentState } from "../lib/types"
import { StatusLamp } from "./StatusLamp"
import { StatusBracket } from "./StatusBracket"
import { RadarSpinner } from "./RadarSpinner"

interface AgentCardProps {
  agent: AgentState
  index: number
  isBestDeal?: boolean
}

export function AgentCard({ agent, index, isBestDeal }: AgentCardProps) {
  const probeId = `PROBE-${String(index + 1).padStart(2, "0")}`
  const isLive = agent.status === "streaming" && agent.streamingUrl
  const isDone = agent.status === "complete"
  const isNotFound = agent.status === "not_found"
  const isError = agent.status === "error"

  return (
    <div className="bg-gradient-panel border border-border-strong shadow-bezel animate-boot-in">
      {/* Top label strip */}
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-background/60 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <StatusLamp status={agent.status} />
          <span className="font-mono-display text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
            {probeId}
          </span>
          <span className="font-mono-display text-[10px] tracking-[0.15em] uppercase text-foreground/80 truncate">
            ▪ {agent.site}
          </span>
          {agent.matchType === "similar" && (
            <span className="font-mono-display text-[9px] tracking-[0.18em] px-1 border border-data/40 text-data uppercase">
              VARIANT
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {isBestDeal && isDone && (
            <span className="font-mono-display text-[8px] tracking-[0.2em] px-1 py-0.5 bg-primary/15 border border-primary/50 text-primary uppercase">
              TARGET LOCKED
            </span>
          )}
          <StatusBracket status={agent.status} />
        </div>
      </div>

      {/* Viewport */}
      <div className="viewport-frame relative bg-background" style={{ paddingBottom: "56.25%" }}>
        <span className="corner-tr" />
        <span className="corner-bl" />

        {isLive && agent.streamingUrl ? (
          <iframe
            src={agent.streamingUrl}
            className="absolute inset-0 w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin"
            allow="autoplay"
          />
        ) : isLive ? (
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 grid-paper opacity-40" />
            <div className="absolute inset-x-0 h-8 bg-gradient-to-b from-phosphor/20 to-transparent animate-scanline-sweep pointer-events-none" />
            <div className="absolute top-2 left-2 font-mono-display text-[9px] tracking-widest text-phosphor uppercase">
              ◉ REC ▪ T+00:0{index + 3}
            </div>
            <div className="absolute bottom-2 left-2 right-2 font-mono-display text-[9px] tracking-wider text-phosphor/80 uppercase truncate">
              &gt; navigating...
              <span className="animate-blink-cursor">▌</span>
            </div>
          </div>
        ) : null}

        {isDone && agent.result && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-3 text-center">
            <div className="font-mono-display text-[9px] tracking-[0.2em] text-muted-foreground uppercase mb-1">
              ▸ ACQUIRED
            </div>
            <div
              className="font-readout text-2xl font-bold text-primary"
              style={{ textShadow: "0 0 12px hsl(var(--primary) / 0.6)" }}
            >
              {agent.result.price || "N/A"}
            </div>
            <div className="font-sans text-[11px] text-foreground/70 mt-1 line-clamp-2">
              {agent.result.product || "TARGET ACQUIRED"}
            </div>
            {agent.result.url && (
              <a
                href={agent.result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 font-mono-display text-[10px] tracking-widest uppercase text-data hover:text-primary transition-colors"
              >
                &gt; VIEW SOURCE ↗
              </a>
            )}
          </div>
        )}

        {isNotFound && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-3 text-center">
            <div className="font-mono-display text-xs tracking-[0.2em] text-data uppercase">
              NULL RESULT
            </div>
            <div className="font-mono-display text-[10px] tracking-wider text-muted-foreground uppercase mt-1">
              RECALIBRATING — SCANNING VARIANTS
            </div>
          </div>
        )}

        {isError && (
          <div className="absolute inset-0 flex items-center justify-center px-3">
            <div className="font-mono-display text-[10px] tracking-widest text-danger uppercase text-center">
              ◢ ABORT ◣<br />
              <span className="text-[9px] text-danger/70">{agent.error || "PROBE FAILURE"}</span>
            </div>
          </div>
        )}

        {(agent.status === "queued" || agent.status === "connecting") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            {agent.status === "connecting" ? (
              <RadarSpinner />
            ) : (
              <div className="font-mono-display text-[10px] tracking-widest text-muted-foreground/60 uppercase">
                ▣ ▣ ▣ ▣ ▣
              </div>
            )}
            <span className="font-mono-display text-[9px] tracking-[0.2em] uppercase text-muted-foreground">
              {agent.status === "connecting" ? "ESTABLISHING UPLINK..." : "STANDBY"}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
