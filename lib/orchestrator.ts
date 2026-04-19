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
  { name: "Target", url: "https://www.target.com" }
]

const BACKUP_SITES = [
  { name: "Best Buy", url: "https://www.bestbuy.com" },
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
    .replace(/\s*[-|:].*(Amazon|Walmart|Target|eBay|Best Buy|Newegg).*$/i, "")
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

  // Step 1: Fast extract for exact match (instant)
  const fastResult = tryFastExtract(capture)

  if (!fastResult) {
    // Can't even get a product name — fall back to full LLM path
    console.log("[FlashyAI:Orchestrator] Fast extract failed, full LLM path...")
    try {
      const intentResponse = await extractIntent(featherlessKey, capture)
      callbacks.onIntentExtracted(intentResponse.intent.type, intentResponse.intent.product)

      // Use LLM-generated goals directly
      await runExactAndCascade(intentResponse.intent, intentResponse.agentGoals, capture, featherlessKey, tinyfishKey, agents => agents, callbacks)
    } catch (err) {
      console.error("[FlashyAI:Orchestrator] LLM extraction failed:", err)
      callbacks.onError(`Intent extraction failed: ${err}`)
    }
    return
  }

  const { product, price, hostname } = fastResult
  callbacks.onIntentExtracted("product_search", product)

  // Step 2: Launch exact match agents AND Featherless in parallel
  const exactGoals = makeExactGoals(product, hostname)

  console.log("[FlashyAI:Orchestrator] Launching exact match + Featherless LLM in parallel...")

  // Start Featherless in the background (for smart similar goals later)
  const richIntentPromise = extractIntent(featherlessKey, capture)
    .then((resp) => {
      console.log("[FlashyAI:Orchestrator] Featherless rich intent ready:", {
        product: resp.intent.product,
        category: resp.intent.category,
        attributes: resp.intent.attributes,
        price: resp.intent.currentPrice
      })
      return resp.intent
    })
    .catch((err) => {
      console.warn("[FlashyAI:Orchestrator] Featherless failed (will use generic similar):", err)
      return null
    })

  // Build a basic intent for fallback
  const basicIntent: ExtractedIntent = {
    type: "product_search",
    product,
    attributes: {},
    currentPrice: price,
    sourceSite: hostname
  }

  await runExactAndCascade(
    basicIntent,
    exactGoals,
    capture,
    featherlessKey,
    tinyfishKey,
    // This function resolves the rich intent when needed for similar search
    async () => {
      const richIntent = await richIntentPromise
      return richIntent || basicIntent
    },
    callbacks
  )
}

async function runExactAndCascade(
  basicIntent: ExtractedIntent,
  exactGoals: AgentGoal[],
  capture: PageCapture,
  featherlessKey: string,
  tinyfishKey: string,
  resolveRichIntent: (() => Promise<ExtractedIntent>) | ((agents: AgentState[]) => AgentState[]),
  callbacks: OrchestratorCallbacks
): Promise<void> {
  // Dispatch exact match agents
  console.log("[FlashyAI:Orchestrator] Dispatching exact match agents...")
  const agents: AgentState[] = exactGoals.map((goal, i) => ({
    id: `exact-${i}`,
    site: goal.site,
    status: "queued" as const,
    matchType: "exact" as const
  }))
  callbacks.onAgentUpdate([...agents])

  const { promise: exactPromise } = dispatchAgents(
    tinyfishKey,
    exactGoals,
    (siteId, update) => {
      const agent = agents.find((a) => a.site === siteId && a.matchType === "exact")
      if (agent) {
        if (update.status) agent.status = update.status as AgentState["status"]
        if (update.streamingUrl) agent.streamingUrl = update.streamingUrl
        if (update.result) { agent.result = update.result; agent.streamingUrl = undefined }
        if (update.error) { agent.error = update.error; agent.streamingUrl = undefined }
        callbacks.onAgentUpdate([...agents])
      }
    }
  )

  await exactPromise
  console.log("[FlashyAI:Orchestrator] Exact results:", agents.map(a => ({
    site: a.site, found: !isNotFound(a), price: a.result?.price
  })))

  // Identify not-found sites
  const notFoundAgents = agents.filter(a => isNotFound(a))
  const foundAgents = agents.filter(a => !isNotFound(a))

  for (const agent of notFoundAgents) {
    agent.status = "not_found"
  }
  callbacks.onAgentUpdate([...agents])

  console.log("[FlashyAI:Orchestrator] Found:", foundAgents.map(a => a.site), "Not found:", notFoundAgents.map(a => a.site))

  // Determine which sites need similar search
  const sitesForSimilar = notFoundAgents.map(a => {
    return [...TARGET_SITES, ...BACKUP_SITES].find(s => s.name === a.site)!
  }).filter(Boolean)

  // If ALL sites failed, expand to backup sites
  if (foundAgents.length === 0) {
    console.log("[FlashyAI:Orchestrator] All exact matches failed — expanding to backup sites")
    const sourceDomain = new URL(capture.url).hostname.replace("www.", "")
    const unusedBackups = BACKUP_SITES.filter(
      s => !agents.some(a => a.site === s.name) &&
           !new URL(s.url).hostname.replace("www.", "").includes(sourceDomain)
    )
    sitesForSimilar.push(...unusedBackups)
  }

  if (sitesForSimilar.length > 0) {
    console.log("[FlashyAI:Orchestrator] Cascading to similar search on:", sitesForSimilar.map(s => s.name))
    callbacks.onSimilarSearchStart()

    // Resolve rich intent from Featherless (should be ready by now since exact match took time)
    let richIntent: ExtractedIntent = basicIntent
    if (typeof resolveRichIntent === "function") {
      try {
        const resolved = await (resolveRichIntent as () => Promise<ExtractedIntent>)()
        if (resolved) richIntent = resolved
      } catch {
        // Use basic intent as fallback
      }
    }

    console.log("[FlashyAI:Orchestrator] Using intent for similar search:", {
      product: richIntent.product,
      category: richIntent.category,
      attributes: richIntent.attributes,
      price: richIntent.currentPrice
    })

    // Generate smart similar goals using rich intent
    const hasRichData = Object.keys(richIntent.attributes || {}).length > 0 || richIntent.category
    const similarGoals = sitesForSimilar.map(site =>
      hasRichData
        ? makeSmartSimilarGoal(richIntent, site)
        : makeGenericSimilarGoal(richIntent.product, site)
    )

    console.log("[FlashyAI:Orchestrator] Similar goals:", similarGoals.map(g => ({
      site: g.site,
      goal: g.goal.slice(0, 120) + "..."
    })))

    const similarAgents: AgentState[] = similarGoals.map((goal, i) => ({
      id: `similar-${i}`,
      site: goal.site,
      status: "queued" as const,
      matchType: "similar" as const
    }))

    agents.push(...similarAgents)
    callbacks.onAgentUpdate([...agents])

    const { promise: similarPromise } = dispatchAgents(
      tinyfishKey,
      similarGoals,
      (siteId, update) => {
        const agent = agents.find(a => a.site === siteId && a.matchType === "similar")
        if (agent) {
          if (update.status) agent.status = update.status as AgentState["status"]
          if (update.streamingUrl) agent.streamingUrl = update.streamingUrl
          if (update.result) agent.result = update.result
          if (update.error) agent.error = update.error
          callbacks.onAgentUpdate([...agents])
        }
      }
    )

    await similarPromise
    console.log("[FlashyAI:Orchestrator] Similar results:",
      agents.filter(a => a.matchType === "similar").map(a => ({
        site: a.site, found: !isNotFound(a), price: a.result?.price, product: a.result?.product
      }))
    )
  }

  console.log("[FlashyAI:Orchestrator] === PIPELINE COMPLETE ===")
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
