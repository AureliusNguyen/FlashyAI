import { orchestrate } from "./lib/orchestrator"
import type { AgentState, PageCapture } from "./lib/types"

export {}

// Auto-load API keys from build-time env vars into chrome.storage on install
chrome.runtime.onInstalled.addListener(() => {
  const tinyfishKey = process.env.PLASMO_PUBLIC_TINYFISH_API_KEY || ""
  const featherlessKey = process.env.PLASMO_PUBLIC_FEATHERLESS_API_KEY || ""
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

async function handleFlashIt(capture: PageCapture) {
  console.log("[FlashyAI:BG] handleFlashIt called:", {
    url: capture.url,
    title: capture.title,
    htmlLength: capture.html?.length,
    eventCount: capture.events?.length
  })

  // Get API keys from storage
  const keys = await chrome.storage.local.get(["tinyfishKey", "featherlessKey"])
  console.log("[FlashyAI:BG] API keys loaded:", {
    hasTinyfish: !!keys.tinyfishKey,
    hasFeatherless: !!keys.featherlessKey
  })

  if (!keys.tinyfishKey || !keys.featherlessKey) {
    broadcast({
      type: "ERROR",
      payload: "API keys not configured. Click the extension icon and go to Settings."
    })
    return
  }

  broadcast({
    type: "ORCHESTRATION_START",
    payload: { url: capture.url, title: capture.title }
  })

  console.log("[FlashyAI:BG] Starting orchestration...")
  await orchestrate(capture, keys.featherlessKey, keys.tinyfishKey, {
    onIntentExtracted: (type, product) => {
      console.log("[FlashyAI:BG] Intent extracted:", { type, product })
      broadcast({
        type: "INTENT_EXTRACTED",
        payload: { type, product }
      })
    },
    onAgentUpdate: (agents: AgentState[]) => {
      console.log("[FlashyAI:BG] Agent update:", agents.map(a => `${a.site}:${a.status}`))
      broadcast({
        type: "AGENT_UPDATE",
        payload: agents
      })
    },
    onComplete: (agents: AgentState[]) => {
      console.log("[FlashyAI:BG] Orchestration complete:", agents.map(a => ({
        site: a.site,
        status: a.status,
        price: a.result?.price
      })))
      broadcast({
        type: "ORCHESTRATION_COMPLETE",
        payload: agents
      })
    },
    onError: (error: string) => {
      console.error("[FlashyAI:BG] Orchestration error:", error)
      broadcast({
        type: "ERROR",
        payload: error
      })
    }
  })
}

function broadcast(message: { type: string; payload?: unknown }) {
  console.log("[FlashyAI:BG] Broadcasting:", message.type)
  chrome.runtime.sendMessage(message).catch(() => {
    // Side panel may not be open — ignore
  })
}
