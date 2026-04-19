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
  { name: "Newegg", url: "https://www.newegg.com" }
]

const BACKUP_SITES = [
  { name: "Costco", url: "https://www.costco.com" }
]

/**
 * Try to extract product name directly from page title without LLM.
 * Used for exact match only — fast path.
 */
function tryFastExtract(capture: PageCapture): { product: string; price: string; hostname: string; attributes: Record<string, string> } | null {
  const { url, title, html, events } = capture
  const hostname = new URL(url).hostname.replace("www.", "")

  let product = title
    .replace(/Amazon\.com:\s*/i, "")
    .replace(/\s*[-|:].*(Amazon|Target|eBay|Newegg|Costco).*$/i, "")
    .replace(/\s*\|.*$/, "")
    .replace(/\s*-\s*(Target|eBay|Newegg|Costco).*$/i, "")
    .trim()

  if (!product || product.length < 3) return null

  const priceMatch = html?.match(/\$[\d,]+\.?\d{0,2}/)?.[0] || ""

  // Extract attributes from DOM events — user's filter interactions
  const attributes: Record<string, string> = {}
  const COLORS = ["black", "white", "red", "blue", "green", "pink", "gray", "grey", "brown", "navy", "beige", "silver", "gold", "yellow", "orange", "purple"]

  for (const event of (events || [])) {
    const text = (event.text || "").toLowerCase()
    const value = (event.value || "").toLowerCase()
    const combined = `${text} ${value}`

    // Detect color selections
    for (const color of COLORS) {
      if (combined.includes(color)) {
        attributes.color = event.value || event.text
        break
      }
    }

    // Detect size selections (e.g., "Size: 10", "L", "XL", "Medium")
    const sizeMatch = combined.match(/(?:size[:\s]*)?(\d+(?:\.\d+)?|xs|s|m|l|xl|xxl|small|medium|large)/i)
    if (sizeMatch && (text.includes("size") || event.selector?.toLowerCase().includes("size"))) {
      attributes.size = sizeMatch[1]
    }

    // Detect search queries (what the user typed)
    if (event.type === "input" && event.value && event.value.length > 2) {
      attributes.searchQuery = event.value
    }
  }

  // Also try to extract color/size from the product title itself
  for (const color of COLORS) {
    if (product.toLowerCase().includes(color) && !attributes.color) {
      attributes.color = color.charAt(0).toUpperCase() + color.slice(1)
    }
  }

  console.log("[FlashyAI:FastExtract] Extracted:", { product, price: priceMatch, hostname, attributes })
  return { product, price: priceMatch, hostname, attributes }
}

/**
 * Build exact match goals — step-by-step format proven reliable by TinyFish cookbook.
 * Now accepts user intent attributes to refine the search.
 */
function makeExactGoals(product: string, sourceHostname: string, attributes?: Record<string, string>): AgentGoal[] {
  const today = new Date().toLocaleDateString("en-US")
  const filteredSites = TARGET_SITES.filter(
    (s) => !new URL(s.url).hostname.replace("www.", "").includes(sourceHostname)
  )

  // Build attribute context for the goal
  const attrs = Object.entries(attributes || {})
  const attrContext = attrs.length > 0
    ? `- User Preferences: ${attrs.map(([k, v]) => `${k}: ${v}`).join(", ")}\n`
    : ""
  const filterInstructions = attrs.length > 0
    ? `After finding the product, apply any available filters that match the user's preferences (${attrs.map(([k, v]) => `${k}: ${v}`).join(", ")}). If filters are not available, just find the closest matching variant.`
    : ""

  return filteredSites.map((site) => ({
    site: site.name,
    url: site.url,
    goal: `You are extracting product pricing data from ${site.name}.

CONTEXT:
- Product: ${product}
- Search Date: ${today}
${attrContext}
STEP 1 - NAVIGATE TO SEARCH:
If not already on a search results page, find and click the search bar.
Type "${product}" and press Enter. Wait for results to load.
Handle any popups or cookie banners by dismissing them.

STEP 2 - LOCATE THE PRODUCT:
Look through the search results for a product matching "${product}".
Click on the first result that closely matches the product name.
Wait for the product detail page to load.
${filterInstructions}

STEP 3 - EXTRACT PRICE & STOCK DATA:
From the product page, extract:
- The current displayed price (look for dollar amounts near "Add to Cart" or "Buy Now")
- Whether the item is in stock
- The full URL of this product page

STEP 4 - RETURN RESULT AS JSON:
{
  "product": "Full product name as displayed on page",
  "price": "$XX.XX",
  "available": true,
  "url": "https://full-url-to-product-page"
}

If the product is NOT found in search results, return:
{
  "product": "",
  "price": "",
  "available": false,
  "url": ""
}

IMPORTANT: Return ONLY the JSON object, no additional text.`
  }))
}

/**
 * Build smart "find similar" goals — step-by-step with rich intent from Featherless.
 */
function makeSmartSimilarGoal(
  intent: ExtractedIntent,
  site: { name: string; url: string }
): AgentGoal {
  const today = new Date().toLocaleDateString("en-US")
  const attrs = Object.entries(intent.attributes || {})
  const attrStr = attrs.length > 0
    ? attrs.map(([k, v]) => `${k}: ${v}`).join(", ")
    : "none specified"

  return {
    site: site.name,
    url: site.url,
    goal: `You are finding alternative products similar to "${intent.product}" on ${site.name}.

CONTEXT:
- Original Product: ${intent.product}
- Category: ${intent.category || "general"}
- Preferred Attributes: ${attrStr}
- Original Price: ${intent.currentPrice || "unknown"}
- Search Date: ${today}

STEP 1 - SEARCH FOR ALTERNATIVES:
Search for "${intent.category || intent.product}" in the search bar.
Handle any popups or cookie banners by dismissing them.

STEP 2 - FIND BEST MATCH:
Browse the first page of results (max 10 items).
Find the product that best matches these criteria:
- Same category as "${intent.category || "the original product"}"
- Similar price range to ${intent.currentPrice || "the original"}
- Matches preferred attributes where possible

STEP 3 - EXTRACT DATA:
Click on the best matching product.
Extract the product name, price, and URL from the detail page.

STEP 4 - RETURN RESULT AS JSON:
{
  "product": "Full product name",
  "price": "$XX.XX",
  "available": true,
  "url": "https://full-url-to-product-page"
}

If no suitable alternative is found, return:
{
  "product": "",
  "price": "",
  "available": false,
  "url": ""
}

IMPORTANT: Return ONLY the JSON object, no additional text.`
  }
}

/**
 * Dumb fallback for similar goals when we don't have rich intent.
 */
function makeGenericSimilarGoal(product: string, site: { name: string; url: string }): AgentGoal {
  const today = new Date().toLocaleDateString("en-US")
  return {
    site: site.name,
    url: site.url,
    goal: `You are finding alternative products similar to "${product}" on ${site.name}.

CONTEXT:
- Original Product: ${product}
- Search Date: ${today}

STEP 1 - SEARCH:
Find the search bar, type "${product}", press Enter. Dismiss any popups.

STEP 2 - FIND BEST ALTERNATIVE:
Browse the first page of results (max 10 items).
Select the product that is most similar to "${product}".

STEP 3 - EXTRACT DATA:
Click on the best match. Extract name, price, and URL.

STEP 4 - RETURN JSON:
{
  "product": "Full product name",
  "price": "$XX.XX",
  "available": true,
  "url": "https://full-url-to-product-page"
}

If nothing found, return:
{ "product": "", "price": "", "available": false, "url": "" }

IMPORTANT: Return ONLY the JSON object.`
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

// Exported for testing
export { tryFastExtract, makeExactGoals, makeSmartSimilarGoal, isNotFound }

/**
 * Full orchestration pipeline — parallel dispatch:
 *
 * 1. Fast extract product name + basic attributes from title/DOM events (instant)
 * 2. Call Featherless for rich intent (category, detailed attributes) — runs in parallel
 * 3. Generate exact + similar goals using TinyFish cookbook step-by-step format
 * 4. Dispatch ALL agents (exact + similar) in parallel
 * 5. Mark exact agents as not_found if they return empty results
 *
 * Featherless is intent-only (no goal generation). Orchestrator owns all goal creation.
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
      attributes: fastResult.attributes,
      currentPrice: fastResult.price,
      sourceSite: fastResult.hostname
    }
    callbacks.onIntentExtracted("product_search", product)
  }

  // Step 2: Build goals for BOTH exact and similar
  // Pass extracted attributes so exact goals include user preferences (size, color, etc.)
  const exactGoals = makeExactGoals(product, sourceDomain, basicIntent.attributes)

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

  // Step 3: Initialize exact agents IMMEDIATELY — don't wait for Featherless
  const agents: AgentState[] = exactGoals.map((goal, i) => ({
    id: `exact-${i}`,
    site: goal.site,
    status: "queued" as const,
    matchType: "exact" as const
  }))
  callbacks.onAgentUpdate([...agents])

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

  console.log("[FlashyAI:Orchestrator] Dispatching exact probes IMMEDIATELY:", exactGoals.map(g => g.site))

  // Dispatch exact agents NOW (no waiting)
  const { promise: exactPromise } = dispatchAgents(
    tinyfishKey, exactGoals,
    (siteId, update) => updateAgent(siteId, "exact", update)
  )

  // Resolve Featherless intent in parallel, then dispatch similar agents
  const similarPromise = (async () => {
    const richIntent = (await richIntentPromise) || basicIntent
    const hasRichData = Object.keys(richIntent.attributes || {}).length > 0 || richIntent.category
    const similarGoals = allSimilarSites.map(site =>
      hasRichData
        ? makeSmartSimilarGoal(richIntent, site)
        : makeGenericSimilarGoal(richIntent.product, site)
    )

    console.log("[FlashyAI:Orchestrator] Featherless ready — dispatching similar probes:", similarGoals.map(g => g.site))

    const similarAgentStates: AgentState[] = similarGoals.map((goal, i) => ({
      id: `similar-${i}`,
      site: goal.site,
      status: "queued" as const,
      matchType: "similar" as const
    }))
    agents.push(...similarAgentStates)
    callbacks.onAgentUpdate([...agents])
    callbacks.onSimilarSearchStart()

    const { promise } = dispatchAgents(
      tinyfishKey, similarGoals,
      (siteId, update) => updateAgent(siteId, "similar", update)
    )
    return promise
  })()

  await Promise.all([exactPromise, similarPromise])

  // Mark not-found agents (both exact and similar)
  for (const agent of agents) {
    if (isNotFound(agent)) {
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
