import { extractIntent } from "./featherless"
import { dispatchAgents } from "./tinyfish"
import type { AgentGoal, AgentResult, AgentState, ExtractedIntent, IntentResponse, PageCapture } from "./types"

export interface OrchestratorCallbacks {
  onIntentExtracted: (intent: string, product: string) => void
  onAgentUpdate: (agents: AgentState[]) => void
  onComplete: (agents: AgentState[]) => void
  onSimilarSearchStart: () => void
  onError: (error: string) => void
}

const TARGET_SITES = [
  { name: "Amazon", url: "https://www.amazon.com" },
  { name: "eBay", url: "https://www.ebay.com" },
  { name: "Target", url: "https://www.target.com" },
  { name: "Best Buy", url: "https://www.bestbuy.com" }
]

const BACKUP_SITES = [
  { name: "Newegg", url: "https://www.newegg.com" },
  { name: "Costco", url: "https://www.costco.com" }
]

/**
 * Try to extract product name directly from page title without LLM.
 * Used for exact match only — fast path.
 */
function tryFastExtract(capture: PageCapture): { product: string; price: string; hostname: string } | null {
  const { url, title, html } = capture
  const hostname = new URL(url).hostname.replace("www.", "")

  let product = title
    .replace(/Amazon\.com:\s*/i, "")
    .replace(/\s*[-|:].*(Amazon|Target|eBay|Best Buy|Newegg|Costco).*$/i, "")
    .replace(/\s*\|.*$/, "")
    .replace(/\s*-\s*(Walmart|Target|eBay|Best Buy|Newegg).*$/i, "")
    .trim()

  if (!product || product.length < 3) return null

  const priceMatch = html?.match(/\$[\d,]+\.?\d{0,2}/)?.[0] || ""

  console.log("[FlashyAI:FastExtract] Extracted from title:", { product, price: priceMatch, hostname })
  return { product, price: priceMatch, hostname }
}

/**
 * Build exact match goals for a product.
 */
function makeExactGoals(product: string, sourceHostname: string): AgentGoal[] {
  const filteredSites = TARGET_SITES.filter(
    (s) => !new URL(s.url).hostname.replace("www.", "").includes(sourceHostname)
  )

  return filteredSites.map((site) => ({
    site: site.name,
    url: site.url,
    goal: `Search for '${product}'. Find the EXACT same product listing. Extract the product name, price, availability, and product page URL. If the exact product is not found, return {"product": "", "price": "", "available": false, "url": ""}. If found, return {"product": "name", "price": "$XX.XX", "available": true, "url": "https://..."}`
  }))
}

/**
 * Build smart "find similar" goals using rich intent from Featherless.
 * Uses user's preferences (price range, attributes, category) to find
 * relevant alternatives, not just generic "similar to X" searches.
 */
function makeSmartSimilarGoal(
  intent: ExtractedIntent,
  site: { name: string; url: string }
): AgentGoal {
  const parts: string[] = []

  // Build a rich search description from intent
  parts.push(`I'm looking for products similar to '${intent.product}'.`)

  // Add category context
  if (intent.category) {
    parts.push(`The product category is ${intent.category}.`)
  }

  // Add attribute preferences
  const attrs = Object.entries(intent.attributes || {})
  if (attrs.length > 0) {
    const attrStr = attrs.map(([k, v]) => `${k}: ${v}`).join(", ")
    parts.push(`Preferred attributes: ${attrStr}.`)
  }

  // Add price context
  if (intent.currentPrice) {
    parts.push(`The original product was priced at ${intent.currentPrice}, so find alternatives in a similar price range.`)
  }

  parts.push(`Search this site and find the best matching alternative product. Extract the product name, price, availability, and URL. Return {"product": "name", "price": "$XX.XX", "available": true, "url": "https://..."}`)

  return {
    site: site.name,
    url: site.url,
    goal: parts.join(" ")
  }
}

/**
 * Dumb fallback for similar goals when we don't have rich intent.
 */
function makeGenericSimilarGoal(product: string, site: { name: string; url: string }): AgentGoal {
  return {
    site: site.name,
    url: site.url,
    goal: `Search for products similar to '${product}'. Find the closest alternative or related product available on this site. Extract the product name, price, availability, and URL. Return {"product": "name", "price": "$XX.XX", "available": true, "url": "https://..."}`
  }
}

/**
 * Check if an agent result means "product not found".
 */
function isNotFound(agent: AgentState): boolean {
  if (agent.status === "error") return true
  if (agent.status !== "complete") return false
  if (!agent.result) return true
  const r = agent.result
  if (r.available === false) return true
  if (!r.price || r.price === "" || r.price === "undefined") return true
  if (!r.product || r.product === "" || r.product === "undefined") return true
  return false
}

/**
 * Full orchestration pipeline with parallel fast-path + LLM:
 *
 * 1. Fast extract product name → dispatch exact match agents IMMEDIATELY
 * 2. IN PARALLEL: call Featherless to get rich intent (attributes, price range, category)
 * 3. Wait for exact match results
 * 4. Sites that return "not found" → use rich intent to generate SMART similar goals
 * 5. If ALL sites fail → expand to backup sites with smart similar goals
 */
export async function orchestrate(
  capture: PageCapture,
  featherlessKey: string,
  tinyfishKey: string,
  callbacks: OrchestratorCallbacks
): Promise<void> {
  console.log("[FlashyAI:Orchestrator] === PIPELINE START ===")

  const sourceDomain = new URL(capture.url).hostname.replace("www.", "")

  // Step 1: Fast extract for exact match (instant)
  const fastResult = tryFastExtract(capture)

  let product: string
  let basicIntent: ExtractedIntent

  if (!fastResult) {
    console.log("[FlashyAI:Orchestrator] Fast extract failed, using Featherless LLM...")
    try {
      const intentResponse = await extractIntent(featherlessKey, capture)
      product = intentResponse.intent.product
      basicIntent = intentResponse.intent
      callbacks.onIntentExtracted(intentResponse.intent.type, product)
    } catch (err) {
      console.error("[FlashyAI:Orchestrator] LLM extraction failed:", err)
      callbacks.onError(`Intent extraction failed: ${err}`)
      return
    }
  } else {
    product = fastResult.product
    basicIntent = {
      type: "product_search",
      product,
      attributes: {},
      currentPrice: fastResult.price,
      sourceSite: fastResult.hostname
    }
    callbacks.onIntentExtracted("product_search", product)
  }

  // Step 2: Build goals for BOTH exact and similar
  const exactGoals = makeExactGoals(product, sourceDomain)

  // Get rich intent — reuse if we already called Featherless (fast path failed),
  // otherwise fire in background
  let richIntentPromise: Promise<ExtractedIntent | null>
  if (!fastResult) {
    // Already have intent from the blocking LLM call above — reuse it
    richIntentPromise = Promise.resolve(basicIntent)
  } else {
    // Fast path succeeded — fire Featherless in background for rich data
    richIntentPromise = extractIntent(featherlessKey, capture)
      .then(resp => {
        console.log("[FlashyAI:Orchestrator] Featherless rich intent ready:", {
          product: resp.intent.product,
          category: resp.intent.category,
          attributes: resp.intent.attributes
        })
        return resp.intent
      })
      .catch(err => {
        console.warn("[FlashyAI:Orchestrator] Featherless failed (using generic similar):", err)
        return null
      })
  }

  // All sites for similar search (target + backup, excluding source)
  const allSimilarSites = [...TARGET_SITES, ...BACKUP_SITES].filter(
    s => !new URL(s.url).hostname.replace("www.", "").includes(sourceDomain)
  )

  // Resolve rich intent for smart similar goals
  const richIntent = (await richIntentPromise) || basicIntent
  const hasRichData = Object.keys(richIntent.attributes || {}).length > 0 || richIntent.category
  const similarGoals = allSimilarSites.map(site =>
    hasRichData
      ? makeSmartSimilarGoal(richIntent, site)
      : makeGenericSimilarGoal(richIntent.product, site)
  )

  // Step 3: Initialize ALL agents — exact + similar
  const agents: AgentState[] = [
    ...exactGoals.map((goal, i) => ({
      id: `exact-${i}`,
      site: goal.site,
      status: "queued" as const,
      matchType: "exact" as const
    })),
    ...similarGoals.map((goal, i) => ({
      id: `similar-${i}`,
      site: goal.site,
      status: "queued" as const,
      matchType: "similar" as const
    }))
  ]
  callbacks.onAgentUpdate([...agents])
  callbacks.onSimilarSearchStart()

  console.log("[FlashyAI:Orchestrator] Dispatching ALL probes in parallel:", {
    exact: exactGoals.map(g => g.site),
    similar: similarGoals.map(g => g.site)
  })

  // Helper to update agent state
  const updateAgent = (siteId: string, matchType: string, update: Partial<{ status: string; streamingUrl: string; result: AgentResult; error: string }>) => {
    const agent = agents.find(a => a.site === siteId && a.matchType === matchType)
    if (agent) {
      if (update.status) agent.status = update.status as AgentState["status"]
      if (update.streamingUrl) agent.streamingUrl = update.streamingUrl
      if (update.result) { agent.result = update.result; agent.streamingUrl = undefined }
      if (update.error) { agent.error = update.error; agent.streamingUrl = undefined }
      callbacks.onAgentUpdate([...agents])
    }
  }

  // Step 4: Dispatch BOTH exact and similar in parallel
  const { promise: exactPromise } = dispatchAgents(
    tinyfishKey, exactGoals,
    (siteId, update) => updateAgent(siteId, "exact", update)
  )

  const { promise: similarPromise } = dispatchAgents(
    tinyfishKey, similarGoals,
    (siteId, update) => updateAgent(siteId, "similar", update)
  )

  await Promise.all([exactPromise, similarPromise])

  // Mark exact not-found agents
  for (const agent of agents) {
    if (agent.matchType === "exact" && isNotFound(agent)) {
      agent.status = "not_found"
    }
  }
  callbacks.onAgentUpdate([...agents])

  console.log("[FlashyAI:Orchestrator] === PIPELINE COMPLETE ===", agents.map(a => ({
    site: a.site, matchType: a.matchType, status: a.status, price: a.result?.price
  })))
  callbacks.onComplete([...agents])
}

/**
 * Find the best deal among completed agents.
 */
export function findBestDeal(
  agents: AgentState[]
): { site: string; price: number; result: AgentResult; matchType: string } | null {
  let best: { site: string; price: number; result: AgentResult; matchType: string } | null = null

  for (const agent of agents) {
    if (agent.status !== "complete" || !agent.result?.price) continue

    const priceStr = agent.result.price.replace(/[^0-9.]/g, "")
    const price = parseFloat(priceStr)
    if (isNaN(price)) continue

    if (!best || price < best.price) {
      best = { site: agent.site, price, result: agent.result, matchType: agent.matchType }
    }
  }

  return best
}
