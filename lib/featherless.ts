import type { IntentResponse, PageCapture } from "./types"

const ENDPOINT = "https://api.featherless.ai/v1/chat/completions"
const MODEL = "meta-llama/Meta-Llama-3.1-8B-Instruct"

const DEFAULT_SITES = [
  { name: "Amazon", url: "https://www.amazon.com" },
  { name: "Walmart", url: "https://www.walmart.com" },
  { name: "eBay", url: "https://www.ebay.com" },
  { name: "Target", url: "https://www.target.com" }
]

const SYSTEM_PROMPT = `You are an intent extraction engine for a shopping comparison tool.

Given a webpage's URL, title, HTML content, and user interaction events, extract:
1. What product/item the user is looking at or searching for
2. The product CATEGORY (e.g., "smart speakers", "running shoes", "laptops", "headphones")
3. Key attributes the user cares about — infer from the product AND from user interactions:
   - If user clicked a color filter → they care about color
   - If user selected a size → they care about size
   - If user sorted by price → they care about price range
   - If user clicked a brand filter → they care about brand
4. The current price on this site

IMPORTANT: Return ONLY valid JSON with this exact structure:
{
  "intent": {
    "type": "product_search" | "general_search" | "unknown",
    "product": "product name",
    "category": "product category (e.g., smart speakers, running shoes)",
    "attributes": { "key": "value" },
    "currentPrice": "$XX.XX",
    "sourceSite": "domain.com"
  },
  "agentGoals": [
    {
      "site": "site name",
      "url": "https://site.com",
      "goal": "Natural language instruction for the agent"
    }
  ]
}

For attributes, include things like:
- "color": "white"
- "size": "10"
- "brand": "Nike"
- "priceRange": "under $50"
- "condition": "new"
- Any other relevant product attributes

The agentGoals should tell a browser agent to find the EXACT same product. Be specific about what to search for and what to extract.`

/**
 * Call Featherless LLM to extract intent from page capture
 * and generate per-site agent goals.
 */
export async function extractIntent(
  apiKey: string,
  capture: PageCapture,
  targetSites?: { name: string; url: string }[]
): Promise<IntentResponse> {
  const sites = targetSites || DEFAULT_SITES

  // Filter out the source site
  const sourceDomain = new URL(capture.url).hostname.replace("www.", "")
  const filteredSites = sites.filter(
    (s) => !new URL(s.url).hostname.replace("www.", "").includes(sourceDomain)
  )

  console.log("[FlashyAI:Featherless] Extracting intent...", {
    sourceUrl: capture.url,
    sourceDomain,
    targetSites: filteredSites.map(s => s.name),
    htmlLength: capture.html?.length,
    eventCount: capture.events?.length
  })

  const userMessage = JSON.stringify({
    url: capture.url,
    title: capture.title,
    // Trim HTML to avoid token limits — send first 3000 chars
    html: capture.html.slice(0, 3000),
    recentEvents: capture.events.slice(-10),
    targetSites: filteredSites
  })

  console.log("[FlashyAI:Featherless] Sending to Featherless API...", {
    model: MODEL,
    userMessageLength: userMessage.length
  })

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage }
      ],
      temperature: 0.1,
      max_tokens: 2000
    })
  })

  console.log("[FlashyAI:Featherless] Response status:", response.status)

  if (!response.ok) {
    const errText = await response.text()
    console.error("[FlashyAI:Featherless] API error:", errText)
    throw new Error(`Featherless API error ${response.status}: ${errText}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content

  console.log("[FlashyAI:Featherless] Raw LLM response:", content?.slice(0, 500))

  if (!content) {
    console.error("[FlashyAI:Featherless] No content in response. Full response:", JSON.stringify(data).slice(0, 500))
    throw new Error("No content in Featherless response")
  }

  // Parse JSON from response — handle potential markdown wrapping
  const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()

  let parsed: IntentResponse
  try {
    parsed = JSON.parse(jsonStr) as IntentResponse
  } catch (parseErr) {
    console.error("[FlashyAI:Featherless] Failed to parse JSON:", jsonStr.slice(0, 500), parseErr)
    throw new Error(`Failed to parse LLM response as JSON: ${parseErr}`)
  }

  // Validate structure
  if (!parsed.intent || !parsed.agentGoals) {
    console.error("[FlashyAI:Featherless] Invalid structure:", parsed)
    throw new Error("Invalid intent response structure")
  }

  console.log("[FlashyAI:Featherless] Intent extracted:", {
    product: parsed.intent.product,
    type: parsed.intent.type,
    price: parsed.intent.currentPrice,
    agentCount: parsed.agentGoals.length,
    agents: parsed.agentGoals.map(g => ({ site: g.site, goalPreview: g.goal.slice(0, 80) }))
  })

  return parsed
}
