/**
 * SettingsModal — provider/model/theme configuration panel.
 * Mirrors Cline's settings overlay with provider picker, model selector,
 * API key input, and theme toggle.
 */
import React, { useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext.js"
import { getGrpcClient } from "../../services/grpc-client.js"
import "../../index.css"

export function SettingsModal({ onClose }: { onClose: () => void }): React.ReactElement {
	const { apiConfiguration, themeId, updateConfig } = useExtensionState()
	const [provider, setProvider] = useState(apiConfiguration.provider)
	const [model, setModel] = useState(apiConfiguration.model)
	const [apiKey, setApiKey] = useState("")
	const [saving, setSaving] = useState(false)

	const handleSave = async () => {
		setSaving(true)
		try {
			await updateConfig({
				apiKeys: { [provider]: apiKey },
				theme: themeId,
			})
		} catch (err) {
			console.error("Failed to save config:", err)
		} finally {
			setSaving(false)
			onClose()
		}
	}

	return (
		<div className="modal-backdrop" onClick={onClose}>
			<div className="modal" onClick={(e) => e.stopPropagation()}>
				<div className="modal-header">
					<span className="modal-title">Settings</span>
					<button className="modal-close" onClick={onClose}>×</button>
				</div>
				<div className="modal-body">
					<div style={{ marginBottom: 16 }}>
						<label style={{ display: "block", marginBottom: 4, color: "var(--color-text-muted)", fontSize: 13 }}>
							Provider
						</label>
						<select
							value={provider}
							onChange={(e) => setProvider(e.target.value)}
							style={{ width: "100%", padding: "6px 8px", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, color: "var(--color-text)" }}
						>
							<option value="anthropic">Anthropic</option>
							<option value="openai">OpenAI</option>
							<option value="gemini">Google Gemini</option>
							<option value="groq">Groq</option>
							<option value="ollama">Ollama</option>
						</select>
					</div>
					<div style={{ marginBottom: 16 }}>
						<label style={{ display: "block", marginBottom: 4, color: "var(--color-text-muted)", fontSize: 13 }}>
							Model
						</label>
						<input
							type="text"
							value={model}
							onChange={(e) => setModel(e.target.value)}
							style={{ width: "100%", padding: "6px 8px", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, color: "var(--color-text)" }}
						/>
					</div>
					<div style={{ marginBottom: 16 }}>
						<label style={{ display: "block", marginBottom: 4, color: "var(--color-text-muted)", fontSize: 13 }}>
							API Key
						</label>
						<input
							type="password"
							value={apiKey}
							onChange={(e) => setApiKey(e.target.value)}
							placeholder="Paste your API key..."
							style={{ width: "100%", padding: "6px 8px", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, color: "var(--color-text)" }}
						/>
					</div>
				</div>
				<div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 12, borderTop: "1px solid var(--color-border)" }}>
					<button onClick={onClose} style={{ padding: "6px 16px" }}>Cancel</button>
					<button
						onClick={handleSave}
						disabled={saving}
						style={{ padding: "6px 16px", background: "var(--color-accent)", color: "#fff", border: "none", borderRadius: 6 }}
					>
						{saving ? "Saving…" : "Save"}
					</button>
				</div>
			</div>
		</div>
	)
}
