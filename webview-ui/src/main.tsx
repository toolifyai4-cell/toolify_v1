/**
 * main — webview entry point.
 *
 * Acquires the VS Code webview API (or uses the dev-mode shim) and
 * mounts the React root with the Providers wrapper.
 */
import React from "react"
import ReactDOM from "react-dom/client"
import { App } from "./App.js"
import { Providers } from "./Providers.js"
import "./index.css"

const root = ReactDOM.createRoot(document.getElementById("root")!)

root.render(
	<React.StrictMode>
		<Providers>
			<App />
		</Providers>
	</React.StrictMode>,
)
