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
2. Key attributes (size, color, model, etc.)
3. The current price on this site

Then generate search goals for each target site. Each goal should be a natural language instruction telling a browser agent exactly what to do on that site to find the same or equivalent product and extract its price.

IMPORTANT: Return ONLY valid JSON with this exact structure:
{
  "intent": {
    "type": "product_search" | "general_search" | "unknown",
    "product": "product name",
    "attributes": { "key": "value" },
    "currentPrice": "$XX.XX",
    "sourceSite": "domain.com"
  },
  "agentGoals": [
    {
      "site": "site name",
      "url": "https://site.com",
      "goal": "Natural language instruction for the agent. Be specific: tell it to search for the exact product, what to look for, and to return JSON with {product, price, available, url}"
    }
  ]
}

Make each goal specific and actionable. The agent will navigate a real browser, so include:
- What to search for (exact product name/keywords)
- What to extract (price, availability, URL)
- The return format (JSON with product, price, available, url fields)`

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
