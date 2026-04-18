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
        goal: goal.goal
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
            console.log(`[FlashyAI:TinyFish] [${goal.site}] COMPLETE. Raw result:`, resultData)
            result = parseResult(resultData)
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
  }

  return result
}

function parseResult(raw: unknown): AgentResult {
  if (!raw || typeof raw !== "object") {
    return { raw }
  }

  const obj = raw as Record<string, unknown>
  return {
    product: String(obj.product || obj.name || obj.title || ""),
    price: String(obj.price || obj.cost || ""),
    available: obj.available !== false && obj.in_stock !== false,
    url: String(obj.url || obj.link || ""),
    raw
  }
}

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
): { promise: Promise<(AgentResult | null)[]>; abort: () => void } {
  const controller = new AbortController()

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
    promise: Promise.all(promises),
    abort: () => controller.abort()
  }
}
