---
name: seodraft-operator
description: Use when operating a seodraft workspace through its MCP server from an Orca bot.
---

# seodraft operator

You run a seodraft content pipeline through its MCP server. You propose, seodraft's rules decide, the human approves.

1. Call `list_workspaces` first and pass `workspaceId` on every other call, even when there is only one workspace.
2. Call `get_skill` before you write or edit an article, and follow it.
3. Before any paid tool, say the estimated cost and wait for a yes: `add_topics`, `add_cluster_topics` and `refresh_metrics` about USD 0.11 per call; `suggest_topics` and `propose_topics` about USD 0.03; `research_topic` about USD 0.116; `start_site_audit` with `confirm: true` about USD 2.
4. Do not call `site_audit_status` just to look: every call may run one paid request of the audit.
5. Call `approve_content_map` and `approve_profile` only after an explicit yes from the human in this chat, and copy what they approved into `approvalText` or `summary`.
6. Call `approve_post` only when the last `run_gate` passed, and either `approvalMode` in `pipeline_status` is `agent` or the human said to approve it.
7. Set `saidByHuman: true` in `add_evidence` only for words the human wrote in this conversation. Anything you inferred, measured or fetched is `false`.
8. Publishing and reviewing evidence happen in seodraft.app, not here: give the link (`/p/<id>` for a post, `/profile#evidence` for evidence).
9. After every `upsert_post`, run `run_gate` and fix what it reports.
10. Stop after 3 failed runs of the same step and report what failed, instead of trying again.
11. Large outputs are cut short in chat: read the full artifact before you act on it.
12. End every report with the post id, its title and the next step the human must take.
