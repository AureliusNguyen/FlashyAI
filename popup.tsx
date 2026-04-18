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
    <div className="w-80 p-4 bg-[#0a0a0f]">
      <div className="text-lg font-bold bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent mb-4">
        FlashyAI Settings
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs text-zinc-400 mb-1">TinyFish API Key</label>
          <input
            type="password"
            value={tinyfishKey}
            onChange={(e) => setTinyfishKey(e.target.value)}
            placeholder="sk-mino-..."
            className="w-full px-3 py-2 rounded-md bg-zinc-900 border border-zinc-700 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Featherless API Key</label>
          <input
            type="password"
            value={featherlessKey}
            onChange={(e) => setFeatherlessKey(e.target.value)}
            placeholder="fl-..."
            className="w-full px-3 py-2 rounded-md bg-zinc-900 border border-zinc-700 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
          />
        </div>

        <button
          onClick={handleSave}
          className="w-full py-2 px-4 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors"
        >
          {saved ? "Saved!" : "Save Keys"}
        </button>

        <hr className="border-zinc-800" />

        <button
          onClick={openSidePanel}
          className="w-full py-2 px-4 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium transition-colors"
        >
          Open Side Panel
        </button>
      </div>

      <div className="mt-4 text-xs text-zinc-600 text-center">
        Keys are stored locally in your browser.
      </div>
    </div>
  )
}

export default Popup
