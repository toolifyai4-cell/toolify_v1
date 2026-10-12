/**
 * TerminalService.runCommand — executes a terminal command and streams
 * output back to the webview via a streaming response.
 */
import { spawn } from "node:child_process"

interface RunCommandRequest {
	command: string
	cwd?: string
}

export async function* runTerminalCommand(
	message: any,
	_signal: AbortSignal,
	_provider?: any,
): AsyncGenerator<{ output?: string; done?: boolean; exitCode?: number }> {
	const req = message as RunCommandRequest
	const cwd = req.cwd ?? process.cwd()

	const child = spawn(req.command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] })

	// Queue of chunks to yield, drained by the async generator loop.
		const queue: Array<{ output?: string; done?: boolean; exitCode?: number }> = []
	let resolve: (() => void) | null = null

		const push = (item: { output?: string; done?: boolean; exitCode?: number }) => {
		queue.push(item)
		if (resolve) {
			resolve()
			resolve = null
		}
	}
	const next = () => new Promise<void>((r) => { resolve = r })

	child.stdout?.on("data", (chunk: Buffer) => push({ output: chunk.toString() }))
	child.stderr?.on("data", (chunk: Buffer) => push({ output: chunk.toString() }))
	child.on("error", (err: Error) => push({ output: err.message + "\n" }))
	child.on("close", (code: number) => push({ done: true, exitCode: code }))

	_signal?.addEventListener("abort", () => {
		child.kill("SIGTERM")
		push({ done: true, exitCode: -1 })
	})

	while (true) {
		if (queue.length > 0) {
			const item = queue.shift()!
			yield item
			if (item.done) break
		} else {
			await next()
		}
	}
}

