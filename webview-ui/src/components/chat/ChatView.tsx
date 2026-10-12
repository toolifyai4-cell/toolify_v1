/**
 * ChatView — the main chat transcript + message input, rendered as a
 * web DOM (React) component inside the VS Code webview.
 *
 * Mirrors the responsibilities of the terminal ChatUI:
 *   - Renders ClineMessage[] transcript (user/assistant/system messages)
 *   - Shows a thinking spinner while isRunning
 *   - Auto-scrolls to bottom on new messages
 *   - Renders an input box + send button at the bottom
 *   - Shows mode toggle (plan/act) and provider/model in the header
 */
import React, { useState, useRef, useEffect } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext.js"
import type { ClineMessage } from "@shared/ExtensionMessage.js"
import "./ChatView.css"

export function ChatView(): React.ReactElement {
	const {
		clineMessages,
		isRunning,
		mode,
		apiConfiguration,
		autoApprovalSettings,
		toggleMode,
		toggleAutoApprove,
		sendPrompt,
		cancelTask,
	} = useExtensionState()

	const [input, setInput] = useState("")
	const [isComposing, setIsComposing] = useState(false) // IME composition
	const inputRef = useRef<HTMLTextAreaElement>(null)
	const bottomRef = useRef<HTMLDivElement>(null)

	// Auto-scroll to bottom on new messages.
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: isRunning ? "smooth" : "auto" })
	}, [clineMessages, isRunning])

	const handleSubmit = () => {
		const text = input.trim()
		if (!text) return
		sendPrompt(text)
		setInput("")
		if (inputRef.current) inputRef.current.value = ""
	}

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey && !isComposing) {
			e.preventDefault()
			handleSubmit()
		}
	}

	const handleCancel = () => {
		if (isRunning) cancelTask()
	}

	// Group consecutive assistant messages for rendering.
	const grouped = groupAssistantMessages(clineMessages)

	return (
		<div className="chat-view-container">
			{/* Header */}
			<div className="chat-header">
				<div className="mode-toggle">
					<button
						className={`mode-btn ${mode === "act" ? "active" : ""}`}
						onClick={toggleMode}
						title="Switch to Act mode"
					>
						Act
					</button>
					<button
						className={`mode-btn ${mode === "plan" ? "active" : ""}`}
						onClick={toggleMode}
						title="Switch to Plan mode"
					>
						Plan
					</button>
				</div>
				<div className="provider-info">
					{apiConfiguration.provider} · {apiConfiguration.model}
				</div>
				<div className="auto-approve-indicator">
					<button
						className={`approve-btn ${autoApprovalSettings.mode !== "off" ? "active" : ""}`}
						onClick={toggleAutoApprove}
						title="Auto-approve tools"
					>
						{autoApprovalSettings.mode === "off"
							? "Auto-approve: off"
							: autoApprovalSettings.mode === "writes"
							? "Auto-approve: writes"
							: "Auto-approve: all"}
					</button>
				</div>
			</div>

			{/* Transcript */}
			<div className="chat-transcript">
				{grouped.length === 0 && !isRunning && (
					<div className="empty-state">
						Send a message to start chatting with TOOLIFY.
					</div>
				)}

				{grouped.map((item, i) => renderGroup(item, i))}

				{isRunning && (
					<div className="thinking-indicator">
						<span className="thinking-dot" />
						TOOLIFY is thinking…
					</div>
				)}

				<div ref={bottomRef} className="bottom-anchor" />
			</div>

			{/* Input area */}
			<div className="chat-input-area">
				<textarea
					ref={inputRef}
					className="chat-input"
					placeholder={isRunning ? "TOOLIFY is thinking…" : "Ask TOOLIFY anything…"}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onCompositionStart={() => setIsComposing(true)}
					onCompositionEnd={() => setIsComposing(false)}
					onKeyDown={handleKeyDown}
					disabled={isRunning}
					rows={1}
				/>
				{isRunning ? (
					<button className="send-btn" onClick={handleCancel}>
						Stop
					</button>
				) : (
					<button
						className={`send-btn ${input.trim() ? "active" : ""}`}
						onClick={handleSubmit}
						disabled={!input.trim()}
					>
						Send
					</button>
				)}
			</div>
		</div>
	)
}

/** Group consecutive assistant messages into a single renderable block. */
function groupAssistantMessages(messages: ClineMessage[]): GroupedMessage[] {
	const groups: GroupedMessage[] = []
	for (const msg of messages) {
		if (msg.type === "say" && msg.say === "assistant") {
			const last = groups[groups.length - 1]
			if (last && last.role === "assistant") {
				last.content += msg.text ?? ""
			} else {
				groups.push({ role: "assistant", content: msg.text ?? "" })
			}
		} else if (msg.type === "say" && msg.say === "user") {
			groups.push({ role: "user", content: msg.text ?? "" })
				} else if (msg.type === "say") {
			groups.push({ role: "system", content: ("text" in msg ? msg.text : "") ?? "", kind: msg.say as any })
		} else if (msg.type === "ask") {
			groups.push({ role: "system", content: msg.text ?? "", kind: msg.ask })
		}
	}
	return groups
}

interface GroupedMessage {
	role: "user" | "assistant" | "system"
	content: string
	kind?: string
}

function renderGroup(group: GroupedMessage, key: number): React.ReactElement {
	const content = group.content || "\u00a0"

	if (group.role === "assistant") {
		return (
			<div key={key} className="msg assistant-msg">
				<div className="msg-avatar">🤖</div>
				<div className="msg-content" dangerouslySetInnerHTML={{ __html: formatContent(content) }} />
			</div>
		)
	}
	if (group.role === "user") {
		return (
			<div key={key} className="msg user-msg">
				<div className="msg-content">{content}</div>
				<div className="msg-avatar">👤</div>
			</div>
		)
	}
	return (
		<div key={key} className="msg system-msg">
			<div className="msg-content">{group.kind}: {content}</div>
		</div>
	)
}

/** Convert newlines to <br/> for display. */
function formatContent(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/\n/g, "<br/>")
}