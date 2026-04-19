import React, { useEffect, useState } from "react"
import "./style.css"

function Popup() {
  const [tinyfishKey, setTinyfishKey] = useState("")
  const [featherlessKey, setFeatherlessKey] = useState("")
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    chrome.storage.local.get(["tinyfishKey", "featherlessKey"], (result) => {
      if (result.tinyfishKey) setTinyfishKey(result.tinyfishKey)
      if (result.featherlessKey) setFeatherlessKey(result.featherlessKey)
    })
  }, [])

  const handleSave = () => {
    chrome.storage.local.set({ tinyfishKey, featherlessKey }, () => {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  const openSidePanel = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id })
    }
    window.close()
  }

  return (
    <div className="w-80 p-4 bg-background">
      {/* Header */}
      <div className="font-mono-display text-[11px] tracking-[0.25em] uppercase text-primary mb-4">
        FLASHYAI ▪ CONFIGURATION
      </div>

      <div className="space-y-3">
        <div>
          <label className="block font-mono-display text-[9px] tracking-[0.2em] uppercase text-muted-foreground mb-1">
            TINYFISH API KEY
          </label>
          <input
            type="password"
            value={tinyfishKey}
            onChange={(e) => setTinyfishKey(e.target.value)}
            placeholder="sk-tinyfish-..."
            className="w-full px-3 py-2 bg-surface border border-border text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-primary focus:outline-none font-mono-display text-xs"
          />
        </div>

        <div>
          <label className="block font-mono-display text-[9px] tracking-[0.2em] uppercase text-muted-foreground mb-1">
            FEATHERLESS API KEY
          </label>
          <input
            type="password"
            value={featherlessKey}
            onChange={(e) => setFeatherlessKey(e.target.value)}
            placeholder="rc_..."
            className="w-full px-3 py-2 bg-surface border border-border text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-primary focus:outline-none font-mono-display text-xs"
          />
        </div>

        <button
          onClick={handleSave}
          className="w-full py-2 px-4 border border-primary bg-primary/10 hover:bg-primary/20 font-mono-display text-[10px] tracking-[0.25em] uppercase text-primary transition-colors"
        >
          {saved ? "▸ SAVED" : "▸ SAVE CONFIGURATION"}
        </button>

        <div className="border-t border-border pt-3">
          <button
            onClick={openSidePanel}
            className="w-full py-2 px-4 border border-border bg-surface hover:bg-surface-raised font-mono-display text-[10px] tracking-[0.25em] uppercase text-foreground transition-colors"
          >
            ▸ OPEN MISSION CONTROL
          </button>
        </div>
      </div>

      <div className="mt-4 font-mono-display text-[8px] tracking-[0.2em] uppercase text-muted-foreground/40 text-center">
        CREDENTIALS STORED LOCALLY
      </div>
    </div>
  )
}

export default Popup
