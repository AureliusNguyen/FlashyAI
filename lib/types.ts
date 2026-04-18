// === Content Script → Service Worker ===

export interface DOMEvent {
  type: "click" | "input" | "select" | "scroll"
  selector: string
  text: string
  value?: string
  timestamp: number
}

export interface PageCapture {
  url: string
  title: string
  html: string
  events: DOMEvent[]
  timestamp: number
}

// === Featherless LLM Response ===

export interface ExtractedIntent {
  type: "product_search" | "general_search" | "unknown"
  product: string
  attributes: Record<string, string>
  currentPrice?: string
  sourceSite: string
  category?: string
}

export interface AgentGoal {
  site: string
  url: string
  goal: string
}

export interface IntentResponse {
  intent: ExtractedIntent
  agentGoals: AgentGoal[]
}

// === Agent State ===

export type AgentStatus = "queued" | "connecting" | "streaming" | "complete" | "not_found" | "error"
export type MatchType = "exact" | "similar"

export interface AgentState {
  id: string
  site: string
  status: AgentStatus
  matchType: MatchType
  streamingUrl?: string
  result?: AgentResult
  error?: string
}

export interface AgentResult {
  product?: string
  price?: string
  available?: boolean
  url?: string
  raw?: unknown
}

// === Message passing ===

export type MessageType =
  | "PAGE_CAPTURE"
  | "FLASH_IT"
  | "AGENT_UPDATE"
  | "ORCHESTRATION_START"
  | "ORCHESTRATION_COMPLETE"
  | "INTENT_EXTRACTED"
  | "SIMILAR_SEARCH_START"
  | "ERROR"

export interface ExtensionMessage {
  type: MessageType
  payload?: unknown
}
