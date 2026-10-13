# slack-mcp

An [MCP](https://modelcontextprotocol.io) server that lets Claude read and post in your Slack
workspace. It runs on your own machine over stdio and talks to Slack with a token you give it;
nothing is stored and nothing leaves your machine except the calls to Slack.

## What Claude can do with it

| Tool | What it does | Changes Slack? |
|---|---|---|
| `slack_list_channels` | Channels the bot can see (public, private or both) | no |
| `slack_get_channel_history` | Recent messages of a channel, newest first. Takes an ID or a `#name` | no |
| `slack_get_thread` | A message and every reply under it | no |
| `slack_list_users` / `slack_get_user` | People in the workspace | no |
| `slack_search_messages` | Search across the workspace (needs a user token, see below) | no |
| `slack_post_message` | Post in a channel, or reply in a thread | **yes** |
| `slack_add_reaction` | Add an emoji reaction | **yes** |
| `slack_join_channel` | Make the bot join a public channel | **yes** |

Set `SLACK_MCP_READ_ONLY=true` and the three tools that change things are not offered at all.

## Setup

### 1. Create the Slack app (2 minutes)

1. Go to <https://api.slack.com/apps> → **Create New App** → **From a manifest**, pick your
   workspace, and paste the contents of [`slack-app-manifest.json`](./slack-app-manifest.json).
2. **Install to Workspace**.
3. Under **OAuth & Permissions** copy the **Bot User OAuth Token** (`xoxb-...`).
4. Optional, only for search: copy the **User OAuth Token** (`xoxp-...`) too. Slack does not allow
   a bot token to search.

The bot only sees channels it is a member of. Invite it with `/invite @Claude` in a channel (needed
for private channels), or let Claude use `slack_join_channel` for a public one.

### 2. Build

```bash
cd tools/slack-mcp
npm install
npm run build
```

### 3. Give it to Claude

**Claude Code**

```bash
claude mcp add slack \
  --env SLACK_BOT_TOKEN=xoxb-your-token \
  --env SLACK_USER_TOKEN=xoxp-your-token \
  -- node /absolute/path/to/tools/slack-mcp/dist/index.js
```

Leave out `SLACK_USER_TOKEN` if you do not need search. Add `--env SLACK_MCP_READ_ONLY=true` for a
look-but-don't-touch setup.

**Claude Desktop** (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "slack": {
      "command": "node",
      "args": ["/absolute/path/to/tools/slack-mcp/dist/index.js"],
      "env": {
        "SLACK_BOT_TOKEN": "xoxb-your-token",
        "SLACK_USER_TOKEN": "xoxp-your-token"
      }
    }
  }
}
```

## Settings

| Variable | |
|---|---|
| `SLACK_BOT_TOKEN` | **Required.** `xoxb-...` |
| `SLACK_USER_TOKEN` | Optional. `xoxp-...`, enables `slack_search_messages` |
| `SLACK_MCP_READ_ONLY` | `true` hides the tools that post, react or join |
| `SLACK_API_URL` | Defaults to `https://slack.com/api`; only changed for testing |

## Good to know

- **Posting is visible to everyone in the channel.** Claude Code asks before each tool call by
  default; keep it that way for `slack_post_message`.
- Treat the tokens like passwords. They are passed through the environment and never printed.
- Messages are read as people would: author names instead of IDs, `<@U123>` mentions as `@name`,
  times in ISO format.
- Errors say what to do: not a member of the channel, missing scope, rate limited (with how long
  to wait), and so on.

## Tests

```bash
npm test
```

Runs the real server over stdio against a stand-in Slack and checks the tool list, every tool,
the error messages, search with a user token, and read-only mode.
