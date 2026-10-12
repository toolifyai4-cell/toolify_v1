/**
 * AuthService.getAuthStatus — returns the current auth session info.
 */
import { loadAuthSession, isAuthSessionValid } from "../../../auth/index.js"

export async function getAuthStatus(
	_message: any,
	_signal: AbortSignal,
	): Promise<{ isAuthenticated: boolean; user?: { name: string; email?: string; avatarUrl?: string; provider: string } }> {
	const session = loadAuthSession()
	if (!session || !isAuthSessionValid(session)) {
		return { isAuthenticated: false }
	}
	return {
		isAuthenticated: true,
		user: {
			name: session.user.name,
			email: session.user.email,
			provider: session.user.provider,
			avatarUrl: session.user.avatarUrl,
		},
	}
}
