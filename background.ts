import { orchestrate } from "./lib/orchestrator"
import type { AgentState, PageCapture } from "./lib/types"

export {}

// Auto-load API keys from build-time env vars into chrome.storage on install
chrome.runtime.onInstalled.addListener(() => {
  // @ts-ignore — Plasmo replaces process.env at build time
  const tinyfishKey: string = process.env.PLASMO_PUBLIC_TINYFISH_API_KEY || ""
  // @ts-ignore — Plasmo replaces process.env at build time
  const featherlessKey: string = process.env.PLASMO_PUBLIC_FEATHERLESS_API_KEY || ""
  console.log("[FlashyAI:BG] Extension installed. Keys from env:", {
    hasTinyfish: !!tinyfishKey,
    hasFeatherless: !!featherlessKey
  })
  if (tinyfishKey || featherlessKey) {
    chrome.storage.local.set({ tinyfishKey, featherlessKey })
    console.log("[FlashyAI:BG] API keys saved to storage")
  }
})

// Open side panel when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })

// Listen for messages from content script and side panel
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("[FlashyAI:BG] Message received:", message.type)

  if (message.type === "FLASH_IT") {
    handleFlashIt(message.payload as PageCapture)
    sendResponse({ ok: true })
  }

  if (message.type === "GET_KEYS") {
    chrome.storage.local.get(["tinyfishKey", "featherlessKey"], (result) => {
      sendResponse(result)
    })
    return true // async response
  }

  return false
})

// Session ID to cancel stale orchestrations when user re-dispatches
let currentSessionId = 0

async function handleFlashIt(capture: PageCapture) {
  const sessionId = ++currentSessionId
  console.log("[FlashyAI:BG] handleFlashIt called (session", sessionId, "):", {
    url: capture.url,
    title: capture.title,
    htmlLength: capture.html?.length,
    eventCount: capture.events?.length
  })

  // Helper: only broadcast if this session is still current
  const safeBroadcast = (message: { type: string; payload?: unknown }) => {
    if (sessionId !== currentSessionId) {
      console.log("[FlashyAI:BG] Stale session", sessionId, "— ignoring", message.type)
      return
    }
    broadcast(message)
  }

  const keys = await chrome.storage.local.get(["tinyfishKey", "featherlessKey"])

  if (!keys.tinyfishKey || !keys.featherlessKey) {
    safeBroadcast({ type: "ERROR", payload: "API keys not configured." })
    return
  }

  safeBroadcast({
    type: "ORCHESTRATION_START",
    payload: { url: capture.url, title: capture.title }
  })

  console.log("[FlashyAI:BG] Starting orchestration (session", sessionId, ")...")
  await orchestrate(capture, keys.featherlessKey, keys.tinyfishKey, {
    onIntentExtracted: (type, product) => {
      safeBroadcast({ type: "INTENT_EXTRACTED", payload: { type, product } })
    },
    onSimilarSearchStart: () => {
      safeBroadcast({ type: "SIMILAR_SEARCH_START", payload: {} })
    },
    onAgentUpdate: (agents: AgentState[]) => {
      safeBroadcast({ type: "AGENT_UPDATE", payload: agents })
    },
    onComplete: (agents: AgentState[]) => {
      console.log("[FlashyAI:BG] Orchestration complete (session", sessionId, "):", agents.map(a => ({
        site: a.site, status: a.status, price: a.result?.price
      })))
      safeBroadcast({ type: "ORCHESTRATION_COMPLETE", payload: agents })
    },
    onError: (error: string) => {
      console.error("[FlashyAI:BG] Orchestration error:", error)
      safeBroadcast({ type: "ERROR", payload: error })
    }
  })
}

function broadcast(message: { type: string; payload?: unknown }) {
  console.log("[FlashyAI:BG] Broadcasting:", message.type)
  chrome.runtime.sendMessage(message).catch(() => {
    // Side panel may not be open — ignore
  })
}
