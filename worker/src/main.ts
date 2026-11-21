// The worker's entry. `node build.mjs` bundles it with its npm dependencies into
// worker/dist/main.mjs, which is the `main` Orca runs.
import { connectSeodraft } from './seodraft'
import { createWorker } from './worker'

const worker = createWorker(connectSeodraft)

export default worker.activate
export const deactivate = worker.deactivate
