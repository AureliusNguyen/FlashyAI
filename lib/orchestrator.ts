import { extractIntent } from "./featherless"
import { dispatchAgents } from "./tinyfish"
import type { AgentGoal, AgentResult, AgentState, IntentResponse, PageCapture } from "./types"

export interface OrchestratorCallbacks {
  onIntentExtracted: (intent: string, product: string) => void
  onAgentUpdate: (agents: AgentState[]) => void
  onComplete: (agents: AgentState[]) => void
  onError: (error: string) => void
}

const TARGET_SITES = [
  { name: "Amazon", url: "https://www.amazon.com" },
  { name: "Walmart", url: "https://www.walmart.com" },
  { name: "eBay", url: "https://www.ebay.com" },
  { name: "Target", url: "https://www.target.com" }
]

/**
 * Try to extract product name directly from page title/URL
 * without calling an LLM. Works for major retailer product pages.
 */
function tryFastExtract(capture: PageCapture): IntentResponse | null {
  const { url, title, html } = capture
  const hostname = new URL(url).hostname.replace("www.", "")

  // Extract product name from page title (most retailers use "Product Name - Site" or "Product Name : Site")
  let product = title
    .replace(/Amazon\.com:\s*/i, "")
    .replace(/\s*[-|:].*(Amazon|Walmart|Target|eBay|Best Buy|Newegg).*$/i, "")
    .replace(/\s*\|.*$/, "")
    .replace(/\s*-\s*(Walmart|Target|eBay|Best Buy|Newegg).*$/i, "")
    .trim()

  if (!product || product.length < 3) return null

  // Try to extract price from HTML
  const priceMatch = html?.match(/\$[\d,]+\.?\d{0,2}/)?.[0] || ""

  console.log("[FlashyAI:FastExtract] Extracted from title:", { product, price: priceMatch, hostname })

  // Filter out the source site
  const filteredSites = TARGET_SITES.filter(
    (s) => !new URL(s.url).hostname.replace("www.", "").includes(hostname)
  )

  // Generate goals directly — no LLM needed
  const agentGoals: AgentGoal[] = filteredSites.map((site) => ({
    site: site.name,
    url: site.url,
    goal: `Search for '${product}'. Find the product listing that best matches this product. Extract the product name, price, availability, and URL of the product page. Return a JSON object with these fields: {"product": "name", "price": "$XX.XX", "available": true/false, "url": "https://..."}`
  }))

  return {
    intent: {
      type: "product_search",
      product,
      attributes: {},
      currentPrice: priceMatch,
      sourceSite: hostname
    },
    agentGoals
  }
}

/**
 * Full orchestration pipeline:
 * PageCapture → Fast extract OR Featherless (intent) → TinyFish agents (parallel) → Results
 */
export async function orchestrate(
  capture: PageCapture,
  featherlessKey: string,
  tinyfishKey: string,
  callbacks: OrchestratorCallbacks
): Promise<void> {
  console.log("[FlashyAI:Orchestrator] === PIPELINE START ===")

  // Step 1: Try fast extraction first, fall back to Featherless LLM
  let intentResponse: IntentResponse | null = null

  // Fast path: extract product from page title directly (skips LLM, saves ~3-5s)
  intentResponse = tryFastExtract(capture)

  if (intentResponse) {
    console.log("[FlashyAI:Orchestrator] Step 1/4: FAST PATH — extracted from title:", intentResponse.intent.product)
    callbacks.onIntentExtracted(intentResponse.intent.type, intentResponse.intent.product)
  } else {
    // Slow path: use Featherless LLM
    console.log("[FlashyAI:Orchestrator] Step 1/4: Fast extract failed, using Featherless LLM...")
    try {
      intentResponse = await extractIntent(featherlessKey, capture)
      console.log("[FlashyAI:Orchestrator] Step 1/4 DONE (LLM). Product:", intentResponse.intent.product)
      callbacks.onIntentExtracted(intentResponse.intent.type, intentResponse.intent.product)
    } catch (err) {
      console.error("[FlashyAI:Orchestrator] Step 1/4 FAILED:", err)
      callbacks.onError(`Intent extraction failed: ${err}`)
      return
    }
  }

  // Step 2: Initialize agent states
  console.log("[FlashyAI:Orchestrator] Step 2/4: Initializing", intentResponse.agentGoals.length, "agents")
  const agents: AgentState[] = intentResponse.agentGoals.map((goal, i) => ({
    id: `agent-${i}`,
    site: goal.site,
    status: "queued" as const
  }))
  callbacks.onAgentUpdate([...agents])

  // Step 3: Dispatch parallel TinyFish agents
  console.log("[FlashyAI:Orchestrator] Step 3/4: Dispatching TinyFish agents in parallel...")
  console.log("[FlashyAI:Orchestrator] Goals:", intentResponse.agentGoals.map(g => ({
    site: g.site,
    url: g.url,
    goal: g.goal.slice(0, 100) + "..."
  })))

  const { promise } = dispatchAgents(
    tinyfishKey,
    intentResponse.agentGoals,
    (siteId, update) => {
      const agent = agents.find((a) => a.site === siteId)
      if (agent) {
        console.log(`[FlashyAI:Orchestrator] Agent update: ${siteId} → ${update.status || ""}`, {
          hasStreamingUrl: !!update.streamingUrl,
          hasResult: !!update.result,
          hasError: !!update.error
        })
        if (update.status) agent.status = update.status as AgentState["status"]
        if (update.streamingUrl) agent.streamingUrl = update.streamingUrl
        if (update.result) agent.result = update.result
        if (update.error) agent.error = update.error
        callbacks.onAgentUpdate([...agents])
      } else {
        console.warn(`[FlashyAI:Orchestrator] No agent found for siteId: "${siteId}". Known sites:`, agents.map(a => a.site))
      }
    }
  )

  // Step 4: Wait for all to complete
  console.log("[FlashyAI:Orchestrator] Step 4/4: Waiting for all agents to finish...")
  try {
    await promise
    console.log("[FlashyAI:Orchestrator] === PIPELINE COMPLETE ===", agents.map(a => ({
      site: a.site,
      status: a.status,
      price: a.result?.price,
      error: a.error
    })))
    callbacks.onComplete([...agents])
  } catch (err) {
    console.error("[FlashyAI:Orchestrator] Promise.all failed:", err)
    callbacks.onError(`Agent dispatch failed: ${err}`)
  }
}

/**
 * Find the best deal among completed agents.
 */
export function findBestDeal(
  agents: AgentState[]
): { site: string; price: number; result: AgentResult } | null {
  let best: { site: string; price: number; result: AgentResult } | null = null

  for (const agent of agents) {
    if (agent.status !== "complete" || !agent.result?.price) continue

    const priceStr = agent.result.price.replace(/[^0-9.]/g, "")
    const price = parseFloat(priceStr)
    if (isNaN(price)) continue

    if (!best || price < best.price) {
      best = { site: agent.site, price, result: agent.result }
    }
  }

  return best
}
