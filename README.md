# FlashyAI - Mission Control

**One click to dispatch parallel AI agents that search every site for you — and you watch them work live.**

FlashyAI is a Chrome extension that observes what you're browsing, extracts your shopping intent (product, size, color, price preferences), then spawns parallel browser agents across multiple retailer sites to find the same product or similar alternatives — all visible in real-time through live browser feeds.

## How It Works

```
User browses Amazon product page
        |
        v
[Click "Dispatch Probes"]
        |
        v
Content Script captures page HTML + DOM events (clicks, filters, searches)
        |
        v
Fast Extract: regex parses product name + attributes from title/events
        |                                           |
        v                                           v
Featherless LLM (background)              TinyFish Agent API x3
extracts rich intent:                     dispatches parallel browser agents:
- category: "smart speakers"              - eBay: searching...
- color: "Deep Sea Blue"                  - Target: searching...
- price: "$49.99"                         - Newegg: searching...
        |                                           |
        v                                           v
Smart similar-product goals         Live iframe feeds in side panel
using extracted attributes          showing agents navigating in real-time
        |                                           |
        v                                           v
    Results aggregated: prices, availability, links
    Best deal highlighted with "TARGET LOCKED" badge
```

## Architecture

- **No backend** — everything runs from the Chrome extension
- **Content Script** — captures DOM events (clicks, filter selections, search inputs) for intent analysis
- **Service Worker** — orchestrates the pipeline, manages session cancellation
- **Featherless AI** — LLM inference (Hermes-2-Pro-Llama-3-8B) for intent extraction from page context + user interactions
- **TinyFish Agent API** — autonomous browser agents that navigate real websites with stealth mode
- **Side Panel UI** — "Mission Control" themed dashboard with live agent feeds, exact/variant tabs, best deal detection

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Extension Framework | [Plasmo](https://www.plasmo.com/) |
| UI | React + TypeScript + Tailwind CSS |
| LLM Inference | [Featherless AI](https://featherless.ai/) (OpenAI-compatible, 30k+ open-source models) |
| Browser Agents | [TinyFish Agent API](https://docs.tinyfish.ai/) (autonomous web agents with live streaming) |
| Theme | Mission Control — NASA Apollo-era console aesthetic |

## Setup

### Prerequisites

- Node.js 18+
- npm
- Google Chrome
- API keys for [TinyFish](https://agent.tinyfish.ai/api-keys) and [Featherless](https://featherless.ai/)

### Installation

```bash
# Clone the repo
git clone https://github.com/AureliusNguyen/FlashyAI.git
cd FlashyAI

# Install dependencies
npm install

# Create your .env file from the example
cp .env.example .env
```

### Configure API Keys

Edit `.env` and add your keys:

```
PLASMO_PUBLIC_TINYFISH_API_KEY=sk-tinyfish-your-key-here
PLASMO_PUBLIC_FEATHERLESS_API_KEY=your-featherless-key-here
```

### Build

```bash
# Production build
npm run build

# Or development mode with hot reload
npm run dev
```

### Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `build/chrome-mv3-prod` folder (or `build/chrome-mv3-dev` for dev mode)
5. The FlashyAI icon appears in your toolbar

### First Run

1. Navigate to a product page on Amazon, eBay, Target, or Newegg
2. Click the FlashyAI extension icon to open the side panel
3. Click **DISPATCH PROBES**
4. Watch the agents search in real-time

## Running Tests

```bash
npm test
```

88 tests covering:
- Product name extraction from retailer page titles
- TinyFish response parsing (flat, nested, truncated JSON)
- Intent attribute extraction from DOM events
- Best deal calculation
- Full orchestration flow with mocked APIs

## Supported Sites

**Source sites** (where you browse): Amazon, eBay, Target, Newegg, Costco, Nike, Etsy, Home Depot, Nordstrom, and more

**Search targets** (where agents search): eBay, Target, Newegg, Costco (primary) + additional backup sites

## Project Structure

```
FlashyAI/
  background.ts          # Service worker — orchestration hub
  sidepanel.tsx           # Mission Control side panel UI
  popup.tsx               # Extension popup (API key settings)
  contents/
    capture.ts            # DOM event capture content script
  components/
    AgentCard.tsx          # Probe telemetry module with live iframe
    AgentGrid.tsx          # Grid with best deal detection
    BestDeal.tsx           # PRIMARY TARGET ACQUIRED panel
    StatusLamp.tsx         # Glowing status indicator
    StatusBracket.tsx      # [ BRACKETED ] status labels
    RadarSpinner.tsx       # Conic-gradient radar sweep
  lib/
    orchestrator.ts        # Pipeline: fast extract -> Featherless -> TinyFish
    tinyfish.ts            # TinyFish SSE client
    featherless.ts         # Featherless LLM client (intent extraction)
    types.ts               # Shared TypeScript interfaces
    cn.ts                  # Classname utility
  style.css                # Mission Control design system (HSL tokens)
  tailwind.config.js       # Semantic color tokens, animations
  tests/
    flashy.test.ts         # Unit + integration tests
```

## Team

Built at hackathon 2026 by [AureliusNguyen](https://github.com/AureliusNguyen) and team.

Powered by [TinyFish](https://tinyfish.ai/) and [Featherless AI](https://featherless.ai/).
