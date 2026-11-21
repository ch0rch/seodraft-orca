import { assert, test } from 'orca/testing'
import { matchSeodraftTool, PAID_ESTIMATE_USD, SEODRAFT_TOOLS } from './catalog'

test('reads the seodraft tool out of Claude Code and omp tool names', () => {
  assert.equal(matchSeodraftTool('mcp__seodraft__approve_post', 'seodraft'), 'approve_post')
  assert.equal(matchSeodraftTool('mcp__seodraft_approve_post', 'seodraft'), 'approve_post')
})

test('ignores another server and a server named differently', () => {
  assert.equal(matchSeodraftTool('mcp__other__approve_post', 'seodraft'), null)
  assert.equal(matchSeodraftTool('mcp__seodraft__approve_post', 'sd'), null)
  assert.equal(matchSeodraftTool('mcp__sd__approve_post', 'sd'), 'approve_post')
  assert.equal(matchSeodraftTool('approve_post', 'seodraft'), null)
})

test('prefers the longest tool name that fits', () => {
  assert.equal(
    matchSeodraftTool('mcp__seodraft__add_cluster_topics', 'seodraft'),
    'add_cluster_topics'
  )
  assert.equal(
    matchSeodraftTool('mcp__seodraft_add_cluster_topics', 'seodraft'),
    'add_cluster_topics'
  )
  assert.equal(matchSeodraftTool('mcp__seodraft__add_topics', 'seodraft'), 'add_topics')
})

test('prices only tools the catalog knows', () => {
  const known: readonly string[] = SEODRAFT_TOOLS
  assert.deepEqual(
    Object.keys(PAID_ESTIMATE_USD).filter((tool) => !known.includes(tool)),
    []
  )
})
