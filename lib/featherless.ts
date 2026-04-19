import type { IntentResponse, PageCapture } from "./types"

const ENDPOINT = "https://api.featherless.ai/v1/chat/completions"
// const MODEL = "meta-llama/Meta-Llama-3.1-8B-Instruct"
const MODEL = "NousResearch/Hermes-2-Pro-Llama-3-8B"

const DEFAULT_SITES = [
  { name: "Amazon", url: "https://www.amazon.com" },
  { name: "eBay", url: "https://www.ebay.com" },
  { name: "Target", url: "https://www.target.com" },
  { name: "Newegg", url: "https://www.newegg.com" }
]

const SYSTEM_PROMPT = `You are an intent extraction engine. Your ONLY job is to analyze a shopping webpage and the user's interactions to understand what they want.

You will receive:
- A webpage URL, title, and HTML snippet
- Recent user DOM events (clicks, inputs, filter selections)

Extract the user's shopping intent by analyzing BOTH the page content AND their interactions.

RULES:
- If the user clicked a color swatch or filter → extract that color as an attribute
- If the user selected a size → extract that size
- If the user typed in a search box → extract the search query
- If the user clicked a price range filter → extract the price range
- If the user clicked a brand filter → extract the brand preference
- Look at the page title and HTML to identify the product name, category, and price

Return ONLY this JSON structure, nothing else:
{
  "intent": {
    "type": "product_search",
    "product": "exact product name from the page",
    "category": "product category (e.g. smart speakers, running shoes, electronics)",
    "attributes": {
      "brand": "brand name if identifiable",
      "color": "color if user selected or product specifies",
      "size": "size if user selected or product specifies",
      "priceRange": "under $X or $X-$Y if identifiable",
      "condition": "new/used/refurbished if specified"
    },
    "currentPrice": "$XX.XX",
    "sourceSite": "domain.com"
  },
  "agentGoals": []
}

IMPORTANT:
- Only include attributes you are confident about from the page or user events
- Remove any attribute keys where the value would be empty or unknown
- The agentGoals array should always be empty — goals are generated separately
- Return ONLY the JSON, no explanation text before or after`

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

  // Extract JSON from LLM response — handles:
  // 1. Pure JSON
  // 2. ```json ... ``` wrapped
  // 3. Prose before/after JSON (find the outermost { ... })
  // 4. Truncated JSON (attempt repair)
  let jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()

  let parsed: IntentResponse
  try {
    parsed = JSON.parse(jsonStr) as IntentResponse
  } catch {
    // Try extracting JSON object from surrounding text
    console.log("[FlashyAI:Featherless] Direct parse failed, extracting JSON from text...")
    const firstBrace = jsonStr.indexOf("{")
    const lastBrace = jsonStr.lastIndexOf("}")

    if (firstBrace === -1) {
      console.error("[FlashyAI:Featherless] No JSON object found in response:", jsonStr.slice(0, 300))
      throw new Error("No JSON found in LLM response")
    }

    let extracted = jsonStr.slice(firstBrace, lastBrace + 1)

    try {
      parsed = JSON.parse(extracted) as IntentResponse
      console.log("[FlashyAI:Featherless] Successfully extracted JSON from surrounding text")
    } catch {
      // JSON might be truncated — try to repair by closing open brackets
      console.log("[FlashyAI:Featherless] Extracted JSON still invalid, attempting repair...")
      const openBraces = (extracted.match(/{/g) || []).length
      const closeBraces = (extracted.match(/}/g) || []).length
      const openBrackets = (extracted.match(/\[/g) || []).length
      const closeBrackets = (extracted.match(/\]/g) || []).length

      // Close any unclosed strings, arrays, objects
      let repaired = extracted
      if (repaired.match(/,\s*$/)) repaired = repaired.replace(/,\s*$/, "")
      if (repaired.match(/"[^"]*$/)) repaired += '"'
      for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += "]"
      for (let i = 0; i < openBraces - closeBraces; i++) repaired += "}"

      try {
        parsed = JSON.parse(repaired) as IntentResponse
        console.log("[FlashyAI:Featherless] Repaired truncated JSON successfully")
      } catch (finalErr) {
        console.error("[FlashyAI:Featherless] Failed to parse JSON even after repair:", extracted.slice(0, 500), finalErr)
        throw new Error(`Failed to parse LLM response as JSON: ${finalErr}`)
      }
    }
  }

  // Validate structure — agentGoals is optional (always empty, goals built by orchestrator)
  if (!parsed.intent) {
    console.error("[FlashyAI:Featherless] Invalid structure — missing intent:", parsed)
    throw new Error("Invalid intent response structure")
  }
  parsed.agentGoals = parsed.agentGoals || []

  console.log("[FlashyAI:Featherless] Intent extracted:", {
    product: parsed.intent.product,
    type: parsed.intent.type,
    price: parsed.intent.currentPrice,
    agentCount: parsed.agentGoals.length,
    agents: parsed.agentGoals.map(g => ({ site: g.site, goalPreview: g.goal.slice(0, 80) }))
  })

  return parsed
}
