# seodraft for Orca

Run your [seodraft](https://seodraft.app) content pipeline from [Orca](https://onorca.dev): see what is waiting for you, approve it, and put agents to work on a schedule. The plugin talks to seodraft's MCP server with your own account; it needs a seodraft workspace.

## Quick path

1. Install it:

   ```sh
   orca plugin install ch0rch/seodraft-orca
   ```

   Orca lists what the plugin may do and asks you to approve it.

2. Open the **seodraft** panel in the right sidebar and press **Connect seodraft**. Your browser opens seodraft's sign-in; when it says "seodraft connected", go back to Orca.
3. Pick your workspace at the top of the panel. The status bar now shows `seodraft · 2 to review` or `seodraft · up to date`.

## What is in the panel

| Tab | What you do there |
|---|---|
| Pipeline | Counts per stage and every article. Select one to run the rules, approve it (only in review, after a checkbox) or ask an agent to fix it. |
| Map | The clusters of your content map. A proposed map shows what your approval records, and an **Approve map** button behind a checkbox. |
| Evidence | The evidence bank, filtered by status. Add a piece in your own words. |
| Profile | Edit the business profile agents write from, and approve it when it has no approval on record. |
| Routines | Create scheduled agent runs (Orca automations), run one now, and set up an Orca bot. |
| Activity | The seodraft tool calls Orca reports from your agents' terminals, with what each probably cost. See [Guards](#guards) for which agents that covers. |

Two things stay in seodraft.app, and the panel links to them: **publishing** an article, and **accepting or rejecting evidence** an agent proposed.

## Routines

A routine is an Orca automation the plugin creates for you: an agent, a prompt and a schedule. It keeps running when the panel is closed.

| Routine | Default schedule | What the agent does |
|---|---|---|
| Write the next post | Weekdays 10:00 | Writes the next scheduled article and checks it against the rules. Never approves, never spends. |
| Weekly pipeline review | Mondays 9:00 | Read-only report: what waits for you, what failed, free calendar days, pending evidence. |
| Evidence the next posts need | Thursdays 9:00 | Read-only: the first-hand evidence the next three articles still lack, as questions to you. |

The agent that runs a routine needs the seodraft MCP server connected, under the name in the "MCP server name" setting. For Claude Code:

```sh
claude mcp add --transport http seodraft https://seodraft.app/mcp
```

For any other agent, add `https://seodraft.app/mcp` as an HTTP MCP server the way that agent does it. The Routines tab shows the right hint for the agent you pick.

You can edit a routine's schedule and prompt, pause it or delete it from the panel.

## Guards

Both are off until you turn them on in Settings → Plugins → seodraft.

| Setting | Effect |
|---|---|
| Paid call ceiling (USD) | Refuses an agent's seodraft call whose estimated cost is above the ceiling. `0` is off. |
| Approve maps and profiles from the panel only | Refuses an agent's `approve_content_map`, `approve_profile` and `add_cluster_topics`. |

Guards and Activity only see the tool calls Orca reports to plugins, so they depend on the agent:

| Agent | Listed in Activity | Guards refuse the call |
|---|---|---|
| Claude Code | Yes | Yes: it is the one agent that waits for Orca before running a tool |
| omp | No: Orca 1.4.269 does not report its tool calls to plugins | No |
| Other agents | Only if Orca reports their calls | No |

Estimates are fixed per tool, not what DataForSEO charged.

## Other settings

| Setting | Default | Change it when |
|---|---|---|
| seodraft MCP URL | `https://seodraft.app/mcp` | You run your own seodraft. Changing it signs you out. |
| OAuth callback port | `47321` | Connect says the port is busy. |
| Refresh interval (minutes) | `10` | You want the status bar fresher, or quieter. |
| Default agent | `claude` | Your routines run with another agent. |
| MCP server name | `seodraft` | Your agents know the seodraft server by another name. Guards and Activity match on it. |
| Notify when posts are ready for review | on | You do not want the desktop notification. |

## Orca Bots

A plugin cannot create a bot or schedule one. [`bot-kit/`](bot-kit/README.md) has the steps and a skill that teaches a bot to operate seodraft: when to ask before spending, what only you can approve, where publishing happens. The Routines tab lists your bots and installs the skill.

## What the plugin can reach

- **seodraft:** only your account, through the MCP server, with the tokens from your sign-in. Tokens live in your system keyring; without a keyring they stay in memory and you sign in again after Orca restarts.
- **The panel calls 14 seodraft tools** and no paid one. The list is `PANEL_ALLOWED_TOOLS` in [`src/shared/catalog.ts`](src/shared/catalog.ts).
- **Your machine:** a callback server on `127.0.0.1` while you sign in, and `~/.orca/bots/` to list bots and write the skill when you press **Install skill**.

## Develop

```sh
pnpm install
pnpm build        # bundles worker/src into worker/dist/main.mjs, which is committed
pnpm typecheck
orca plugin test . --json
orca plugin check . --json
orca plugin dev load . --json
```

The worker is the only bundled part: Orca loads the panel's `.tsx` files as written. Rebuild and commit `worker/dist/main.mjs` whenever `worker/src` or `src/shared` changes.

MIT. Not affiliated with Orca.
