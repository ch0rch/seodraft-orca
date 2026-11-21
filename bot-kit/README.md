# seodraft kit for Orca Bots

A plugin cannot create an Orca bot or a bot automation, so these are the steps to do it yourself. Replace `<bot>` with your bot's name and `<site>` with your site.

1. Create the bot in Orca. Suggested purpose:

   > I run the seodraft content pipeline for `<site>`: plan, draft, check against the rules and report what needs a human yes.

2. Give the bot the seodraft MCP server:

   ```sh
   orca bot tools add https://seodraft.app/mcp --name seodraft --bot <bot>
   ```

3. Sign the bot in to seodraft:

   ```sh
   orca bot tools connect seodraft --bot <bot>
   ```

4. Install the operator skill. Press "Install skill" beside the bot in the seodraft panel (Routines tab), or copy it from this repository:

   ```sh
   cp -r bot-kit/skills/seodraft-operator ~/.orca/bots/<bot>/skills/
   ```

5. Schedule the bot. This one writes the next scheduled post every weekday at 10:00; replace `<workspace name>` and `<workspaceId>` with the values `list_workspaces` gives:

   ```sh
   orca automations create --bot <bot> --trigger weekdays --time 10:00 --prompt 'Use the seodraft MCP server named "seodraft" for workspace <workspace name> (workspaceId <workspaceId>); pass workspaceId on every call. 1) Call get_skill and get_profile. 2) Call next_write; if nothing is scheduled, call pipeline_status, report the counts and stop. 3) Write that post as the skill says: save the brief with upsert_post first, then the body, citing only accepted evidence; if fewer than three accepted pieces fit, stop and list the evidence you need from the human. 4) Run run_gate; fix and re-run at most twice. Never call approve_post, approve_content_map, approve_profile, add_evidence with saidByHuman true, or any paid tool (add_topics, suggest_topics, propose_topics, research_topic, refresh_metrics, add_cluster_topics, start_site_audit, site_audit_status). 5) End with the post id, title, gate result and what the human must review.'
   ```

The skill is in [`skills/seodraft-operator/SKILL.md`](skills/seodraft-operator/SKILL.md): twelve rules on workspaces, paid tools, approvals and evidence.
