import type { PlasmoCSConfig } from "plasmo"
import type { DOMEvent, PageCapture } from "../lib/types"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_idle"
}

console.log("[FlashyAI:Content] Content script loaded on:", window.location.href)

const recentEvents: DOMEvent[] = []
const MAX_EVENTS = 50

// Track clicks
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement
  if (!target) return

  recentEvents.push({
    type: "click",
    selector: getSelector(target),
    text: target.innerText?.slice(0, 100) || "",
    timestamp: Date.now()
  })

  if (recentEvents.length > MAX_EVENTS) recentEvents.shift()
}, true)

// Track inputs
document.addEventListener("input", (e) => {
  const target = e.target as HTMLInputElement
  if (!target) return

  recentEvents.push({
    type: "input",
    selector: getSelector(target),
    text: target.placeholder || target.name || "",
    value: target.value,
    timestamp: Date.now()
  })

  if (recentEvents.length > MAX_EVENTS) recentEvents.shift()
}, true)

// Listen for FLASH_IT request from side panel
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("[FlashyAI:Content] Message received:", message.type)
  if (message.type === "REQUEST_CAPTURE") {
    const capture = capturePageState()
    console.log("[FlashyAI:Content] Captured:", {
      url: capture.url,
      title: capture.title,
      htmlLength: capture.html.length,
      eventCount: capture.events.length
    })
    sendResponse(capture)
  }
  return false
})

function capturePageState(): PageCapture {
  // Try to find the main product/content area
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
    html: productArea?.innerHTML?.slice(0, 5000) || document.body.innerHTML.slice(0, 5000),
    events: [...recentEvents],
    timestamp: Date.now()
  }
}

function getSelector(el: HTMLElement): string {
  if (el.id) return `#${el.id}`
  if (el.className && typeof el.className === "string") {
    const classes = el.className.trim().split(/\s+/).slice(0, 2).join(".")
    return `${el.tagName.toLowerCase()}.${classes}`
  }
  return el.tagName.toLowerCase()
}
