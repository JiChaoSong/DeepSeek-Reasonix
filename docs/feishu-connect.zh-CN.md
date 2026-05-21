# 飞书连接指南

Reasonix 可以把现有的 `chat` 或 `code` 会话延伸到飞书上，作为远程通道使用。飞书扩展的是当前会话，不是独立的新运行模式。

连接成功后，飞书可以：

- 把普通消息送进当前会话
- 接收后续助手回复
- 继续确认、选择、checkpoint、plan 这类二次交互

## 开始前先准备

请先确认：

- 使用的是已经包含飞书支持的较新 Reasonix 版本
- 已经从飞书开放平台拿到机器人 `App ID` 和 `App Secret`

飞书开放平台入口：

- [飞书开放平台](https://open.feishu.cn/app)

注意：

- `App Secret` 显示时就要保存好
- 需要为应用开启**机器人能力**
- 需要添加 **`im:message`** 权限
- 需要在事件订阅中添加 **`im.message.receive_v1`**（WebSocket 模式）
- 应用需要**发布**（至少"仅我可见"）

## 获取飞书机器人凭据

1. 打开[飞书开放平台](https://open.feishu.cn/app)并登录
2. 创建应用或打开已有的应用
3. 进入**凭证与基础信息**
4. 复制 `App ID`
5. 查看并保存 `App Secret`

## 权限与事件配置

### 方式一：导入权限模板（推荐）

将以下内容保存为 `permissions.json`，在飞书开放平台 → **安全 → 权限管理 → 导入**：

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

### 方式二：手动配置

1. 进入**权限管理 → 权限配置**
2. 添加 `im:message` 权限
3. 进入**事件订阅 → 添加事件**
4. 搜索并添加 `im.message.receive_v1`
5. 确认事件模式选择的是 **WebSocket**（不是 Webhook）
6. 进入**应用功能 → 机器人**，启用机器人开关
7. **发布**应用（创建版本 → 申请发布 → 至少"仅我可见"）

## 在 CLI 里连接

先启动一个会话：

~~~bash
reasonix code
# 或 reasonix chat
~~~

然后运行：

~~~text
/feishu connect <appId> <appSecret>
~~~

和 QQ 不同，飞书没有交互式引导流程——凭据必须一次性传入或已保存在配置中。

其他相关命令：

- `/feishu status`
- `/feishu disconnect`

第一次连接成功后，只要飞书保持启用，后续 `chat` 和 `code` 会话都会自动启动飞书通道。

## 典型使用方式

1. 启动 `reasonix code` 或 `reasonix chat`
2. 完成一次飞书连接
3. 从飞书给机器人发一条消息
4. 机器人会立即回复一个 👍 反应，然后模型回复完成后以卡片消息形式发送回复
5. 需要时直接在飞书里继续回复、确认或选择

飞书只是扩展当前会话，不替代 `chat` 或 `code`。

## 消息处理流程

1. 飞书机器人通过 WebSocket 长连接收到消息
2. 立即在消息上添加 👍 反应
3. 消息转发到 Reasonix 会话
4. 模型回复后，通过 `im.v1.message.reply` API 以**卡片消息**（带标题栏、markdown 正文和脚标）发送回复

## 排障

### `/feishu connect` 失败

优先检查：

- `App ID` 是否正确
- `App Secret` 是否正确
- 飞书开放平台里机器人是否已启用
- `im:message` 权限是否已添加
- `im.message.receive_v1` 事件是否已添加
- 应用是否已经发布

### 👍 反应没有出现

反应接口需要 `im:message` 权限范围。检查：

- 飞书开放平台里是否已添加该权限
- 应用是否已带着该权限发布

反应失败不会影响主流程——机器人仍然会处理消息并回复。

### 能收到消息，但没有回复

先确认本地 Reasonix 会话还在运行，而且飞书通道仍然在线：

~~~text
/feishu status
~~~

### 没有 `/feishu` 命令

说明本地包版本太旧。请升级到已经包含飞书支持的发行版，或者直接使用仓库最新 `main` 分支。

### 桌面端支持

飞书通道在 TUI 模式（`reasonix chat` / `reasonix code`）下可用，桌面客户端（`reasonix desktop`）暂未支持。将在后续版本中添加。
