/**
 * Providers — wraps the app in the ExtensionStateContext provider.
 * Mirrors Cline's `Providers.tsx` pattern.
 */
import React from "react"
import { ExtensionStateProvider } from "./context/ExtensionStateContext.js"

export function Providers({ children }: { children: React.ReactNode }): React.ReactElement {
	return (
		<ExtensionStateProvider>
			{children}
		</ExtensionStateProvider>
	)
}