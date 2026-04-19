import React, { useCallback, useState } from "react"
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
  const isDone = agent.status === "complete"
  const isNotFound = agent.status === "not_found"
  const isError = agent.status === "error"

  // Track iframe loads — first load = live feed, second load = TinyFish completion page
  const [iframeExpired, setIframeExpired] = useState(false)
  const [loadCount, setLoadCount] = useState(0)
  const handleIframeLoad = useCallback(() => {
    setLoadCount(prev => {
      const next = prev + 1
      // After 2+ loads, TinyFish has redirected to completion page — hide iframe
      if (next >= 2) setIframeExpired(true)
      return next
    })
  }, [])

  const isLive = agent.status === "streaming" && agent.streamingUrl && !iframeExpired

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
          <>
            <iframe
              src={agent.streamingUrl}
              className="absolute inset-0 w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin"
              allow="autoplay"
              onLoad={handleIframeLoad}
            />
            <div className="absolute inset-x-0 top-0 h-7 bg-gradient-to-b from-background to-transparent pointer-events-none z-20" />
            <div className="absolute top-1.5 left-2 font-mono-display text-[9px] tracking-widest text-phosphor uppercase pointer-events-none z-20">
              ◉ LIVE FEED ▪ {agent.site.toUpperCase()}
            </div>
            <div className="absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t from-background to-transparent pointer-events-none z-20" />
            <div className="absolute bottom-1.5 right-2 font-mono-display text-[8px] tracking-wider text-muted-foreground/60 uppercase pointer-events-none z-20">
              PROBE {String(index + 1).padStart(2, "0")} ▪ TELEMETRY
            </div>
          </>
        ) : null}

        {/* Session ended but no result yet — show processing state instead of TinyFish page */}
        {iframeExpired && agent.status === "streaming" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <RadarSpinner />
            <span className="font-mono-display text-[9px] tracking-[0.2em] uppercase text-primary">
              PROCESSING TELEMETRY...
            </span>
          </div>
        )}

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

        {(agent.status === "queued" || (agent.status === "connecting")) && (
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
