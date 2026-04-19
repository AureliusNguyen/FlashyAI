import type { AgentGoal, AgentResult } from "./types"

const ENDPOINT = "https://agent.tinyfish.ai/v1/automation/run-sse"

export interface TinyFishCallbacks {
  onStreamingUrl?: (url: string) => void
  onStep?: (step: string) => void
  onComplete?: (result: AgentResult) => void
  onError?: (error: string) => void
}

/**
 * Run a single TinyFish agent with SSE streaming.
 * Pattern from tinyfish-cookbook/bestbet/app/webagent.ts
 */
export async function runTinyFishAgent(
  apiKey: string,
  goal: AgentGoal,
  callbacks?: TinyFishCallbacks
): Promise<AgentResult | null> {
  console.log(`[FlashyAI:TinyFish] Starting agent for ${goal.site}`, {
    url: goal.url,
    goalLength: goal.goal.length,
    goalPreview: goal.goal.slice(0, 100)
  })

  let response: Response
  try {
    console.log(`[FlashyAI:TinyFish] [${goal.site}] Sending POST to ${ENDPOINT}...`)
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url: goal.url,
        goal: goal.goal,
        browser_profile: "stealth"
      })
    })
    console.log(`[FlashyAI:TinyFish] [${goal.site}] Response status: ${response.status} ${response.statusText}`)
  } catch (err) {
    console.error(`[FlashyAI:TinyFish] [${goal.site}] Fetch failed:`, err)
    callbacks?.onError?.(`Network error for ${goal.site}: ${err}`)
    return null
  }

  if (!response.ok) {
    const errText = await response.text()
    console.error(`[FlashyAI:TinyFish] [${goal.site}] API error:`, response.status, errText)
    callbacks?.onError?.(`TinyFish API error ${response.status}: ${errText}`)
    return null
  }

  const reader = response.body?.getReader()
  if (!reader) {
    console.error(`[FlashyAI:TinyFish] [${goal.site}] No response body`)
    callbacks?.onError?.("No response body from TinyFish")
    return null
  }

  console.log(`[FlashyAI:TinyFish] [${goal.site}] SSE stream opened, reading chunks...`)
  const decoder = new TextDecoder()
  let result: AgentResult | null = null
  let chunkCount = 0
  let eventCount = 0
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        console.log(`[FlashyAI:TinyFish] [${goal.site}] Stream ended. Chunks: ${chunkCount}, Events: ${eventCount}`)
        break
      }

      chunkCount++
      const chunk = decoder.decode(value, { stream: true })
      buffer += chunk

      // Split on double newline (SSE event boundary) or single newline
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? "" // keep incomplete last line in buffer

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue

        const rawData = line.slice(6).trim()
        if (!rawData) continue

        try {
          const data = JSON.parse(rawData)
          eventCount++

          // TinyFish uses snake_case in SSE events — normalize
          const streamingUrl = data.streaming_url || data.streamingUrl
          const resultData = data.result_json || data.resultJson || data.result
          const message = data.message || data.step || data.description || data.progress

          console.log(`[FlashyAI:TinyFish] [${goal.site}] SSE event #${eventCount}:`, {
            type: data.type,
            hasStreamingUrl: !!streamingUrl,
            hasResult: !!resultData,
            keys: Object.keys(data)
          })

          if (data.type === "STREAMING_URL" && streamingUrl) {
            console.log(`[FlashyAI:TinyFish] [${goal.site}] Got streaming URL:`, streamingUrl)
            callbacks?.onStreamingUrl?.(streamingUrl)
          } else if (data.type === "STEP" || data.type === "PROGRESS") {
            const msg = message || "Working..."
            console.log(`[FlashyAI:TinyFish] [${goal.site}] Step:`, msg)
            callbacks?.onStep?.(msg)
          } else if (data.type === "COMPLETE") {
            // TinyFish returns result in various fields — try them all
            const rawResult = resultData || data.output || data.data || data
            console.log(`[FlashyAI:TinyFish] [${goal.site}] COMPLETE. Raw result:`, JSON.stringify(rawResult).slice(0, 500))
            result = parseResult(rawResult)
            console.log(`[FlashyAI:TinyFish] [${goal.site}] Parsed result:`, result)
            callbacks?.onComplete?.(result)
          } else if (data.type === "ERROR") {
            console.error(`[FlashyAI:TinyFish] [${goal.site}] ERROR event:`, data)
            callbacks?.onError?.(data.message || data.error || "Agent failed")
          } else if (data.type === "STARTED" || data.type === "HEARTBEAT") {
            console.log(`[FlashyAI:TinyFish] [${goal.site}] ${data.type} (ignored)`)
          } else {
            console.log(`[FlashyAI:TinyFish] [${goal.site}] Unknown event type: "${data.type}"`, data)
          }
        } catch (parseErr) {
          console.warn(`[FlashyAI:TinyFish] [${goal.site}] Failed to parse SSE line:`, rawData.slice(0, 200), parseErr)
        }
      }
    }
  } catch (err) {
    console.error(`[FlashyAI:TinyFish] [${goal.site}] Stream read error:`, err)
    callbacks?.onError?.(`Stream error for ${goal.site}: ${err}`)
  }

  if (!result) {
    console.warn(`[FlashyAI:TinyFish] [${goal.site}] Stream ended with no result. Chunks: ${chunkCount}, Events: ${eventCount}`)
    // Stream ended without a COMPLETE event — treat as not found
    callbacks?.onError?.(`No result from ${goal.site} (session ended)`)
  }

  return result
}

/**
 * Flatten a nested TinyFish result into a flat key-value map.
 * TinyFish returns varied formats like:
 *   { best_match: "...", details: { price: "$29", url: "..." } }
 *   { product: "...", price: "$29" }
 *   { results: [{ name: "...", price: "$29" }] }
 */
function flattenObj(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const flat: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (val && typeof val === "object" && !Array.isArray(val)) {
      Object.assign(flat, flattenObj(val as Record<string, unknown>, fullKey))
    } else if (Array.isArray(val) && val.length > 0 && typeof val[0] === "object") {
      // Take first array element (e.g., results[0])
      Object.assign(flat, flattenObj(val[0] as Record<string, unknown>, fullKey))
    } else {
      flat[fullKey] = val
      flat[key] = val // also store without prefix for key matching
    }
  }
  return flat
}

function parseResult(raw: unknown): AgentResult {
  if (!raw) return { raw }

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed === "object") return parseResult(parsed)
    } catch {
      const priceMatch = raw.match(/\$[\d,]+\.?\d*/)?.[0]
      return { product: raw.slice(0, 100), price: priceMatch || "", raw }
    }
  }

  if (typeof raw !== "object") return { raw }

  // Flatten nested objects so we can find fields regardless of nesting
  const flat = flattenObj(raw as Record<string, unknown>)

  // Search for price
  let price = ""
  const priceKeys = ["price", "cost", "current_price", "currentPrice", "sale_price", "salePrice", "list_price", "retail_price"]
  for (const key of priceKeys) {
    const val = flat[key]
    if (val && String(val) !== "undefined" && String(val) !== "null" && String(val) !== "" && String(val) !== "N/A") {
      price = String(val)
      // Ensure it looks like a price
      if (!price.includes("$")) {
        const num = parseFloat(price.replace(/[^0-9.]/g, ""))
        if (!isNaN(num)) price = `$${num.toFixed(2)}`
      }
      break
    }
  }
  // Fallback: scan all values for a dollar amount
  if (!price) {
    for (const val of Object.values(flat)) {
      if (typeof val === "string") {
        const match = val.match(/\$[\d,]+\.?\d*/)
        if (match) { price = match[0]; break }
      }
    }
  }

  // Search for product name
  const nameKeys = ["product", "name", "title", "product_name", "productName", "item", "item_name", "best_match", "match", "description"]
  let product = ""
  for (const key of nameKeys) {
    const val = flat[key]
    if (val && typeof val === "string" && val !== "undefined" && val !== "") {
      product = val
      break
    }
  }

  // Search for URL
  let url = ""
  for (const val of Object.values(flat)) {
    if (typeof val === "string" && val.startsWith("http")) {
      url = val
      break
    }
  }

  const available = flat.available !== false && flat.in_stock !== false && flat.inStock !== false && flat.exact_match !== false

  console.log(`[FlashyAI:TinyFish] parseResult:`, { product, price, available, url, rawKeys: Object.keys(flat) })

  return { product, price, available, url, raw }
}

// Exported for testing
export { parseResult, flattenObj }

/**
 * Dispatch multiple agents in parallel.
 */
export function dispatchAgents(
  apiKey: string,
  goals: AgentGoal[],
  onUpdate: (siteId: string, update: Partial<{
    status: string
    streamingUrl: string
    result: AgentResult
    error: string
  }>) => void
): { promise: Promise<(AgentResult | null)[]> } {
  console.log(`[FlashyAI:TinyFish] Dispatching ${goals.length} agents:`, goals.map(g => g.site))

  const promises = goals.map((goal) => {
    onUpdate(goal.site, { status: "connecting" })

    return runTinyFishAgent(apiKey, goal, {
      onStreamingUrl: (url) => {
        console.log(`[FlashyAI:TinyFish] [${goal.site}] → streaming`)
        onUpdate(goal.site, { status: "streaming", streamingUrl: url })
      },
      onStep: (step) => {
        console.log(`[FlashyAI:TinyFish] [${goal.site}] → step: ${step}`)
      },
      onComplete: (result) => {
        console.log(`[FlashyAI:TinyFish] [${goal.site}] → complete:`, result?.price)
        onUpdate(goal.site, { status: "complete", result })
      },
      onError: (error) => {
        console.error(`[FlashyAI:TinyFish] [${goal.site}] → error:`, error)
        onUpdate(goal.site, { status: "error", error })
      }
    })
  })

  return {
    promise: Promise.all(promises)
  }
}
