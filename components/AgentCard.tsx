import React from "react"
import type { AgentState } from "../lib/types"

interface AgentCardProps {
  agent: AgentState
}

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-zinc-700",
  connecting: "bg-yellow-500/20 text-yellow-400",
  streaming: "bg-blue-500/20 text-blue-400",
  complete: "bg-green-500/20 text-green-400",
  not_found: "bg-orange-500/20 text-orange-400",
  error: "bg-red-500/20 text-red-400"
}

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  connecting: "Connecting...",
  streaming: "Live",
  complete: "Found",
  not_found: "Not Available",
  error: "Failed"
}

export function AgentCard({ agent }: AgentCardProps) {
  const isLive = agent.status === "streaming" && agent.streamingUrl
  const isDone = agent.status === "complete"
  const isNotFound = agent.status === "not_found"
  const isError = agent.status === "error"

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            isLive ? "bg-blue-400 animate-pulse" :
            isDone ? "bg-green-400" :
            isNotFound ? "bg-orange-400" :
            isError ? "bg-red-400" :
            "bg-zinc-600"
          }`} />
          <span className="text-sm font-medium text-zinc-200">{agent.site}</span>
          {agent.matchType === "similar" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-400">
              similar
            </span>
          )}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[agent.status] || ""}`}>
          {STATUS_LABELS[agent.status] || agent.status}
        </span>
      </div>

      {/* Content */}
      <div className="relative" style={{ paddingBottom: "56.25%" }}>
        {isLive && agent.streamingUrl ? (
          <iframe
            src={agent.streamingUrl}
            className="absolute inset-0 w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin"
            allow="autoplay"
          />
        ) : isDone && agent.result ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
            <p className="text-lg font-bold text-green-400">
              {agent.result.price || "N/A"}
            </p>
            <p className="text-xs text-zinc-400 mt-1 line-clamp-2">
              {agent.result.product || "Product found"}
            </p>
            {agent.result.url && (
              <a
                href={agent.result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 text-xs text-blue-400 hover:underline"
              >
                View on {agent.site}
              </a>
            )}
          </div>
        ) : isNotFound ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4">
            <p className="text-sm text-orange-400 font-medium">Not available</p>
            <p className="text-xs text-zinc-500 mt-1">Searching for similar products...</p>
          </div>
        ) : isError ? (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <p className="text-xs text-red-400 text-center">{agent.error || "Agent failed"}</p>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
              <span className="text-xs text-zinc-500">
                {agent.status === "connecting" ? "Connecting..." : "Waiting..."}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
