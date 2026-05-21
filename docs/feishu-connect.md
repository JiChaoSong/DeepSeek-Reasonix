# Feishu (Lark) channel setup

Reasonix can attach Feishu (飞书) to an existing `chat` or `code` session as a remote channel. Feishu is not a third runtime mode.

Once connected, Feishu can:

- send normal user messages into the active session
- receive follow-up assistant replies
- continue confirmation, choice, checkpoint, and plan-style follow-up interactions

## Before you start

Prepare these first:

- a recent Reasonix release that already includes Feishu support
- a Feishu bot `App ID` and `App Secret` from Feishu Open Platform

Feishu Open Platform entry:

- [Feishu Open Platform](https://open.feishu.cn/app)

Important:

- save the `App Secret` when it is shown
- enable the **Bot** capability for your app
- add the **`im:message`** permission scope
- add the **`im.message.receive_v1`** event in Event Subscription (WebSocket mode)
- publish the app (at least "Visible to me only")

## Get your Feishu bot credentials

1. Open [Feishu Open Platform](https://open.feishu.cn/app) and sign in.
2. Create an app or open an existing one.
3. Go to **Credentials & Basic Info**.
4. Copy the `App ID`.
5. Reveal and save the `App Secret`.

## Permission & event setup

### Option A: Import permission template (recommended)

Save the following as `permissions.json` and import it in Feishu Open Platform → **Security → Permission Management → Import**:

```json
{
  "scopes": {
    "tenant": [
      "im:message",
      "im:message.group_at_msg.include_bot:readonly",
      "im:message.group_at_msg:readonly",
      "im:message.p2p_msg:readonly",
      "im:message:send_as_bot"
    ],
    "user": [
      "contact:user.employee_id:readonly",
      "im:message.reactions:read",
      "im:message:readonly"
    ]
  }
}
```

### Option B: Manual setup

1. Go to **Permissions → Permission Management**.
2. Add the `im:message` scope.
3. Go to **Event Subscription → Add Event**.
4. Search for and add `im.message.receive_v1`.
5. Make sure the event subscription mode is **WebSocket** (not Webhook).
6. Go to **Features → Bot** and enable the bot toggle.
7. **Publish** the app (create a version → apply → at least "Visible to me only").

## Connect from the CLI

Start a session first:

~~~bash
reasonix code
# or
reasonix chat
~~~

Then run:

~~~text
/feishu connect <appId> <appSecret>
~~~

Unlike QQ, Feishu does not have an interactive setup flow — credentials must be passed inline or already saved in config.

Other Feishu commands:

- `/feishu status`
- `/feishu disconnect`

After the first successful connection, later `chat` and `code` sessions will auto-start the Feishu channel while it stays enabled.

## Typical usage

1. Start `reasonix code` or `reasonix chat`.
2. Connect Feishu once.
3. Send a message from Feishu to the bot.
4. The bot replies with a 👍 reaction immediately, then sends the model's response as a card message.
5. Continue replies, approvals, and follow-up interactions from Feishu when needed.

Feishu extends the current session. It does not replace `chat` or `code`.

## What happens when a message arrives

1. Feishu bot receives the message via WebSocket long connection.
2. A 👍 reaction is added to the message instantly.
3. The message is forwarded to the Reasonix session.
4. When the model responds, the reply is sent as a **card message** (interactive card with header, markdown body, and footer) using the `im.v1.message.reply` API.

## Troubleshooting

### `/feishu connect` fails

Check these first:

- `App ID` is correct
- `App Secret` is correct
- the bot is enabled in Feishu Open Platform
- the `im:message` permission is added
- the `im.message.receive_v1` event is added
- the app has been published

### 👍 reaction does not appear

The reaction endpoint requires the `im:message` permission scope. Check:

- the permission is added in Feishu Open Platform
- the app has been published with the permission

The reaction failure is non-fatal — the bot will still process the message and reply.

### Message is received, but no reply comes back

Check that the local Reasonix session is still running and the channel is still connected:

~~~text
/feishu status
~~~

### `/feishu` commands do not exist

Your installed npm version is too old. Upgrade to a release that already includes Feishu support, or use the current repository `main` branch.

### Desktop support

Feishu channel support is available in TUI mode (`reasonix chat` / `reasonix code`) but is not yet available in the desktop client (`reasonix desktop`). This will be added in a future release.
