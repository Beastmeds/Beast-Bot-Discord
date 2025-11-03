# my-discord-bot

This repository contains a Discord bot built with discord.js v14. It includes many slash-commands and basic persistent guild settings stored in `guild-config.json`.

## Quick local run
1. Copy `.env.example` (or create `.env`) in repo root with the variables below.
2. Install dependencies:

```powershell
npm install
```

3. Start the bot locally:

```powershell
npm start
```

## Required environment variables
Set these in your `.env` (do NOT commit this file):

- DISCORD_TOKEN - your bot token
- CLIENT_ID - your application id
- GUILD_ID - (optional for local guild-scoped command registration)

Example `.env`:

```
DISCORD_TOKEN=xxx
CLIENT_ID=yyy
GUILD_ID=zzz
```

## Prepare repository for hosting
- Make sure `.env` is listed in `.gitignore` (already added).
- Remove any sensitive tokens from commits and history.

## Deploying 24/7 on NodeChef (step-by-step)
1. Create a Git repository and push your project to GitHub (or another Git provider):

```powershell
git init
git add .
git commit -m "Initial"
git remote add origin <your-git-url>
git push -u origin main
```

2. Create an account at https://nodechef.com and log in.
3. In NodeChef dashboard, create a new App -> choose **Node.js**.
4. Connect your Git repository (NodeChef supports GitHub integration) or use NodeChef's deploy options.
5. Configure environment variables in the NodeChef App settings (Environment or Configuration tab):
   - `DISCORD_TOKEN` = your bot token
   - `CLIENT_ID` = your application id
   - `GUILD_ID` = optional (only used for dev/guild-scoped registration; you can remove in production)
6. Ensure the start command is `npm start` (or `node index.js`). NodeChef will use `package.json` scripts.
7. Deploy the app. NodeChef will run your process and keep it up (auto-restarts on crashes).

Notes:
- If your bot connects to the Discord Gateway, NodeChef allows outbound WebSocket connections (required for Discord). If you run into connection issues, check app logs in NodeChef.
- For persistent multi-instance setups, consider switching to a proper DB for config (MongoDB, PostgreSQL) instead of the local `guild-config.json`.

## Useful NodeChef tips
- Set the instance size according to memory/CPU needs. For a small bot, the smallest instance usually suffices.
- Enable automatic deploys from the Git repo to push updates automatically.
- Monitor logs from the NodeChef dashboard to debug startup / env issues.

## Post-deploy checks
- Verify the bot appears online in your server.
- Open server and test commands: `/ping`, `/hallo`, `/würfeln`, `/setup` etc.
- If slash commands are not visible right away, wait a minute or re-register commands (or restart the bot in NodeChef).

## Next enhancements
- Move `guild-config.json` to a database (MongoDB recommended) for multiple-instance safety.
- Add monitoring (Sentry or custom health checks) and auto-restart policies.

If you want, I can:
- Create a GitHub repo and push the code with a commit message (you'll need to provide the remote URL), or
- Walk you through the NodeChef web UI step-by-step with screenshots or exact fields to fill.

Which of these do you want me to do next?
