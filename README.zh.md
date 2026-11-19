# dsh-plugin-free-model-advisor

**一条命令告诉你已配置的模型里哪些是免费的，并推荐安全默认值——不改任何配置。**

成本/路由类插件是「事后报告花了多少」；`free-model-advisor` 在切换之前就回答：当前 bundle 行上的 `models` 配置里，哪些确实免费、哪些未知、该用哪个作为默认。它严格只读：读取传给它的 config 对象并打印报告。无网络请求、无文件写入、无配置变更、无模型调用。

## 安装

```powershell
dsh plugin add dsh-plugin-free-model-advisor
```

要求 Node `^22.19.0 || >=24`，DSH `>=0.2.0-rc.2 <0.3.0`。

## 30 秒演示

1. 按上面的命令安装并重启 DSH。
2. 任意会话里输入 `/free-models`。
3. 得到一份精简清单：

```text
[free-models] 2/2 configured models are FREE
  opencode-go/hy4-flash-free  ctx 1,048,576  FREE
  opencode-go/longcat-2.5-free  ctx 1,000,000  FREE
Recommended default: opencode-go/hy4-flash-free
Hint: Set your default model to opencode-go/hy4-flash-free (free). Configure via cordis.patch.yml, or install with `dsh plugin add dsh-plugin-free-model-advisor`.
```

如果某个已配置模型无法确认：

```text
[free-models] 1/3 configured models are FREE
  opencode-go/hy4-flash-free  ctx 1,048,576  FREE
  opencode-go/longcat-2.5-free  ctx 1,000,000  FREE
  deepseek-official/deepseek-v4-pro  UNKNOWN
Recommended default: opencode-go/hy4-flash-free
Hint: Set your default model to opencode-go/hy4-flash-free (free). Configure via cordis.patch.yml, or install with `dsh plugin add dsh-plugin-free-model-advisor`.
```

用 `/free-models --json` 输出机器可读结果，可用于脚本/CI/看板。

## 什么样的模型算 `FREE`

只有在满足以下任一条件时才归类为 `FREE`：

- 显式标记 `free: true`，**或者**
- `id` 以 `-free` 结尾，**且** `provider` 缺失或为 `opencode-go`。

其余一律 `UNKNOWN`。不做任何「猜测」，未知模型不会被推荐。内置目录只含 `opencode-go/hy4-flash-free`（上下文窗口 1,048,576）和 `opencode-go/longcat-2.5-free`（上下文窗口 1,000,000）——绝不打包付费模型。

推荐顺序优先 `hy4-flash-free`，否则取列表中第一个其他免费模型。若没有免费模型，则不给出推荐，并在提示里说明如何添加。

## 配置

bundle patch 默认写入两条允许的免费模型。在你的 profile `cordis.patch.yml` 里改这一行即可：

```yaml
- id: dsh-plugin-free-model-advisor
  name: dsh-plugin-free-model-advisor
  config:
    models:
      - id: hy4-flash-free
        provider: opencode-go
        contextWindow: 1048576
        free: true
      - id: longcat-2.5-free
        provider: opencode-go
        contextWindow: 1000000
        free: true
```

`models` 可以是描述符数组，也可以是以 id（或 `provider/id`）为键的 map：

```yaml
    models:
      opencode-go/hy4-flash-free:
        contextWindow: 1048576
        free: true
```

| 字段 | 类型 | 含义 |
|---|---|---|
| `models` | 数组或 map | 模型描述符。缺失、为空或格式非法时使用默认的免费目录。 |
| `models[].id` | string | 模型 id，必填；缺少的条目会被跳过。 |
| `models[].provider` | string | 可选 provider。只有 `opencode-go`（或缺失）配合 `-free` 结尾才算免费。 |
| `models[].contextWindow` | 非负整数 | 可选，在报告和 JSON 中显示。 |
| `models[].maxTokens` | 非负整数 | 可选，存在时在 JSON 中显示。 |
| `models[].free` | boolean | 只有字面量 `true` 才算显式免费标记。 |

只读取以上已知字段；其他字段一律忽略且不会被序列化。DSH 把 bundle 行的 `config` 作为 `apply(ctx, config)` 的**第二个参数**传入；插件刻意不读取 `ctx.config`。

## JSON 输出

`/free-models --json` 只包含已知字段：

```json
{
  "models": [
    {
      "id": "hy4-flash-free",
      "status": "free",
      "provider": "opencode-go",
      "contextWindow": 1048576
    },
    {
      "id": "longcat-2.5-free",
      "status": "free",
      "provider": "opencode-go",
      "contextWindow": 1000000
    }
  ],
  "freeCount": 2,
  "recommended": "opencode-go/hy4-flash-free",
  "hint": "Set your default model to opencode-go/hy4-flash-free (free). Configure via cordis.patch.yml, or install with `dsh plugin add dsh-plugin-free-model-advisor`."
}
```

## 隐私与安全

- 只读取传给 `apply()` 的 `models` config 对象；不读提示词、工具结果、文件或凭据。
- 无网络请求、无遥测、无文件写入、无配置变更、无模型调用。
- 所有输出字符串在显示前经过脱敏过滤。
- 非法或恶意配置会回退到安全的默认目录；对用户输入的命令永不抛错。
- 命令通过 `ctx.effect()` 绑定 Cordis 生命周期，禁用/重载不会残留重复命令。

## 兼容性

| 组件 | 支持范围 |
|---|---|
| DSH | `>=0.2.0-rc.2 <0.3.0` |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Cordis | `>=4.0.0 <5` |
| 界面 | headless 与 web（只用命令注册表） |

## 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 找不到 `/free-models` | bundle 行未安装 | 重跑 `dsh plugin add dsh-plugin-free-model-advisor`，重启 DSH。 |
| 所有模型都是 `UNKNOWN` | id 不以 `-free` 结尾且未标记 `free: true` | 显式加 `free: true`，或改用 `opencode-go` 的 `*-free` id。 |
| 清单不对 | profile 的 `cordis.patch.yml` 覆盖了 bundle 行 | 后写者胜；改 profile 里的那一行。 |
| 自定义配置不生效 | 配置写在了 `ctx.config` 或其他键上 | 把 `models` 放到 bundle 行的 `config`（`apply` 的第二个参数）。 |
| JSON 看起来是空的 | 配置格式非法 | 已回退到安全默认目录；修正 `models` 配置块。 |

## 开发

```powershell
npm install
npm test
npm pack --dry-run
```

测试完全离线：合成夹具，不调用模型、不联网。`npm test` 用 `tsc` 构建后直接用 `node` 逐个运行测试文件（该沙箱拒绝 `node --test`）。

## 许可证

[MIT](LICENSE)

## 相关插件

- [dsh-plugin-safe-route](https://github.com/SSHOOTING/dsh-plugin-safe-route)
- [dsh-plugin-session-archive](https://github.com/SSHOOTING/dsh-plugin-session-archive)
- [dsh-plugin-token-budget](https://github.com/SSHOOTING/dsh-plugin-token-budget)
- [dsh-plugin-mcp-guard](https://github.com/SSHOOTING/dsh-plugin-mcp-guard)
