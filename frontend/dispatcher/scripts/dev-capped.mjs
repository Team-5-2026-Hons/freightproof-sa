// Runs `next dev` with a capped V8 heap.
//
// Why: `next dev` sets its server's heap limit to half of system RAM (8 GB on a 16 GB
// machine) and only restarts itself once the heap passes 80% of that limit. Webpack keeps
// memory from every hot reload, so the server grows to ~6 GB first. With a 3 GB limit
// Next restarts itself at ~2.4 GB instead (a few seconds; the page reconnects).
//
// A script rather than `NODE_OPTIONS=... next dev` in package.json because that inline
// env syntax fails in Windows shells, and this needs no extra dependency (cross-env).
// Next only reads the limit from NODE_OPTIONS, so a `node --max-old-space-size` flag
// on this process would not reach the server it spawns.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const HEAP_LIMIT_MB = 3072
const PORT = '3000'

const require = createRequire(import.meta.url)
const nextBin = require.resolve('next/dist/bin/next')

const nodeOptions = [process.env.NODE_OPTIONS, `--max-old-space-size=${HEAP_LIMIT_MB}`]
  .filter(Boolean)
  .join(' ')

const child = spawn(process.execPath, [nextBin, 'dev', '--port', PORT, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0))
})
