import type { PlasmoCSConfig } from "plasmo"
import type { DOMEvent, PageCapture } from "../lib/types"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_idle"
}

console.log("[FlashyAI:Content] Content script loaded on:", window.location.href)

const recentEvents: DOMEvent[] = []
const MAX_EVENTS = 20 // Only keep the last 20 meaningful events

// Tags that are never meaningful to capture
const IGNORE_TAGS = new Set(["HTML", "BODY", "SCRIPT", "STYLE", "SVG", "PATH", "IFRAME"])

// Only track clicks on interactive / meaningful elements
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement
  if (!target) return
  if (IGNORE_TAGS.has(target.tagName)) return

  // Skip clicks on empty or purely decorative elements
  const text = target.innerText?.trim().slice(0, 100) || ""
  const isInteractive = target.closest("a, button, [role='button'], input, select, [onclick]")
  const hasText = text.length > 0

  // Only capture if it's an interactive element or has meaningful text
  if (!isInteractive && !hasText) return

  recentEvents.push({
    type: "click",
    selector: getSelector(target),
    text,
    timestamp: Date.now()
  })

  if (recentEvents.length > MAX_EVENTS) recentEvents.shift()
}, true)

// Track search inputs and form fields — debounced to avoid capturing every keystroke
let inputTimer: ReturnType<typeof setTimeout> | null = null
document.addEventListener("input", (e) => {
  const target = e.target as HTMLInputElement
  if (!target) return

  // Only track actual text inputs, not checkboxes/radios/sliders
  if (target.type && !["text", "search", "email", "url", "number", "tel", ""].includes(target.type)) return

  // Debounce: wait 500ms after the user stops typing
  if (inputTimer) clearTimeout(inputTimer)
  inputTimer = setTimeout(() => {
    const value = target.value?.trim()
    if (!value) return // Skip empty inputs

    recentEvents.push({
      type: "input",
      selector: getSelector(target),
      text: target.placeholder || target.name || target.ariaLabel || "",
      value,
      timestamp: Date.now()
    })

    if (recentEvents.length > MAX_EVENTS) recentEvents.shift()
  }, 500)
}, true)

// Track ALL form changes — selects, checkboxes, radios (filter interactions)
document.addEventListener("change", (e) => {
  const target = e.target as HTMLInputElement | HTMLSelectElement
  if (!target) return

  let value = ""
  let label = ""

  if (target.tagName === "SELECT") {
    const sel = target as HTMLSelectElement
    value = sel.options?.[sel.selectedIndex]?.text || sel.value
    label = sel.name || sel.ariaLabel || ""
  } else if (target.tagName === "INPUT") {
    const inp = target as HTMLInputElement
    if (inp.type === "checkbox" || inp.type === "radio") {
      // Find the label for this checkbox/radio
      const labelEl = inp.labels?.[0] || inp.closest("label") || inp.parentElement
      label = labelEl?.textContent?.trim().slice(0, 80) || inp.name || ""
      value = inp.checked ? label : `unchecked: ${label}`
    } else {
      return // text inputs handled by debounced input handler
    }
  } else {
    return
  }

  recentEvents.push({
    type: "select",
    selector: getSelector(target),
    text: label,
    value,
    timestamp: Date.now()
  })

  if (recentEvents.length > MAX_EVENTS) recentEvents.shift()
}, true)

// Listen for capture request from side panel
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("[FlashyAI:Content] Message received:", message.type)
  if (message.type === "REQUEST_CAPTURE") {
    const capture = capturePageState()
    console.log("[FlashyAI:Content] Captured:", {
      url: capture.url,
      title: capture.title,
      htmlLength: capture.html.length,
      eventCount: capture.events.length,
      events: capture.events.map(e => `${e.type}:${e.text?.slice(0, 30) || e.value?.slice(0, 30) || "?"}`)
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
    if (classes) return `${el.tagName.toLowerCase()}.${classes}`
  }
  return el.tagName.toLowerCase()
}
