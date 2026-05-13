# 插件管理功能设计文档

## 1. 概述

### 1.1 问题/背景

当前 Settings 页面有一个独立的"安全"标签页，仅包含 nsp-clawguard 插件的启用/禁用开关。这个设计存在以下局限：

- 硬编码了单个插件（nsp-clawguard），无法扩展
- 用户无法自行安装其他 OpenClaw 社区插件
- 随着 OpenClaw 插件生态的发展，需要一个通用的插件管理入口

OpenClaw 本身已经提供了完善的插件系统，支持 ClawHub、npm、Git、本地路径等多种安装来源，并有标准的插件清单格式（`openclaw.plugin.json`）。LobsterAI 需要在 UI 层面对接这些能力。

### 1.2 目标

- 将 Settings "安全" 标签页改造为通用的 "插件" 标签页
- 支持用户通过 UI 安装、卸载、启用/禁用任意符合 OpenClaw 规范的插件
- nsp-clawguard 退化为可选插件之一，保留向后兼容
- 支持 4 种安装来源：npm（含私有 registry）、ClawHub、Git URL、本地路径

## 2. 用户场景

### 场景 1: 查看已安装插件

**Given** 用户已安装了若干插件（包括预装的 nsp-clawguard）
**When** 用户打开 设置 → 插件
**Then** 看到所有已安装插件的列表，含名称、版本、状态指示灯、启用开关

### 场景 2: 安装 npm 插件（含私有 registry）

**Given** 用户需要安装一个来自私有 npm registry 的插件
**When** 用户点击"安装插件"，选择 npm 来源，输入包名、版本、Registry URL
**Then** 系统下载并安装插件，列表刷新显示新插件，网关重启加载

### 场景 3: 安装 ClawHub 社区插件

**Given** 用户想安装 OpenClaw 社区插件
**When** 用户点击"安装插件"，选择 ClawHub 来源，输入包名
**Then** 系统从 ClawHub 下载安装

### 场景 4: 安装本地插件

**Given** 开发者有本地开发的插件目录或 tgz 文件
**When** 用户选择"本地路径"来源，通过文件选择器选择目录/文件
**Then** 系统安装到运行时目录

### 场景 5: 启用/禁用插件

**Given** 用户已安装某插件且当前已启用
**When** 用户关闭该插件的开关
**Then** 配置同步到 openclaw.json，网关重启后该插件不再加载

### 场景 6: 卸载插件

**Given** 用户已安装某第三方插件
**When** 用户点击卸载
**Then** 插件文件从 third-party-extensions 移除，配置清理，列表刷新

## 3. 功能需求

### FR-1: 插件列表展示

- 显示所有已安装插件（预装 + 用户安装）
- 每个插件显示：ID、版本、描述、来源标记、状态指示灯
- 状态：绿=已启用且加载成功，灰=已禁用，红=加载失败
- 预装插件不可卸载，仅可启用/禁用

### FR-2: 插件安装

支持 4 种来源：

| 来源 | 输入字段 | 底层执行 |
|------|----------|----------|
| npm | 包名 + 版本(可选) + Registry URL(可选) | `npm pack` → `openclaw plugins install <tgz>` |
| ClawHub | 包名 | `openclaw plugins install clawhub:<name>` |
| Git | Git URL (支持 @tag/branch/commit) | `git clone` → pack → install |
| 本地路径 | 文件选择（目录或 .tgz） | `openclaw plugins install <path>` |

安装过程提供进度反馈（loading 状态 + 日志）。

### FR-3: 插件卸载

- 从 third-party-extensions 目录移除插件文件
- 从 user_plugins 记录中删除
- 触发配置同步，网关重启

### FR-4: 插件启用/禁用

- 切换 enabled 状态
- 立即同步到 openclaw.json 的 `plugins.entries`
- 触发网关重启生效

### FR-5: nsp-clawguard 处理

- 不做特殊处理，不需要向后兼容（旧版未发布）
- nsp-clawguard 作为 npm 来源插件安装的测试用例
- 移除 `securityMonitorEnabled` 配置项和相关逻辑

## 4. 实现方案

### 4.1 数据层 — user_plugins 表

在 `coworkStore.ts` 中新增 SQLite 表：

```sql
CREATE TABLE IF NOT EXISTS user_plugins (
  plugin_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,        -- 'npm' | 'clawhub' | 'git' | 'local'
  spec TEXT NOT NULL,          -- 安装时的原始 specifier
  registry TEXT,               -- 可选的 npm registry URL
  version TEXT,                -- 已安装的版本号
  enabled INTEGER DEFAULT 1,   -- 1=启用, 0=禁用
  installed_at INTEGER NOT NULL
);
```

CRUD 方法：
- `listUserPlugins(): UserInstalledPlugin[]`
- `addUserPlugin(plugin: UserInstalledPlugin): void`
- `removeUserPlugin(pluginId: string): void`
- `setUserPluginEnabled(pluginId: string, enabled: boolean): void`

### 4.2 插件管理核心 — pluginManager.ts

新建 `src/main/libs/pluginManager.ts`，封装：

- `installPlugin(params)`: 根据 source 类型调用不同的安装流程
  - npm: `spawnSync('npm.cmd', ['pack', spec, '--registry=...'])` → `runOpenClawCli(['plugins', 'install', tgzPath])`
  - clawhub: `runOpenClawCli(['plugins', 'install', 'clawhub:' + name])`
  - git: clone → pack → install
  - local: `runOpenClawCli(['plugins', 'install', path])`
- `uninstallPlugin(pluginId)`: 删除 extensions 目录 + 清理记录
- `listInstalledPlugins()`: 合并 bundled manifests + user_plugins 记录
- `enablePlugin(pluginId)` / `disablePlugin(pluginId)`

使用 `vendor/openclaw-runtime/current/openclaw.mjs` 作为 CLI 入口（与 ensure-openclaw-plugins.cjs 一致）。

### 4.3 IPC 层

Main process handlers:
- `plugins:list` → 返回所有已安装插件列表
- `plugins:install` → 触发安装流程，返回结果
- `plugins:uninstall` → 触发卸载
- `plugins:set-enabled` → 切换启用状态

Preload 暴露:
```typescript
plugins: {
  list: () => ipcRenderer.invoke('plugins:list'),
  install: (params) => ipcRenderer.invoke('plugins:install', params),
  uninstall: (pluginId) => ipcRenderer.invoke('plugins:uninstall', pluginId),
  setEnabled: (pluginId, enabled) => ipcRenderer.invoke('plugins:set-enabled', pluginId, enabled),
}
```

### 4.4 配置同步整合

在 `openclawConfigSync.ts` 中修改 pluginEntries 生成逻辑：

- 读取 user_plugins 表
- 对于每个 user plugin，根据其 enabled 状态生成 entries
- 保留预装插件（package.json 中声明的 channel 插件）的现有逻辑
- nsp-clawguard 优先从 user_plugins 表获取 enabled 状态

### 4.5 UI 层

**Settings.tsx 变更:**
- TabType: `'security'` → `'plugins'`
- Tab 图标和 label 更新
- 对应 case 渲染 `<PluginsSettings>` 组件

**新建 PluginsSettings.tsx:**
- 插件列表组件（卡片式展示）
- 安装对话框（Modal，来源切换 + 输入表单）
- 操作按钮（安装中 loading / 成功 / 失败状态）
- i18n 支持

## 5. 边界情况

| 场景 | 处理方式 |
|------|---------|
| 插件安装失败（网络/格式错误） | 显示错误信息，不写入 user_plugins |
| 安装同名插件覆盖 | 覆盖安装，更新 user_plugins 记录的 version |
| 预装插件尝试卸载 | UI 上隐藏卸载按钮，仅允许禁用 |
| 私有 registry 不可达 | 超时报错，提示检查网络/地址 |
| 插件缺少 openclaw.plugin.json | OpenClaw CLI 会返回错误，透传给用户 |
| Gateway 重启期间操作 | 队列化，等待上一次操作完成 |
| 打包后的 app 安装插件 | 使用 `resources/cfmind/third-party-extensions/` 目录 |

## 6. 涉及文件

### 新增

| 文件 | 用途 |
|------|------|
| `src/main/libs/pluginManager.ts` | 插件安装/卸载/列表核心逻辑 |
| `src/renderer/components/PluginsSettings.tsx` | 插件管理 UI 组件 |

### 修改

| 文件 | 变更 |
|------|------|
| `src/renderer/components/Settings.tsx` | Tab security → plugins，渲染新组件 |
| `src/renderer/services/i18n.ts` | 插件相关 i18n 字符串 |
| `src/renderer/services/cowork.ts` | 新增插件管理 service 方法 |
| `src/renderer/types/cowork.ts` | 新增插件相关类型 |
| `src/main/main.ts` | 新增 plugins:* IPC handlers |
| `src/main/coworkStore.ts` | user_plugins 表 + CRUD |
| `src/main/preload.ts` | 暴露 plugins API |
| `src/main/libs/openclawConfigSync.ts` | pluginEntries 整合 user_plugins |
| `package.json` | 移除 nsp-clawguard 预装声明（改由用户手动安装） |

## 7. 验收标准

- [ ] 设置 → "插件" 标签页可见，替代原"安全"标签页
- [ ] 预装插件（nsp-clawguard）在列表中显示，开关可用
- [ ] npm 安装：输入包名 + 版本 + 可选 registry → 安装成功 → 列表刷新
- [ ] ClawHub 安装：输入 clawhub 包名 → 安装成功
- [ ] 本地路径安装：选择目录/tgz → 安装成功
- [ ] 启用/禁用：切换后 openclaw.json entries 更新 → 网关重启生效
- [ ] 卸载：文件移除 + 配置清理 + 列表刷新
- [ ] 安装失败时正确报错，不污染数据
