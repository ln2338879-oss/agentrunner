# AgentRunner Office Deployment

AgentRunner Office is built into the main AgentRunner repository. A server only needs one checkout.

## Local run

```bash
git pull
bun install
bun run office
```

Open:

```text
http://127.0.0.1:3000
```

## Environment

```env
OFFICE_ENABLED=true
OFFICE_HOST=127.0.0.1
OFFICE_PORT=3000
OFFICE_ACCESS_CODE=
```

Leave `OFFICE_ACCESS_CODE` empty for local-only development. Set a long random value before exposing Office through nginx, a tunnel, or a non-local interface.

## Useful endpoints

```text
/office
/api/office/scene
/api/office/assets
/api/office/snapshot
/api/office/bridge
/api/office/events
/office-preview.svg
/agent-sheet.svg
```

`/api/office/events` is a Server-Sent Events stream. Reverse proxies should disable buffering for this path.

## systemd

Copy the example unit:

```bash
sudo cp deploy/systemd/agentrunner-office.service /etc/systemd/system/agentrunner-office.service
sudo systemctl daemon-reload
sudo systemctl enable --now agentrunner-office
```

The unit assumes:

```text
/opt/agentrunner
/usr/local/bin/bun
user: agentrunner
group: agentrunner
```

Adjust those values for the target server.

## nginx

Copy the example config:

```bash
sudo cp deploy/nginx/agentrunner-office.conf /etc/nginx/sites-available/agentrunner-office.conf
sudo ln -s /etc/nginx/sites-available/agentrunner-office.conf /etc/nginx/sites-enabled/agentrunner-office.conf
sudo nginx -t
sudo systemctl reload nginx
```

The example proxies to:

```text
http://127.0.0.1:3000
```

Use certbot or your preferred TLS setup before exposing the domain publicly.

## Discord task links

Office snapshots include `discordUrl` when AgentRunner has a task message row with Discord channel and message ids. The URL uses `DISCORD_GUILD_ID` when set and falls back to `@me`.
