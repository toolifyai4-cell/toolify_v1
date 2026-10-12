/**
 * ExtensionStateContext — the single source of truth for the webview's
 * reactive state.
 *
 * Mirrors the original Cline ExtensionStateContext pattern:
 *   - On mount, requests the initial state snapshot from the extension
 *   - Subscribes to streaming state updates via the gRPC client
 *   - Exposes state + helper RPCs to all child components via React Context
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { getGrpcClient } from "../services/grpc-client.js"
import type { ExtensionState, ClineMessage } from "@shared/ExtensionMessage.js"

export interface ExtensionStateContextType extends ExtensionState {
		isReady: boolean
	sendPrompt: (text: string) => void
	startNewTask: (goal: string, mode?: "plan" | "act") => void
	cancelTask: () => void
	clearHistory: () => void
	updateConfig: (config: { apiKeys?: Record<string, string>; baseUrls?: Record<string, string>; theme?: string }) => void
	runCommand: (command: string, cwd?: string) => void
	toggleMode: () => void
	toggleAutoApprove: () => void
	openSettings: () => void
	openHistory: () => void
	openAccount: () => void
	closeModals: () => void
}

const ExtensionStateContext = createContext<ExtensionStateContextType | undefined>(undefined)

const DEFAULT_STATE: ExtensionState = {
	clineMessages: [],
	mode: "act",
	autoApprovalSettings: { mode: "off" },
	apiConfiguration: { provider: "anthropic", model: "claude-3-5-sonnet-20241022" },
			workspace: "",
	isRunning: false,
	platform: "linux",
	isAuthenticated: false,
	usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
	showWelcome: true,
	shouldShowAnnouncement: false,
	taskHistory: [],
}

export function ExtensionStateProvider({ children }: { children: React.ReactNode }): React.ReactElement {
	const [state, setState] = useState<ExtensionState>(DEFAULT_STATE)
	const [isReady, setIsReady] = useState(false)
	const grpcRef = useRef(getGrpcClient())
	const mountedRef = useRef(true)

	const mergeState = useCallback((patch: Partial<ExtensionState>) => {
		if (!mountedRef.current) return
		setState((prev) => ({ ...prev, ...patch }))
	}, [])

	useEffect(() => {
		mountedRef.current = true
		const loadInitialState = async () => {
			try {
				await grpcRef.current.subscribeToState({ subscribe: true })
				setIsReady(true)
			} catch (err) {
				console.warn("[ExtensionStateContext] initial state load failed:", err)
				setIsReady(true)
			}
		}
		void loadInitialState()
		return () => { mountedRef.current = false }
	}, [])

	useEffect(() => {
		const client = grpcRef.current
		if (typeof window !== "undefined") {
			const listener = (e: MessageEvent) => {
				const msg = e.data as any
				if (msg?.type === "grpc_response" && msg.grpc_response?.message?.type === "state_updated") {
					mergeState(msg.grpc_response.message.state)
				} else if (msg?.type === "grpc_response" && msg.grpc_response?.message?.type === "agent_stream") {
					const data = msg.grpc_response.message.data
					if (data?.clineMessage) {
						setState((prev) => ({
							...prev,
							clineMessages: [...(prev.clineMessages ?? []), data.clineMessage],
						}))
					}
					if (data?.isRunning !== undefined) mergeState({ isRunning: data.isRunning })
					if (data?.usage) mergeState({ usage: data.usage })
				}
			}
			window.addEventListener("message", listener)
			return () => window.removeEventListener("message", listener)
		}
	}, [mergeState])

		// --- Action handlers ---
	const sendPrompt = useCallback(async (text: string) => {
		try { await grpcRef.current.sendMessage(text) } catch (err) {
			console.error("[ExtensionStateContext] sendPrompt failed:", err)
		}
	}, [])

	const startNewTask = useCallback(async (goal: string, mode: "plan" | "act" = "act") => {
		try { await grpcRef.current.startNewTask(goal, mode) } catch (err) {
			console.error("[ExtensionStateContext] startNewTask failed:", err)
		}
	}, [])

	const cancelTask = useCallback(async () => {
		try { await grpcRef.current.cancelTask() } catch (err) {
			console.error("[ExtensionStateContext] cancelTask failed:", err)
		}
	}, [])

	const clearHistoryCb = useCallback(async () => {
		try { await grpcRef.current.clearHistory() } catch (err) {
			console.error("[ExtensionStateContext] clearHistory failed:", err)
		}
	}, [])

	const updateConfigCallback = useCallback(async (config: { apiKeys?: Record<string, string>; baseUrls?: Record<string, string>; theme?: string }) => {
		try { await grpcRef.current.updateConfig(config) } catch (err) {
			console.error("[ExtensionStateContext] updateConfig failed:", err)
		}
	}, [])

	const runCommand = useCallback((command: string, cwd?: string) => {
		void grpcRef.current.runCommand(command, cwd)
	}, [])

	const toggleMode = useCallback(() => {
		setState((prev) => ({ ...prev, mode: prev.mode === "act" ? "plan" : "act" }))
	}, [])

	const toggleAutoApprove = useCallback(() => {
		setState((prev) => {
			const cur = prev.autoApprovalSettings.mode
			const next = cur === "off" ? "writes" : cur === "writes" ? "all" : "off"
			return { ...prev, autoApprovalSettings: { mode: next } }
		})
	}, [])

		const showSettingsCb = useCallback(() => setState((prev) => ({ ...prev, showSettings: true })), [])
	const showHistoryCb = useCallback(() => setState((prev) => ({ ...prev, showHistory: true })), [])
	const showAccountCb = useCallback(() => setState((prev) => ({ ...prev, showAccount: true })), [])
	const closeModals = useCallback(() => setState((prev) => ({ ...prev, showSettings: false, showHistory: false, showAccount: false })), [])

	const contextValue: ExtensionStateContextType = {
		...state,
		isReady,
		sendPrompt,
		startNewTask,
		cancelTask,
		clearHistory: clearHistoryCb,
		updateConfig: updateConfigCallback,
		runCommand,
		toggleMode,
		toggleAutoApprove,
				openSettings: showSettingsCb,
		openHistory: showHistoryCb,
		openAccount: showAccountCb,
		closeModals,
	}

	return (
		<ExtensionStateContext.Provider value={contextValue}>
			{children}
		</ExtensionStateContext.Provider>
	)
}

export function useExtensionState(): ExtensionStateContextType {
	const ctx = useContext(ExtensionStateContext)
	if (!ctx) {
		throw new Error("useExtensionState must be used within ExtensionStateProvider")
	}
	return ctx
}

export function useExtensionStateRaw(): { state: ExtensionState; setState: React.Dispatch<React.SetStateAction<ExtensionState>> } {
	const ctx = useContext(ExtensionStateContext)
	if (!ctx) {
		throw new Error("useExtensionStateRaw must be used within ExtensionStateProvider")
	}
	return { state: ctx, setState: () => {} }
}

export type { ClineMessage }
