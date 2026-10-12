/**
 * HistoryModal — lists recent task sessions for quick restore.
 */
import React from "react"
import { useExtensionState } from "../../context/ExtensionStateContext.js"

export function HistoryModal({ onClose }: { onClose: () => void }): React.ReactElement {
	const { taskHistory, startNewTask } = useExtensionState()

	const handleRestore = (item: { id: string; preview: string; role: "user" | "assistant" }) => {
		startNewTask(item.preview, "act")
		onClose()
	}

	return (
		<div className="modal-backdrop" onClick={onClose}>
			<div className="modal" onClick={(e) => e.stopPropagation()}>
				<div className="modal-header">
					<span className="modal-title">History</span>
					<button className="modal-close" onClick={onClose}>×</button>
				</div>
				<div className="modal-body">
					{taskHistory.length === 0 ? (
						<p style={{ color: "var(--color-text-muted)" }}>No history yet.</p>
					) : (
						<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
							{taskHistory.map((item) => (
								<div
									key={item.id}
									onClick={() => handleRestore(item)}
									style={{
										padding: "8px 12px",
										background: "var(--color-surface)",
										border: "1px solid var(--color-border)",
										borderRadius: 6,
										cursor: "pointer",
										fontSize: 13,
									}}
								>
									{item.preview || "Untitled task"}
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	)
}
