/**
 * AuthService.logout — clears the auth session.
 */
import { clearAuthSession } from "../../../auth/session.js"

export async function logoutUser(
	_message: any,
	_signal: AbortSignal,
): Promise<{ success: boolean }> {
	const cleared = clearAuthSession()
	return { success: cleared }
}
