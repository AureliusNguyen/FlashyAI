import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type {
  AgentState,
  AgentResult,
  PageCapture,
  DOMEvent,
  ExtractedIntent
} from "../lib/types"
import {
  tryFastExtract,
  makeExactGoals,
  makeSmartSimilarGoal,
  isNotFound,
  findBestDeal,
  orchestrate
} from "../lib/orchestrator"
import { parseResult, flattenObj } from "../lib/tinyfish"
import { cn } from "../lib/cn"
import { extractIntent } from "../lib/featherless"

// ─── Helpers ───────────────────────────────────────────────────────────

function makeCapture(overrides: Partial<PageCapture> = {}): PageCapture {
  return {
    url: "https://www.amazon.com/dp/B09ZX1234",
    title: "Amazon.com: NFL Echo Dot Bundle: Includes Echo Dot (5th Gen)",
    html: "<div class='price'>$49.99</div>",
    events: [],
    timestamp: Date.now(),
    ...overrides
  }
}

// ─── 1. tryFastExtract ─────────────────────────────────────────────────

describe("tryFastExtract", () => {
  it("extracts product name from Amazon title", () => {
    const capture = makeCapture({
      title: "Amazon.com: NFL Echo Dot Bundle: Includes Echo Dot (5th Gen)"
    })
    const result = tryFastExtract(capture)
    expect(result).not.toBeNull()
    expect(result!.product).toBe(
      "NFL Echo Dot Bundle: Includes Echo Dot (5th Gen)"
    )
  })

  it("extracts product name from Target title", () => {
    const capture = makeCapture({
      url: "https://www.target.com/p/plate",
      title: '10" Stoneware Plate - Threshold | Target'
    })
    const result = tryFastExtract(capture)
    expect(result).not.toBeNull()
    // The regex `\s*[-|:].*(Target).*$` matches ` - Threshold | Target`
    // because `-` is in the character class and `.*Target` is greedy.
    // So the product name is just the part before that match.
    expect(result!.product).toBe('10" Stoneware Plate')
  })

  it("extracts product name from eBay title", () => {
    const capture = makeCapture({
      url: "https://www.ebay.com/itm/12345",
      title: "Nike Air Force 1 | eBay"
    })
    const result = tryFastExtract(capture)
    expect(result).not.toBeNull()
    expect(result!.product).toBe("Nike Air Force 1")
  })

  it("returns null for short/empty title", () => {
    const capture = makeCapture({ title: "Hi" })
    expect(tryFastExtract(capture)).toBeNull()
  })

  it("returns null for empty title", () => {
    const capture = makeCapture({ title: "" })
    expect(tryFastExtract(capture)).toBeNull()
  })

  it("extracts price from HTML", () => {
    const capture = makeCapture({
      html: '<span class="a-price">$49.99</span>'
    })
    const result = tryFastExtract(capture)
    expect(result).not.toBeNull()
    expect(result!.price).toBe("$49.99")
  })

  it("returns empty price when no dollar amount in HTML", () => {
    const capture = makeCapture({ html: "<div>No price here</div>" })
    const result = tryFastExtract(capture)
    expect(result).not.toBeNull()
    expect(result!.price).toBe("")
  })

  it("extracts color from click event", () => {
    const capture = makeCapture({
      events: [
        {
          type: "click",
          selector: "button.color-swatch",
          text: "Black",
          timestamp: Date.now()
        }
      ]
    })
    const result = tryFastExtract(capture)
    expect(result).not.toBeNull()
    expect(result!.attributes.color).toBe("Black")
  })

  it("extracts size from selection event", () => {
    const capture = makeCapture({
      events: [
        {
          type: "select",
          selector: "select.size-picker",
          text: "Size: 10",
          value: "10",
          timestamp: Date.now()
        }
      ]
    })
    const result = tryFastExtract(capture)
    expect(result).not.toBeNull()
    expect(result!.attributes.size).toBe("10")
  })

  it("extracts search query from input event", () => {
    const capture = makeCapture({
      events: [
        {
          type: "input",
          selector: "input#search",
          text: "Search",
          value: "wireless earbuds",
          timestamp: Date.now()
        }
      ]
    })
    const result = tryFastExtract(capture)
    expect(result).not.toBeNull()
    expect(result!.attributes.searchQuery).toBe("wireless earbuds")
  })

  it("extracts color from product title when no event color", () => {
    const capture = makeCapture({
      title: "Amazon.com: Nike Air Max 90 Black Running Shoes",
      events: []
    })
    const result = tryFastExtract(capture)
    expect(result).not.toBeNull()
    expect(result!.attributes.color).toBe("Black")
  })

  it("extracts hostname correctly", () => {
    const capture = makeCapture({ url: "https://www.target.com/p/12345" })
    const result = tryFastExtract(capture)
    expect(result).not.toBeNull()
    expect(result!.hostname).toBe("target.com")
  })
})

// ─── 2. parseResult ────────────────────────────────────────────────────

describe("parseResult", () => {
  it("parses a simple flat result", () => {
    const raw = {
      product: "Echo Dot",
      price: "$29.99",
      available: true,
      url: "https://www.amazon.com/echo-dot"
    }
    const result = parseResult(raw)
    expect(result.product).toBe("Echo Dot")
    expect(result.price).toBe("$29.99")
    expect(result.available).toBe(true)
    expect(result.url).toBe("https://www.amazon.com/echo-dot")
  })

  it("parses a nested result", () => {
    const raw = {
      best_match: "Echo Dot",
      details: { price: "$29.99", url: "https://example.com/dot" }
    }
    const result = parseResult(raw)
    expect(result.product).toBe("Echo Dot")
    expect(result.price).toBe("$29.99")
    expect(result.url).toBe("https://example.com/dot")
  })

  it("parses a JSON string result", () => {
    const raw = '{"product": "Echo Dot", "price": "$29.99"}'
    const result = parseResult(raw)
    expect(result.product).toBe("Echo Dot")
    expect(result.price).toBe("$29.99")
  })

  it("handles empty/null result", () => {
    const result = parseResult(null)
    expect(result.raw).toBeNull()
    expect(result.product).toBeUndefined()
  })

  it("handles undefined result", () => {
    const result = parseResult(undefined)
    expect(result.raw).toBeUndefined()
  })

  it("finds dollar amount in a non-price string field when no price key", () => {
    const raw = {
      description: "Great deal at $15.99 today only!",
      name: "Some Widget"
    }
    const result = parseResult(raw)
    expect(result.price).toBe("$15.99")
    expect(result.product).toBe("Some Widget")
  })

  it("detects available: false", () => {
    const raw = {
      product: "Echo Dot",
      price: "$29.99",
      available: false,
      url: "https://example.com"
    }
    const result = parseResult(raw)
    expect(result.available).toBe(false)
  })

  it("detects exact_match: false", () => {
    const raw = {
      product: "Echo Dot",
      price: "$29.99",
      exact_match: false,
      url: "https://example.com"
    }
    const result = parseResult(raw)
    expect(result.available).toBe(false)
  })

  it("handles price without dollar sign (numeric)", () => {
    const raw = { product: "Widget", price: "29.99" }
    const result = parseResult(raw)
    // Code does: if (!price.includes("$")) -> format as $XX.XX
    expect(result.price).toBe("$29.99")
  })

  it("handles non-parseable string (not JSON)", () => {
    const raw = "This is just some text with no JSON"
    const result = parseResult(raw)
    expect(result.product).toBe("This is just some text with no JSON")
    expect(result.price).toBe("")
  })

  it("handles non-parseable string with a dollar amount", () => {
    const raw = "Found item for $42.50 on Amazon"
    const result = parseResult(raw)
    expect(result.price).toBe("$42.50")
  })

  it("skips price keys with N/A value", () => {
    const raw = { product: "Widget", price: "N/A" }
    const result = parseResult(raw)
    expect(result.price).toBe("")
  })

  it("skips price keys with empty string", () => {
    const raw = { product: "Widget", price: "" }
    const result = parseResult(raw)
    expect(result.price).toBe("")
  })
})

// ─── 3. flattenObj ─────────────────────────────────────────────────────

describe("flattenObj", () => {
  it("keeps flat object flat", () => {
    const obj = { a: 1, b: "two" }
    const flat = flattenObj(obj)
    expect(flat.a).toBe(1)
    expect(flat.b).toBe("two")
  })

  it("flattens nested object", () => {
    const obj = { outer: { inner: "val" } }
    const flat = flattenObj(obj)
    expect(flat["outer.inner"]).toBe("val")
    // Also stores unprefixed
    expect(flat["inner"]).toBe("val")
  })

  it("handles array of objects — takes first element", () => {
    const obj = {
      results: [
        { name: "First", price: "$10" },
        { name: "Second", price: "$20" }
      ]
    }
    const flat = flattenObj(obj)
    expect(flat["name"]).toBe("First")
    expect(flat["price"]).toBe("$10")
  })

  it("handles deep nesting (3+ levels)", () => {
    const obj = {
      level1: {
        level2: {
          level3: "deep_value"
        }
      }
    }
    const flat = flattenObj(obj)
    expect(flat["level1.level2.level3"]).toBe("deep_value")
    expect(flat["level3"]).toBe("deep_value")
  })

  it("handles mixed nested and flat keys", () => {
    const obj = {
      simple: "flat",
      nested: { child: "deep" }
    }
    const flat = flattenObj(obj)
    expect(flat["simple"]).toBe("flat")
    expect(flat["nested.child"]).toBe("deep")
    expect(flat["child"]).toBe("deep")
  })

  it("handles empty array (no crash)", () => {
    const obj = { items: [] as unknown[] }
    const flat = flattenObj(obj)
    expect(flat["items"]).toEqual([])
  })

  it("handles array of primitives", () => {
    const obj = { tags: ["a", "b", "c"] }
    const flat = flattenObj(obj)
    // Array of non-objects: stored as-is
    expect(flat["tags"]).toEqual(["a", "b", "c"])
  })
})

// ─── 4. findBestDeal ───────────────────────────────────────────────────

describe("findBestDeal", () => {
  it("returns the lowest price among multiple agents", () => {
    const agents: AgentState[] = [
      {
        id: "1",
        site: "Amazon",
        status: "complete",
        matchType: "exact",
        result: { product: "Widget", price: "$39.99", available: true }
      },
      {
        id: "2",
        site: "Target",
        status: "complete",
        matchType: "exact",
        result: { product: "Widget", price: "$29.99", available: true }
      },
      {
        id: "3",
        site: "eBay",
        status: "complete",
        matchType: "exact",
        result: { product: "Widget", price: "$34.99", available: true }
      }
    ]
    const best = findBestDeal(agents)
    expect(best).not.toBeNull()
    expect(best!.site).toBe("Target")
    expect(best!.price).toBe(29.99)
  })

  it("returns null when all agents have no price", () => {
    const agents: AgentState[] = [
      {
        id: "1",
        site: "Amazon",
        status: "complete",
        matchType: "exact",
        result: { product: "Widget", price: "", available: true }
      },
      {
        id: "2",
        site: "Target",
        status: "not_found",
        matchType: "exact"
      }
    ]
    const best = findBestDeal(agents)
    expect(best).toBeNull()
  })

  it("handles mix of complete and not_found agents", () => {
    const agents: AgentState[] = [
      {
        id: "1",
        site: "Amazon",
        status: "not_found",
        matchType: "exact"
      },
      {
        id: "2",
        site: "Target",
        status: "complete",
        matchType: "exact",
        result: { product: "Widget", price: "$19.99", available: true }
      },
      {
        id: "3",
        site: "eBay",
        status: "error",
        matchType: "exact",
        error: "timeout"
      }
    ]
    const best = findBestDeal(agents)
    expect(best).not.toBeNull()
    expect(best!.site).toBe("Target")
    expect(best!.price).toBe(19.99)
  })

  it("parses price with dollar sign and cents", () => {
    const agents: AgentState[] = [
      {
        id: "1",
        site: "Amazon",
        status: "complete",
        matchType: "exact",
        result: { product: "Widget", price: "$29.99", available: true }
      }
    ]
    const best = findBestDeal(agents)
    expect(best!.price).toBe(29.99)
  })

  it("parses price without dollar sign", () => {
    const agents: AgentState[] = [
      {
        id: "1",
        site: "Amazon",
        status: "complete",
        matchType: "exact",
        result: { product: "Widget", price: "29.99", available: true }
      }
    ]
    const best = findBestDeal(agents)
    expect(best!.price).toBe(29.99)
  })

  it("parses price with comma separator", () => {
    const agents: AgentState[] = [
      {
        id: "1",
        site: "Newegg",
        status: "complete",
        matchType: "exact",
        result: { product: "Laptop", price: "$1,299.00", available: true }
      }
    ]
    const best = findBestDeal(agents)
    expect(best!.price).toBe(1299.0)
  })

  it("returns null for empty agents array", () => {
    expect(findBestDeal([])).toBeNull()
  })

  it("includes matchType in the result", () => {
    const agents: AgentState[] = [
      {
        id: "1",
        site: "Amazon",
        status: "complete",
        matchType: "similar",
        result: { product: "Widget", price: "$9.99", available: true }
      }
    ]
    const best = findBestDeal(agents)
    expect(best!.matchType).toBe("similar")
  })
})

// ─── 5. isNotFound ─────────────────────────────────────────────────────

describe("isNotFound", () => {
  it("returns true for status 'error'", () => {
    const agent: AgentState = {
      id: "1",
      site: "Amazon",
      status: "error",
      matchType: "exact",
      error: "timeout"
    }
    expect(isNotFound(agent)).toBe(true)
  })

  it("returns true for status 'complete' with empty result", () => {
    const agent: AgentState = {
      id: "1",
      site: "Amazon",
      status: "complete",
      matchType: "exact"
      // no result
    }
    expect(isNotFound(agent)).toBe(true)
  })

  it("returns true for status 'complete' with available: false", () => {
    const agent: AgentState = {
      id: "1",
      site: "Amazon",
      status: "complete",
      matchType: "exact",
      result: {
        product: "Echo Dot",
        price: "$29.99",
        available: false
      }
    }
    expect(isNotFound(agent)).toBe(true)
  })

  it("returns true for status 'complete' with empty price", () => {
    const agent: AgentState = {
      id: "1",
      site: "Amazon",
      status: "complete",
      matchType: "exact",
      result: {
        product: "Echo Dot",
        price: "",
        available: true
      }
    }
    expect(isNotFound(agent)).toBe(true)
  })

  it("returns true for status 'complete' with empty product", () => {
    const agent: AgentState = {
      id: "1",
      site: "Amazon",
      status: "complete",
      matchType: "exact",
      result: {
        product: "",
        price: "$29.99",
        available: true
      }
    }
    expect(isNotFound(agent)).toBe(true)
  })

  it("returns true for status 'complete' with price 'undefined'", () => {
    const agent: AgentState = {
      id: "1",
      site: "Amazon",
      status: "complete",
      matchType: "exact",
      result: {
        product: "Widget",
        price: "undefined",
        available: true
      }
    }
    expect(isNotFound(agent)).toBe(true)
  })

  it("returns false for status 'complete' with valid result", () => {
    const agent: AgentState = {
      id: "1",
      site: "Amazon",
      status: "complete",
      matchType: "exact",
      result: {
        product: "Echo Dot",
        price: "$29.99",
        available: true
      }
    }
    expect(isNotFound(agent)).toBe(false)
  })

  it("returns false for status 'streaming'", () => {
    const agent: AgentState = {
      id: "1",
      site: "Amazon",
      status: "streaming",
      matchType: "exact",
      streamingUrl: "https://streaming.example.com"
    }
    expect(isNotFound(agent)).toBe(false)
  })

  it("returns false for status 'queued'", () => {
    const agent: AgentState = {
      id: "1",
      site: "Amazon",
      status: "queued",
      matchType: "exact"
    }
    expect(isNotFound(agent)).toBe(false)
  })

  it("returns false for status 'connecting'", () => {
    const agent: AgentState = {
      id: "1",
      site: "Amazon",
      status: "connecting",
      matchType: "exact"
    }
    expect(isNotFound(agent)).toBe(false)
  })
})

// ─── 6. Featherless JSON parsing (via extractIntent mock) ──────────────

describe("Featherless JSON parsing", () => {
  const mockCapture: PageCapture = {
    url: "https://www.amazon.com/dp/B09X1234",
    title: "Echo Dot",
    html: "<div>price: $29.99</div>",
    events: [],
    timestamp: Date.now()
  }

  function makeFetchResponse(content: string) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content } }]
      }),
      text: async () => content
    } as unknown as Response
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("parses pure JSON string", async () => {
    const json = JSON.stringify({
      intent: {
        type: "product_search",
        product: "Echo Dot",
        attributes: {},
        currentPrice: "$29.99",
        sourceSite: "amazon.com"
      },
      agentGoals: []
    })

    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(json))

    const result = await extractIntent("test-key", mockCapture)
    expect(result.intent.product).toBe("Echo Dot")
    expect(result.intent.currentPrice).toBe("$29.99")
  })

  it("parses JSON wrapped in ```json ... ```", async () => {
    const json = JSON.stringify({
      intent: {
        type: "product_search",
        product: "Echo Dot",
        attributes: {},
        sourceSite: "amazon.com"
      },
      agentGoals: []
    })
    const wrapped = "```json\n" + json + "\n```"

    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(wrapped))

    const result = await extractIntent("test-key", mockCapture)
    expect(result.intent.product).toBe("Echo Dot")
  })

  it("parses JSON with prose before and after", async () => {
    const json = JSON.stringify({
      intent: {
        type: "product_search",
        product: "Widget",
        attributes: {},
        sourceSite: "amazon.com"
      },
      agentGoals: []
    })
    const content = "Here is the extracted intent:\n" + json + "\nHope this helps!"

    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(content))

    const result = await extractIntent("test-key", mockCapture)
    expect(result.intent.product).toBe("Widget")
  })

  it("repairs truncated JSON (missing closing braces)", async () => {
    // Truncated JSON — outer closing brace is missing.
    // The repair logic finds firstBrace..lastBrace, which captures up to the
    // intent object's closing brace, then counts open/close braces and appends
    // the missing ones. This results in valid JSON: {intent: {...}}.
    // agentGoals is filled in by the validation code afterward.
    const truncated =
      '{"intent": {"type": "product_search", "product": "Gadget", "attributes": {}, "sourceSite": "amazon.com"}'

    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(truncated))

    const result = await extractIntent("test-key", mockCapture)
    expect(result.intent.product).toBe("Gadget")
    expect(result.agentGoals).toEqual([])
  })

  it("throws on completely invalid response (no JSON at all)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeFetchResponse("I cannot help with that request.")
    )

    await expect(extractIntent("test-key", mockCapture)).rejects.toThrow(
      "No JSON found in LLM response"
    )
  })

  it("throws when response has no content", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: {} }] }),
      text: async () => ""
    } as unknown as Response)

    await expect(extractIntent("test-key", mockCapture)).rejects.toThrow(
      "No content in Featherless response"
    )
  })

  it("throws on API error", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized"
    } as unknown as Response)

    await expect(extractIntent("test-key", mockCapture)).rejects.toThrow(
      "Featherless API error 401"
    )
  })
})

// ─── 7. cn utility ─────────────────────────────────────────────────────

describe("cn", () => {
  it("joins multiple string classes", () => {
    expect(cn("foo", "bar", "baz")).toBe("foo bar baz")
  })

  it("filters out falsy values", () => {
    expect(cn("foo", false, null, undefined, "bar")).toBe("foo bar")
  })

  it("returns empty string for empty call", () => {
    expect(cn()).toBe("")
  })

  it("returns single class", () => {
    expect(cn("only")).toBe("only")
  })

  it("filters all falsy values", () => {
    expect(cn(false, null, undefined)).toBe("")
  })
})

// ─── 8. makeExactGoals and makeSmartSimilarGoal ─────────────────────────

describe("makeExactGoals", () => {
  it("includes product name in each goal", () => {
    const goals = makeExactGoals("Echo Dot 5th Gen", "amazon.com")
    for (const goal of goals) {
      expect(goal.goal).toContain("Echo Dot 5th Gen")
    }
  })

  it("includes user attributes when provided", () => {
    const attrs = { color: "Black", size: "10" }
    const goals = makeExactGoals("Nike Air Max", "amazon.com", attrs)
    for (const goal of goals) {
      expect(goal.goal).toContain("color: Black")
      expect(goal.goal).toContain("size: 10")
    }
  })

  it("includes step-by-step format", () => {
    const goals = makeExactGoals("Widget", "amazon.com")
    for (const goal of goals) {
      expect(goal.goal).toContain("STEP 1")
      expect(goal.goal).toContain("STEP 2")
      expect(goal.goal).toContain("STEP 3")
      expect(goal.goal).toContain("STEP 4")
    }
  })

  it("includes JSON schema in goal", () => {
    const goals = makeExactGoals("Widget", "amazon.com")
    for (const goal of goals) {
      expect(goal.goal).toContain('"product"')
      expect(goal.goal).toContain('"price"')
      expect(goal.goal).toContain('"available"')
      expect(goal.goal).toContain('"url"')
    }
  })

  it("includes fallback JSON for not-found case", () => {
    const goals = makeExactGoals("Widget", "amazon.com")
    for (const goal of goals) {
      expect(goal.goal).toContain('"available": false')
    }
  })

  it("filters out the source site", () => {
    const goals = makeExactGoals("Widget", "amazon.com")
    const sites = goals.map((g) => g.site)
    expect(sites).not.toContain("Amazon")
    // Should include the other sites
    expect(sites).toContain("eBay")
    expect(sites).toContain("Target")
    expect(sites).toContain("Newegg")
  })

  it("filters out source site for Target", () => {
    const goals = makeExactGoals("Widget", "target.com")
    const sites = goals.map((g) => g.site)
    expect(sites).not.toContain("Target")
    expect(sites).toContain("Amazon")
  })

  it("includes all target sites when source is not in list", () => {
    const goals = makeExactGoals("Widget", "walmart.com")
    expect(goals.length).toBe(4) // Amazon, eBay, Target, Newegg
  })

  it("omits attribute context when no attributes", () => {
    const goals = makeExactGoals("Widget", "amazon.com")
    for (const goal of goals) {
      expect(goal.goal).not.toContain("User Preferences:")
    }
  })

  it("each goal has site name and url", () => {
    const goals = makeExactGoals("Widget", "amazon.com")
    for (const goal of goals) {
      expect(goal.site).toBeTruthy()
      expect(goal.url).toMatch(/^https:\/\//)
    }
  })
})

describe("makeSmartSimilarGoal", () => {
  const intent: ExtractedIntent = {
    type: "product_search",
    product: "Echo Dot 5th Gen",
    category: "smart speakers",
    attributes: { color: "Black", brand: "Amazon" },
    currentPrice: "$49.99",
    sourceSite: "amazon.com"
  }

  const site = { name: "Target", url: "https://www.target.com" }

  it("includes product name", () => {
    const goal = makeSmartSimilarGoal(intent, site)
    expect(goal.goal).toContain("Echo Dot 5th Gen")
  })

  it("includes category from intent", () => {
    const goal = makeSmartSimilarGoal(intent, site)
    expect(goal.goal).toContain("smart speakers")
  })

  it("includes price range from intent", () => {
    const goal = makeSmartSimilarGoal(intent, site)
    expect(goal.goal).toContain("$49.99")
  })

  it("includes attributes from intent", () => {
    const goal = makeSmartSimilarGoal(intent, site)
    expect(goal.goal).toContain("color: Black")
    expect(goal.goal).toContain("brand: Amazon")
  })

  it("includes step-by-step format", () => {
    const goal = makeSmartSimilarGoal(intent, site)
    expect(goal.goal).toContain("STEP 1")
    expect(goal.goal).toContain("STEP 2")
    expect(goal.goal).toContain("STEP 3")
    expect(goal.goal).toContain("STEP 4")
  })

  it("includes JSON schema", () => {
    const goal = makeSmartSimilarGoal(intent, site)
    expect(goal.goal).toContain('"product"')
    expect(goal.goal).toContain('"price"')
    expect(goal.goal).toContain('"available"')
    expect(goal.goal).toContain('"url"')
  })

  it("includes fallback JSON", () => {
    const goal = makeSmartSimilarGoal(intent, site)
    expect(goal.goal).toContain('"available": false')
  })

  it("sets site name and url on the goal", () => {
    const goal = makeSmartSimilarGoal(intent, site)
    expect(goal.site).toBe("Target")
    expect(goal.url).toBe("https://www.target.com")
  })

  it("handles intent with no attributes", () => {
    const noAttrIntent: ExtractedIntent = {
      type: "product_search",
      product: "Widget",
      attributes: {},
      sourceSite: "amazon.com"
    }
    const goal = makeSmartSimilarGoal(noAttrIntent, site)
    expect(goal.goal).toContain("none specified")
  })

  it("handles intent with no category", () => {
    const noCatIntent: ExtractedIntent = {
      type: "product_search",
      product: "Widget",
      attributes: {},
      sourceSite: "amazon.com"
    }
    const goal = makeSmartSimilarGoal(noCatIntent, site)
    expect(goal.goal).toContain("general")
  })
})

// ─── 9. Integration test: full orchestration flow ───────────────────────

describe("orchestrate (integration with mocked fetch)", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  // Helper to create an SSE stream from events
  function makeSSEStream(events: Array<{ type: string; data: Record<string, unknown> }>) {
    const lines = events
      .map((e) => `data: ${JSON.stringify({ type: e.type, ...e.data })}`)
      .join("\n\n")

    const encoder = new TextEncoder()
    let consumed = false

    return {
      ok: true,
      status: 200,
      statusText: "OK",
      body: {
        getReader: () => ({
          read: async () => {
            if (!consumed) {
              consumed = true
              return { done: false, value: encoder.encode(lines + "\n") }
            }
            return { done: true, value: undefined }
          }
        })
      },
      text: async () => lines,
      json: async () => ({})
    } as unknown as Response
  }

  // Featherless response helper
  function makeFeatherlessResponse(intent: Partial<ExtractedIntent>) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent: {
                  type: "product_search",
                  product: "Echo Dot",
                  attributes: {},
                  sourceSite: "amazon.com",
                  ...intent
                },
                agentGoals: []
              })
            }
          }
        ]
      }),
      text: async () => ""
    } as unknown as Response
  }

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("fast extract succeeds — exact agents dispatch immediately, featherless fires for similar", async () => {
    const capture = makeCapture({
      url: "https://www.amazon.com/dp/B09X",
      title: "Amazon.com: Echo Dot (5th Gen) - Smart Speaker",
      html: "<div>$49.99</div>",
      events: []
    })

    // Track which URLs are called
    const calledUrls: string[] = []

    fetchMock.mockImplementation(async (url: string, opts: any) => {
      calledUrls.push(url)

      if (url.includes("featherless.ai")) {
        return makeFeatherlessResponse({ category: "smart speakers" })
      }

      // TinyFish agents
      return makeSSEStream([
        { type: "STREAMING_URL", data: { streaming_url: "https://stream.example.com/abc" } },
        {
          type: "COMPLETE",
          data: {
            result_json: {
              product: "Echo Dot",
              price: "$29.99",
              available: true,
              url: "https://example.com/echo-dot"
            }
          }
        }
      ])
    })

    const events: string[] = []
    const callbacks = {
      onIntentExtracted: (intent: string, product: string) => {
        events.push(`intent:${product}`)
      },
      onAgentUpdate: (agents: AgentState[]) => {
        events.push(`update:${agents.length}`)
      },
      onComplete: (agents: AgentState[]) => {
        events.push(`complete:${agents.length}`)
      },
      onSimilarSearchStart: () => {
        events.push("similar_start")
      },
      onError: (error: string) => {
        events.push(`error:${error}`)
      }
    }

    await orchestrate(capture, "featherless-key", "tinyfish-key", callbacks)

    // Fast extract should succeed — product extracted from title
    expect(events[0]).toBe("intent:Echo Dot (5th Gen) - Smart Speaker")

    // Featherless was called (for rich intent / similar goals)
    expect(calledUrls.some((u) => u.includes("featherless.ai"))).toBe(true)

    // TinyFish agents were called
    expect(calledUrls.some((u) => u.includes("tinyfish.ai"))).toBe(true)

    // similar_start should have been called
    expect(events).toContain("similar_start")

    // complete should have been called
    expect(events.some((e) => e.startsWith("complete:"))).toBe(true)
  })

  it("fast extract fails — featherless fires synchronously before agents", async () => {
    const capture = makeCapture({
      url: "https://www.amazon.com/dp/B09X",
      title: "am", // Too short — fast extract fails
      html: "<div>$49.99</div>",
      events: []
    })

    const callOrder: string[] = []

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("featherless.ai")) {
        callOrder.push("featherless")
        return makeFeatherlessResponse({
          product: "Echo Dot from LLM",
          category: "smart speakers"
        })
      }

      callOrder.push("tinyfish")
      return makeSSEStream([
        {
          type: "COMPLETE",
          data: {
            result_json: {
              product: "Echo Dot",
              price: "$29.99",
              available: true,
              url: "https://example.com"
            }
          }
        }
      ])
    })

    const intentProducts: string[] = []
    const callbacks = {
      onIntentExtracted: (_intent: string, product: string) => {
        intentProducts.push(product)
      },
      onAgentUpdate: () => {},
      onComplete: () => {},
      onSimilarSearchStart: () => {},
      onError: () => {}
    }

    await orchestrate(capture, "featherless-key", "tinyfish-key", callbacks)

    // When fast extract fails, Featherless is called synchronously FIRST
    expect(callOrder[0]).toBe("featherless")

    // Product should come from the LLM
    expect(intentProducts[0]).toBe("Echo Dot from LLM")
  })

  it("all agents complete — callbacks fire with correct final state", async () => {
    const capture = makeCapture({
      url: "https://www.newegg.com/p/12345",
      title: "Newegg: Some GPU Card - Newegg.com",
      html: "<div>$599.99</div>",
      events: []
    })

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("featherless.ai")) {
        return makeFeatherlessResponse({ product: "GPU Card" })
      }
      return makeSSEStream([
        {
          type: "COMPLETE",
          data: {
            result_json: {
              product: "GPU Card",
              price: "$549.99",
              available: true,
              url: "https://example.com/gpu"
            }
          }
        }
      ])
    })

    let finalAgents: AgentState[] = []
    const callbacks = {
      onIntentExtracted: () => {},
      onAgentUpdate: () => {},
      onComplete: (agents: AgentState[]) => {
        finalAgents = agents
      },
      onSimilarSearchStart: () => {},
      onError: () => {}
    }

    await orchestrate(capture, "fk", "tk", callbacks)

    // All agents should be present
    expect(finalAgents.length).toBeGreaterThan(0)

    // Each agent should have a complete or not_found status
    for (const agent of finalAgents) {
      expect(["complete", "not_found"]).toContain(agent.status)
    }

    // At least one agent should have a price
    const withPrices = finalAgents.filter(
      (a) => a.status === "complete" && a.result?.price
    )
    expect(withPrices.length).toBeGreaterThan(0)
  })

  it("agents that return empty results are marked not_found", async () => {
    const capture = makeCapture({
      url: "https://www.target.com/p/12345",
      title: "Target: Obscure Artisanal Widget - Target"
    })

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("featherless.ai")) {
        return makeFeatherlessResponse({ product: "Obscure Artisanal Widget" })
      }
      // All TinyFish agents return not-found
      return makeSSEStream([
        {
          type: "COMPLETE",
          data: {
            result_json: {
              product: "",
              price: "",
              available: false,
              url: ""
            }
          }
        }
      ])
    })

    let finalAgents: AgentState[] = []
    const callbacks = {
      onIntentExtracted: () => {},
      onAgentUpdate: () => {},
      onComplete: (agents: AgentState[]) => {
        finalAgents = agents
      },
      onSimilarSearchStart: () => {},
      onError: () => {}
    }

    await orchestrate(capture, "fk", "tk", callbacks)

    // All agents should be marked not_found
    for (const agent of finalAgents) {
      expect(agent.status).toBe("not_found")
    }
  })

  it("handles featherless error gracefully when fast extract also fails", async () => {
    const capture = makeCapture({
      url: "https://www.amazon.com/dp/X",
      title: "A", // too short
      html: "",
      events: []
    })

    fetchMock.mockImplementation(async () => {
      return {
        ok: false,
        status: 500,
        text: async () => "Internal Server Error"
      } as unknown as Response
    })

    const errors: string[] = []
    const callbacks = {
      onIntentExtracted: () => {},
      onAgentUpdate: () => {},
      onComplete: () => {},
      onSimilarSearchStart: () => {},
      onError: (error: string) => {
        errors.push(error)
      }
    }

    await orchestrate(capture, "fk", "tk", callbacks)

    // Should have received an error callback
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain("Intent extraction failed")
  })

  it("source site is excluded from exact goals", async () => {
    const capture = makeCapture({
      url: "https://www.ebay.com/itm/12345",
      title: "Cool Gadget | eBay",
      html: "<div>$19.99</div>",
      events: []
    })

    const tinyfishSites: string[] = []

    fetchMock.mockImplementation(async (url: string, opts: any) => {
      if (url.includes("featherless.ai")) {
        return makeFeatherlessResponse({ product: "Cool Gadget" })
      }

      // Track which site each TinyFish call targets
      const body = JSON.parse(opts.body)
      tinyfishSites.push(body.url)

      return makeSSEStream([
        {
          type: "COMPLETE",
          data: {
            result_json: {
              product: "Cool Gadget",
              price: "$19.99",
              available: true,
              url: "https://example.com"
            }
          }
        }
      ])
    })

    const callbacks = {
      onIntentExtracted: () => {},
      onAgentUpdate: () => {},
      onComplete: () => {},
      onSimilarSearchStart: () => {},
      onError: () => {}
    }

    await orchestrate(capture, "fk", "tk", callbacks)

    // None of the TinyFish calls should target ebay.com
    for (const siteUrl of tinyfishSites) {
      expect(siteUrl).not.toContain("ebay.com")
    }
  })
})
