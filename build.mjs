// Bundles the worker and its npm dependencies into one file: an Orca plugin cannot ship
// node_modules, so worker/dist/main.mjs is committed.
import { build } from 'esbuild'
import { statSync } from 'node:fs'

const outfile = 'worker/dist/main.mjs'
const MAX_BYTES = 1024 * 1024

await build({
  entryPoints: ['worker/src/main.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  external: ['orca', 'orca/*'],
  loader: { '.md': 'text' },
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
  }
})

const { size } = statSync(outfile)
if (size > MAX_BYTES) {
  throw new Error(`${outfile} is ${size} bytes, over the ${MAX_BYTES} byte limit`)
}
console.log(`${outfile}: ${size} bytes`)
