import React, { useCallback, useEffect, useMemo, useState } from "react"
import { AgentGrid } from "./components/AgentGrid"
import { BestDeal } from "./components/BestDeal"
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

  // Filter agents by tab
  const exactAgents = useMemo(() => agents.filter(a => a.matchType === "exact"), [agents])
  const similarAgents = useMemo(() => agents.filter(a => a.matchType === "similar"), [agents])

  const exactFoundCount = useMemo(() => exactAgents.filter(a => a.status === "complete").length, [exactAgents])
  const similarFoundCount = useMemo(() => similarAgents.filter(a => a.status === "complete").length, [similarAgents])

  // Auto-switch to similar tab when similar search starts
  useEffect(() => {
    if (hasSimilarSearch && exactFoundCount === 0 && similarAgents.length > 0) {
      setActiveTab("similar")
    }
  }, [hasSimilarSearch, exactFoundCount, similarAgents.length])

  // Check for API keys on mount
  useEffect(() => {
    chrome.storage.local.get(["tinyfishKey", "featherlessKey"], (result) => {
      setHasKeys(!!result.tinyfishKey && !!result.featherlessKey)
    })
  }, [])

  // Listen for messages from service worker
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
    console.log("[FlashyAI:SidePanel] Flash It! clicked")

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      console.log("[FlashyAI:SidePanel] Active tab:", tab?.id, tab?.url)

      if (!tab?.id) {
        setError("No active tab found")
        setPhase("error")
        return
      }

      const url = tab.url || ""
      if (url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("about:") || url === "") {
        setError("Cannot capture Chrome internal pages. Navigate to a product page first (e.g. Amazon, Best Buy, etc.).")
        setPhase("error")
        return
      }

      const hostname = new URL(url).hostname.replace("www.", "")
      const SUPPORTED_SITES = [
        "amazon.com", "walmart.com", "ebay.com", "target.com",
        "bestbuy.com", "newegg.com", "costco.com", "homedepot.com",
        "etsy.com", "aliexpress.com", "zappos.com", "nordstrom.com",
        "macys.com", "nike.com", "adidas.com"
      ]
      const isProductSite = SUPPORTED_SITES.some(s => hostname.includes(s))

      if (!isProductSite) {
        setError(
          `"${hostname}" isn't a recognized shopping site.\n\nTry visiting a product page on Amazon, Walmart, eBay, Target, Best Buy, or other major retailers, then click Flash It!`
        )
        setPhase("error")
        return
      }

      let capture
      try {
        capture = await chrome.tabs.sendMessage(tab.id, { type: "REQUEST_CAPTURE" })
      } catch {
        console.log("[FlashyAI:SidePanel] Content script not found, falling back...")
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
        setError("Could not capture page. Try refreshing the page and clicking Flash It! again.")
        setPhase("error")
        return
      }

      console.log("[FlashyAI:SidePanel] Captured page:", {
        url: capture.url,
        title: capture.title,
        htmlLength: capture.html?.length,
        events: capture.events?.length
      })

      if (capture.html) {
        const priceMatch = capture.html.match(/\$[\d,]+\.?\d*/)?.[0]
        if (priceMatch) {
          setOriginalPrice(priceMatch)
        }
      }

      chrome.runtime.sendMessage({ type: "FLASH_IT", payload: capture })
    } catch (err) {
      console.error("[FlashyAI:SidePanel] Capture error:", err)
      setError(`Capture failed: ${err}`)
      setPhase("error")
    }
  }, [])

  const isWorking = phase === "capturing" || phase === "extracting" || phase === "running"
  const showTabs = agents.length > 0

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center gap-2 mb-3">
          <div className="text-xl font-bold bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
            FlashyAI
          </div>
          <div className="text-xs text-zinc-500">v0.1</div>
        </div>

        {!hasKeys ? (
          <div className="p-3 rounded-lg bg-yellow-900/20 border border-yellow-800/50 text-sm text-yellow-300">
            <p className="font-medium mb-1">API keys needed</p>
            <p className="text-xs text-yellow-400/70">
              Right-click the extension icon &rarr; Options to configure your TinyFish and Featherless API keys.
            </p>
          </div>
        ) : (
          <button
            onClick={handleFlashIt}
            disabled={isWorking}
            className={`w-full py-3 px-4 rounded-lg font-semibold text-sm transition-all ${
              isWorking
                ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                : "bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 text-white shadow-lg shadow-violet-500/20"
            }`}
          >
            {phase === "capturing" ? "Capturing page..." :
             phase === "extracting" ? "Understanding intent..." :
             phase === "running" ? "Agents working..." :
             "Flash It!"}
          </button>
        )}
      </div>

      {/* Status */}
      {product && (
        <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
          <div className="text-xs text-zinc-500">Looking for</div>
          <div className="text-sm text-zinc-200 font-medium">{product}</div>
          {originalPrice && (
            <div className="text-xs text-zinc-400 mt-0.5">
              Current price: {originalPrice}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-3 mt-3 p-3 rounded-lg bg-red-900/20 border border-red-800/50 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Tabs */}
      {showTabs && (
        <div className="flex border-b border-zinc-800">
          <button
            onClick={() => setActiveTab("exact")}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors relative ${
              activeTab === "exact"
                ? "text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Exact Match
            {exactFoundCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 text-[10px]">
                {exactFoundCount}
              </span>
            )}
            {activeTab === "exact" && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-gradient-to-r from-violet-500 to-cyan-500 rounded-full" />
            )}
          </button>
          <button
            onClick={() => setActiveTab("similar")}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors relative ${
              activeTab === "similar"
                ? "text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Similar
            {similarFoundCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-400 text-[10px]">
                {similarFoundCount}
              </span>
            )}
            {!hasSimilarSearch && similarAgents.length === 0 && (
              <span className="ml-1.5 text-zinc-600 text-[10px]">--</span>
            )}
            {activeTab === "similar" && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-gradient-to-r from-violet-500 to-cyan-500 rounded-full" />
            )}
          </button>
        </div>
      )}

      {/* Agent Grid (filtered by tab) */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "exact" ? (
          <AgentGrid agents={exactAgents} />
        ) : (
          similarAgents.length > 0 ? (
            <AgentGrid agents={similarAgents} />
          ) : hasSimilarSearch ? (
            <div className="flex items-center justify-center p-8">
              <div className="flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-zinc-600 border-t-violet-400 rounded-full animate-spin" />
                <span className="text-xs text-zinc-500">Searching for alternatives...</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center p-8">
              <p className="text-xs text-zinc-600 text-center">
                Similar products will appear here if exact matches aren't found.
              </p>
            </div>
          )
        )}
      </div>

      {/* Best Deal Banner */}
      {phase === "complete" && (
        <BestDeal agents={agents} originalPrice={originalPrice} />
      )}

      {/* Idle state */}
      {phase === "idle" && hasKeys && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <div className="text-4xl mb-3">⚡</div>
            <p className="text-sm text-zinc-400 mb-3">
              Navigate to a product page on a supported site, then click <span className="text-violet-400 font-medium">Flash It!</span> to
              compare prices across the web.
            </p>
            <div className="text-xs text-zinc-600 space-y-1">
              <p className="text-zinc-500 font-medium">Supported sites:</p>
              <p>Amazon, Walmart, eBay, Target, Best Buy, Newegg, Costco, Etsy, Nike, Adidas & more</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SidePanel
