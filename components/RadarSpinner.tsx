import React from "react"

export function RadarSpinner() {
  return (
    <div className="relative w-12 h-12">
      <div className="absolute inset-0 rounded-full border border-primary/30" />
      <div className="absolute inset-2 rounded-full border border-primary/20" />
      <div
        className="absolute inset-0 rounded-full animate-scan-sweep origin-center"
        style={{
          background:
            "conic-gradient(from 0deg, transparent 0deg, hsl(var(--primary) / 0.5) 60deg, transparent 90deg)",
        }}
      />
      <div className="absolute inset-1/2 w-1 h-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-glow-amber" />
    </div>
  )
}
