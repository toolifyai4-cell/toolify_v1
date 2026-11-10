import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "node:path"

export default defineConfig(({ command }) => ({
	plugins: [react()],
	root: ".",
	base: command === "serve" ? "/" : "./",
	server: {
		port: 5173,
		host: "localhost",
		strictPort: true,
		cors: true,
		origin: "http://localhost:5173",
		hmr: {
			host: "localhost",
			protocol: "ws",
			port: 5173,
		},
	},
	build: {
		outDir: "../dist/webview-ui",
		emptyOutDir: true,
		rollupOptions: {
			output: {
				entryFileNames: "assets/index.js",
				chunkFileNames: "assets/[name].js",
				assetFileNames: "assets/[name][extname]",
			},
		},
	},
	resolve: {
		alias: {
			"@shared": path.resolve(__dirname, "../src/shared"),
			"@core": path.resolve(__dirname, "../src/core"),
		},
	},
}))
