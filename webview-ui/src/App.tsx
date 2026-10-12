/**
 * App — root webview component.
 *
 * Renders the ChatView (message transcript + input), the thinking
 * indicator, and modal overlays (settings, history, account).
 *
 * Layout mirrors Cline's App.tsx: a vertical flex column with the chat
 * transcript in the middle, flanked by header (mode toggle, provider)
 * and footer (input box, auto-approve indicator).
 */
import React, { useState } from "react"
import { ChatView } from "./components/chat/ChatView.js"
import { SettingsModal } from "./components/modals/SettingsModal.js"
import { HistoryModal } from "./components/modals/HistoryModal.js"
import { AccountModal } from "./components/modals/AccountModal.js"
import { WelcomeView } from "./components/WelcomeView.js"
import { useExtensionState } from "./context/ExtensionStateContext.js"

export function App(): React.ReactElement {
		const {
			isReady,
		mode,
		isRunning,
		showWelcome,
		showSettings,
		showHistory,
		showAccount,
		closeModals,
		toggleMode,
		startNewTask,
		openSettings,
		openHistory,
		openAccount,
	} = useExtensionState()

	if (!isReady) {
		return <div className="loading-overlay">Connecting to TOOLIFY…</div>
	}

	if (showWelcome) {
		return <WelcomeView onGetStarted={() => {
			startNewTask("Hello! You are TOOLIFY, a coding agent. Explain what you do and help me get started.", "act")
		}} />
	}

	return (
		<div className="app">
					{showSettings && <SettingsModal onClose={closeModals} />}
			{showHistory && <HistoryModal onClose={closeModals} />}
			{showAccount && <AccountModal onClose={closeModals} />}

			<ChatView />
		</div>
	)
}

export default App