# 定时任务多 Bot 群聊选择去重修复设计文档

## 1. 概述

### 1.1 问题

在同一个飞书群聊中接入多个 Bot，并且这些 Bot 绑定到不同 Agent 后，
定时任务表单选择其中一个 Bot 时，群聊目标下拉会出现多条相同的
`群聊 · oc_...` 选项。用户无法判断每条选项对应哪个 Agent，创建任务时也
可能因为同一个 `conversationId` 被多条 mapping 复用而绑定到错误 Agent。

### 1.2 根因

PR #2298 后，`im_session_mappings` 支持同一个
`(platform, im_conversation_id)` 下存在多个不同 `agent_id` 的 mapping，用来
保留同群不同 Agent 的会话归属。这是正确的。

定时任务选择 Bot 实例时，主进程会调用
`listSessionMappings(platform, accountId)`。私聊会话的
`im_conversation_id` 带有账号前缀，例如：

```text
61823a93:direct:ou_30660c6d4aaeade046cc31c9a95d747f
```

因此可以按账号前缀过滤。但群聊会话的 `im_conversation_id` 通常是：

```text
group:oc_622a147f6d49851fb81e138022fcb485
```

不带账号前缀。当前 `listSessionMappings(platform, accountId)` 只能临时把
所有 `group:%` mapping 都带上，再交给定时任务列表去重。PR #2298 又要求
去重不能合并不同 Agent 的同群 mapping，于是同一个群会在下拉中出现多条。

## 2. OpenClaw session key 规范

这次修复不能通过给群聊 session key 增加 accountId 来解决。

OpenClaw 文档和插件测试都把群聊写成：

```text
agent:<agentId>:feishu:group:<chatId>
```

不带 `accountId`。OpenClaw 当前实现中，`accountId` 只在 direct message 且
`session.dmScope = "per-account-channel-peer"` 时参与 session key：

```text
agent:<agentId>:<channel>:<accountId>:direct:<peerId>
```

对于 group/channel，规范形态是：

```text
agent:<agentId>:<channel>:group:<peerId>
agent:<agentId>:<channel>:channel:<peerId>
```

因此 LobsterAI 不应在 `im_conversation_id` 或 OpenClaw canonical session key
层面发明群聊 account 前缀。群聊的 Bot 归属只能在 LobsterAI 侧通过 mapping
元数据或当前实例绑定关系辅助判断。

## 3. 修复方案

短期修复在定时任务会话列表层完成：

1. 仍然先按选中的 Bot 实例调用 `listSessionMappings(platform, accountId)`。
2. 对返回结果中的私聊 mapping 保持原逻辑。
3. 对 `group:%` 这类不带账号前缀的群聊 mapping，读取当前
   `settings.platformAgentBindings`，解析“选中 Bot 实例当前绑定的 Agent”。
4. 只保留 `mapping.agentId` 等于该绑定 Agent 的群聊 mapping。
5. 再执行现有 `dedupeConversationMappings()`，继续保留 PR #2298 对不同 Agent
   mapping 的保护语义。

当无法解析选中账号或绑定关系时，保留旧行为，避免误删历史会话选项。

主进程会在 `ListChannelConversations` IPC 中记录一条诊断日志，包含 channel、
platform、选中账号摘要、raw/filtered/deduped 计数、binding 总数、群聊摘要、被过滤的群聊摘要和
当前账号相关的绑定摘要。该日志用于区分“本地没有群聊 mapping”和“过滤逻辑删掉了
群聊 mapping”。

## 4. 边界情况

| 场景 | 处理方式 |
|------|----------|
| Bot 实例绑定自定义 Agent | 群聊列表只展示该 Agent 对应的 group mapping |
| Bot 实例未显式绑定 Agent | 按 OpenClaw/LobsterAI 默认逻辑视为 `main` Agent |
| 私聊 mapping 带账号前缀 | 继续由 `listSessionMappings(platform, accountId)` 过滤 |
| 群聊 OpenClaw session key 不带 accountId | 不修改 key 规范，只用当前实例绑定关系过滤 UI 候选 |
| 未来需要彻底表达群聊 Bot 归属 | 可在 LobsterAI mapping metadata 层增加 account 字段，不改变 OpenClaw canonical key |

## 5. 验收标准

1. 同一个飞书群存在 main Agent 和自定义 Agent 两条 mapping 时，选择 Bot 1
   只看到 Bot 1 当前绑定 Agent 的群聊选项。
2. 私聊选项仍按 Bot 实例账号前缀正常过滤。
3. `dedupeConversationMappings()` 仍不会把不同 Agent 的同群 mapping 全局折叠。
4. 文档明确记录 OpenClaw 群聊 session key 不带 accountId，避免后续重复调研。
5. 当群聊列表不符合预期时，主进程日志能看到 raw、filtered 和 deduped 三段计数。
