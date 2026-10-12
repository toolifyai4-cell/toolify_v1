/**
 * AccountModal — shows auth status and logout button.
 */
import React from "react"
import { useExtensionState } from "../../context/ExtensionStateContext.js"
import { getGrpcClient } from "../../services/grpc-client.js"

export function AccountModal({ onClose }: { onClose: () => void }): React.ReactElement {
	const { isAuthenticated, userInfo } = useExtensionState()

	const handleLogout = async () => {
		try {
			await getGrpcClient().logout()
		} catch (err) {
			console.error("Logout failed:", err)
		}
		onClose()
	}

	return (
		<div className="modal-backdrop" onClick={onClose}>
			<div className="modal" onClick={(e) => e.stopPropagation()}>
				<div className="modal-header">
					<span className="modal-title">Account</span>
					<button className="modal-close" onClick={onClose}>×</button>
				</div>
				<div className="modal-body">
					{isAuthenticated ? (
						<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
							<div>
								<strong>Name:</strong> {userInfo?.name ?? "—"}
							</div>
							<div>
								<strong>Email:</strong> {userInfo?.email ?? "—"}
							</div>
							<div>
								<strong>Provider:</strong> {userInfo?.provider ?? "—"}
							</div>
						</div>
					) : (
						<p style={{ color: "var(--color-text-muted)" }}>Not authenticated.</p>
					)}
				</div>
				<div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 12, borderTop: "1px solid var(--color-border)" }}>
					<button onClick={onClose} style={{ padding: "6px 16px" }}>Close</button>
					{isAuthenticated && (
						<button
							onClick={handleLogout}
							style={{ padding: "6px 16px", background: "var(--color-error)", color: "#fff", border: "none", borderRadius: 6 }}
						>
							Logout
						</button>
					)}
				</div>
			</div>
		</div>
	)
}
