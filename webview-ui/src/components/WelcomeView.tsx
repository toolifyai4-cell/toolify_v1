/**
 * WelcomeView — shown on first launch or when no conversation is active.
 * Mirrors Cline's welcome screen with a "get started" prompt.
 */
import React from "react"
import "./WelcomeView.css"

export function WelcomeView({ onGetStarted }: {
	onGetStarted: () => void
}): React.ReactElement {
	return (
		<div className="welcome-container">
			<div className="welcome-content">
				<h1 className="welcome-title">TOOLIFY</h1>
				<p className="welcome-subtitle">
					Your AI coding agent — powered by the terminal.
				</p>
				<div className="welcome-features">
					<div className="feature">🔧 Full terminal & shell access</div>
					<div className="feature">📂 File reading, editing & creation</div>
					<div className="feature">🔍 Code search & navigation</div>
					<div className="feature">🔐 Secure credential management</div>
				</div>
				<button className="welcome-cta" onClick={onGetStarted}>
					Get Started
				</button>
			</div>
		</div>
	)
}
