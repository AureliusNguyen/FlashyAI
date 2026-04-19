import React, { useCallback, useEffect, useMemo, useState } from "react"
import { AgentGrid } from "./components/AgentGrid"
import { BestDeal } from "./components/BestDeal"
import { RadarSpinner } from "./components/RadarSpinner"
import type { AgentState } from "./lib/types"
import "./style.css"

type Phase = "idle" | "capturing" | "extracting" | "running" | "complete" | "error"
type Tab = "exact" | "similar"

function SidePanel() {
  const [phase, setPhase] = useState<Phase>("idle")
  const [agents, setAgents] = useState<AgentState[]>([])
  const [product, setProduct] = useState("")
  const [originalPrice, setOriginalPrice] = useState("")
  const [error, setError] = useState("")
  const [hasKeys, setHasKeys] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>("exact")
  const [hasSimilarSearch, setHasSimilarSearch] = useState(false)

  const exactAgents = useMemo(() => agents.filter(a => a.matchType === "exact"), [agents])
  const similarAgents = useMemo(() => agents.filter(a => a.matchType === "similar"), [agents])
  const exactFoundCount = useMemo(() => exactAgents.filter(a => a.status === "complete").length, [exactAgents])
  const similarFoundCount = useMemo(() => similarAgents.filter(a => a.status === "complete").length, [similarAgents])
  const totalAgents = agents.length
  const completedAgents = agents.filter(a => ["complete", "not_found", "error"].includes(a.status)).length

  useEffect(() => {
    if (hasSimilarSearch && exactFoundCount === 0 && similarAgents.length > 0) {
      setActiveTab("similar")
    }
  }, [hasSimilarSearch, exactFoundCount, similarAgents.length])

  useEffect(() => {
    chrome.storage.local.get(["tinyfishKey", "featherlessKey"], (result) => {
      setHasKeys(!!result.tinyfishKey && !!result.featherlessKey)
    })
  }, [])

  useEffect(() => {
    const handler = (message: { type: string; payload?: unknown }) => {
      switch (message.type) {
        case "ORCHESTRATION_START":
          setPhase("extracting")
          setAgents([])
          setError("")
          setActiveTab("exact")
          setHasSimilarSearch(false)
          break
        case "INTENT_EXTRACTED": {
          const p = message.payload as { type: string; product: string }
          setProduct(p.product)
          setPhase("running")
          break
        }
        case "AGENT_UPDATE":
          setAgents(message.payload as AgentState[])
          break
        case "SIMILAR_SEARCH_START":
          setHasSimilarSearch(true)
          break
        case "ORCHESTRATION_COMPLETE":
          setAgents(message.payload as AgentState[])
          setPhase("complete")
          break
        case "ERROR":
          setError(String(message.payload))
          setPhase("error")
          break
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [])

  const handleFlashIt = useCallback(async () => {
    setPhase("capturing")
    setError("")
    console.log("[FlashyAI:SidePanel] Dispatch probes clicked")

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) { setError("NO ACTIVE TAB DETECTED"); setPhase("error"); return }

      const url = tab.url || ""
      if (url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("about:") || url === "") {
        setError("INVALID TARGET — NAVIGATE TO A PRODUCT PAGE FIRST")
        setPhase("error")
        return
      }

      const hostname = new URL(url).hostname.replace("www.", "")
      const SUPPORTED_SITES = [
        "amazon.com", "ebay.com", "target.com",
        "bestbuy.com", "newegg.com", "costco.com", "homedepot.com",
        "etsy.com", "aliexpress.com", "zappos.com", "nordstrom.com",
        "macys.com", "nike.com", "adidas.com"
      ]
      if (!SUPPORTED_SITES.some(s => hostname.includes(s))) {
        setError(`TARGET "${hostname.toUpperCase()}" NOT IN DATABASE.\n\nCOMPATIBLE: AMAZON, EBAY, TARGET, BEST BUY, NEWEGG, COSTCO`)
        setPhase("error")
        return
      }

      let capture
      try {
        capture = await chrome.tabs.sendMessage(tab.id, { type: "REQUEST_CAPTURE" })
      } catch {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const productArea =
              document.querySelector("[data-component='product']") ||
              document.querySelector("#productTitle")?.closest("div") ||
              document.querySelector("main") ||
              document.querySelector("#content") ||
              document.querySelector("article") ||
              document.body
            return {
              url: window.location.href,
              title: document.title,
              html: (productArea?.innerHTML || document.body.innerHTML).slice(0, 5000),
              events: [],
              timestamp: Date.now()
            }
          }
        })
        capture = results?.[0]?.result
      }

      if (!capture) {
        setError("CAPTURE FAILED — REFRESH PAGE AND RETRY")
        setPhase("error")
        return
      }

      if (capture.html) {
        const priceMatch = capture.html.match(/\$[\d,]+\.?\d*/)?.[0]
        if (priceMatch) setOriginalPrice(priceMatch)
      }

      chrome.runtime.sendMessage({ type: "FLASH_IT", payload: capture })
    } catch (err) {
      console.error("[FlashyAI:SidePanel] Capture error:", err)
      setError(`SYSTEM ERROR: ${err}`)
      setPhase("error")
    }
  }, [])

  const isWorking = phase === "capturing" || phase === "extracting" || phase === "running"
  const showTabs = agents.length > 0

  const missionStatus = phase === "idle" ? "STANDBY" :
    phase === "capturing" ? "SCANNING" :
    phase === "extracting" ? "ANALYZING" :
    phase === "running" ? "ACTIVE" :
    phase === "complete" ? "COMPLETE" :
    "ERROR"

  return (
    <div className="min-h-screen bg-background scanlines grid-paper flex flex-col">
      {/* Top status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface border-b border-border">
        <span className="font-mono-display text-[9px] tracking-[0.25em] uppercase text-primary">
          FLASHYAI MISSION CONTROL
        </span>
        <span className="font-mono-display text-[9px] tracking-[0.2em] uppercase text-muted-foreground">
          MISSION: <span className={phase === "running" ? "text-phosphor" : phase === "error" ? "text-danger" : phase === "complete" ? "text-phosphor" : "text-primary"}>{missionStatus}</span>
          {totalAgents > 0 && <> ▪ PROBES: {completedAgents}/{totalAgents}</>}
        </span>
      </div>

      {/* Main header + button */}
      <div className="p-3 border-b border-border">
        {!hasKeys ? (
          <div className="p-3 border border-warning/30 bg-warning/5">
            <p className="font-mono-display text-[10px] tracking-[0.2em] uppercase text-warning mb-1">
              ▸ CONFIGURATION REQUIRED
            </p>
            <p className="font-mono-display text-[9px] tracking-wider uppercase text-muted-foreground">
              RIGHT-CLICK EXTENSION ICON → OPTIONS → ENTER API CREDENTIALS
            </p>
          </div>
        ) : (
          <button
            onClick={handleFlashIt}
            disabled={isWorking}
            className={`w-full py-2.5 px-4 font-mono-display text-[11px] tracking-[0.25em] uppercase transition-all border ${
              isWorking
                ? "bg-surface text-muted-foreground border-border cursor-not-allowed"
                : "bg-primary/10 text-primary border-primary hover:bg-primary/20"
            }`}
          >
            {phase === "capturing" ? "SCANNING TARGET..." :
             phase === "extracting" ? "ANALYZING TELEMETRY..." :
             phase === "running" ? "PROBES ACTIVE..." :
             "▸ DISPATCH PROBES"}
          </button>
        )}
      </div>

      {/* Mission target */}
      {product && (
        <div className="px-3 py-2 border-b border-border bg-surface/50">
          <div className="font-mono-display text-[9px] tracking-[0.25em] uppercase text-primary mb-0.5">
            ▸ MISSION TARGET
          </div>
          <div className="font-sans text-sm text-foreground font-medium">{product}</div>
          {originalPrice && (
            <div className="font-mono-display text-[10px] tracking-wider uppercase text-muted-foreground mt-0.5">
              SOURCE PRICE: <span className="font-readout text-foreground">{originalPrice}</span>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-3 mt-3 p-3 border border-danger/30 bg-danger/5">
          <div className="font-mono-display text-[10px] tracking-[0.2em] uppercase text-danger whitespace-pre-line">
            ◢ {error}
          </div>
        </div>
      )}

      {/* Tabs */}
      {showTabs && (
        <div className="flex border-b border-border">
          <button
            onClick={() => setActiveTab("exact")}
            className={`flex-1 py-2 font-mono-display text-[10px] tracking-[0.2em] uppercase transition-colors relative ${
              activeTab === "exact" ? "text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            ▸ EXACT
            {exactFoundCount > 0 && (
              <span className="ml-1.5 px-1 border border-phosphor/40 text-phosphor text-[9px]">
                {exactFoundCount}
              </span>
            )}
            {activeTab === "exact" && (
              <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-primary" />
            )}
          </button>
          <button
            onClick={() => setActiveTab("similar")}
            className={`flex-1 py-2 font-mono-display text-[10px] tracking-[0.2em] uppercase transition-colors relative ${
              activeTab === "similar" ? "text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            ▸ VARIANTS
            {similarFoundCount > 0 && (
              <span className="ml-1.5 px-1 border border-data/40 text-data text-[9px]">
                {similarFoundCount}
              </span>
            )}
            {!hasSimilarSearch && similarAgents.length === 0 && (
              <span className="ml-1.5 text-muted-foreground/40 text-[9px]">--</span>
            )}
            {activeTab === "similar" && (
              <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-primary" />
            )}
          </button>
        </div>
      )}

      {/* Agent Grid */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "exact" ? (
          <AgentGrid agents={exactAgents} />
        ) : (
          similarAgents.length > 0 ? (
            <AgentGrid agents={similarAgents} />
          ) : hasSimilarSearch ? (
            <div className="flex flex-col items-center justify-center p-8 gap-3">
              <RadarSpinner />
              <span className="font-mono-display text-[9px] tracking-[0.2em] uppercase text-muted-foreground">
                SCANNING FOR VARIANTS...
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-center p-8">
              <p className="font-mono-display text-[9px] tracking-[0.2em] uppercase text-muted-foreground/40 text-center">
                VARIANT RESULTS WILL APPEAR IF EXACT MATCHES ARE NOT FOUND
              </p>
            </div>
          )
        )}
      </div>

      {/* Best Deal */}
      {phase === "complete" && (
        <BestDeal agents={agents} originalPrice={originalPrice} />
      )}

      {/* Idle state */}
      {phase === "idle" && hasKeys && (
        <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4">
          <div className="font-mono-display text-[11px] tracking-[0.25em] uppercase text-primary">
            ▸ AWAITING MISSION DIRECTIVE
          </div>
          <p className="font-mono-display text-[9px] tracking-wider uppercase text-muted-foreground text-center leading-relaxed">
            NAVIGATE TO A TARGET SITE AND CLICK<br />
            <span className="text-primary">DISPATCH PROBES</span> TO BEGIN
          </p>
          <div className="mt-2 font-mono-display text-[8px] tracking-[0.2em] uppercase text-muted-foreground/40 text-center leading-relaxed">
            COMPATIBLE TARGETS:<br />
            AMAZON ▪ EBAY ▪ TARGET ▪ BEST BUY<br />
            BEST BUY ▪ NEWEGG ▪ COSTCO ▪ ETSY
          </div>
        </div>
      )}

      {/* Footer chrome */}
      <div className="px-3 py-1.5 border-t border-border bg-surface">
        <span className="font-mono-display text-[8px] tracking-[0.3em] uppercase text-muted-foreground/40">
          FLASHYAI v1.0 ▪ MISSION CONTROL ▪ FLIGHT OPS
        </span>
      </div>
    </div>
  )
}

export default SidePanel
