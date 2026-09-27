# Emby Check-in Tools

多站点与 Telegram Bot 自动签到。本仓库不提供网页面板，签到靠脚本和定时任务，状态通过 API 读取。

当前支持：

- GLaDOS Cookie 签到
- EmbyPulse 账号密码签到
- EmbyMB 账号密码签到
- 周三晚账号密码签到
- 癫影（dian115）账号密码签到
- Telegram Bot 签到
- 自动签到脚本和 Telegram 汇报

## 功能

- 站点与 Telegram Bot 自动签到
- 签到失败重试
- 可选 Telegram 汇报
- 可选 systemd timer 定时任务
- 只读 Summary API，供客户端拉取结果

## 环境要求

- Node.js 18 或更高版本
- 可选：Python 3.11+ 和 `embykeeper`，用于 Telegram Bot 签到
- 可选：systemd 和 Nginx，用于服务器部署

## 快速开始

```bash
git clone https://github.com/zhangx16/emby-checkin.git
cd emby-checkin
cp .env.example .env
```

首次使用前请编辑 `.env`。需要 Summary API 时再启动：

```bash
node server.js
```

默认监听：

```text
http://127.0.0.1:22821
```

## Mobile / App API（只读摘要）

供 iOS PersonalToolbox 等客户端拉取签到总览，**不返回 Cookie / 密码**。

1. 在 `.env` 设置长随机 Token：

```env
APP_API_TOKEN=your-long-random-token
```

2. 请求摘要：

```bash
curl -sS -H "Authorization: Bearer $APP_API_TOKEN" \
  https://checkin.example.com/api/v1/summary | jq .
```

也支持 `X-API-Key: <token>`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/summary` | 聚合网站账号 + Telegram Bot 签到结果 |
| GET | `/api/v1/health` | Token/会话探测 |

`summary` 主要字段：

- `counts`：`total` / `success` / `already` / `failed` / `skipped` / `healthy`
- `providers[]`：按签到源汇总
- `items[]`：扁平列表（`status`、`message`、`checkedAt`、积分/连续/剩余天数等）

`status` 枚举：`success` | `already` | `failed` | `skipped` | `pending` | `unknown`。

## 配置

`.env.example` 包含所有常用配置项。

常用变量：

```env
HOST=127.0.0.1
PORT=22821
REQUEST_TIMEOUT_MS=20000
ADMIN_USER=admin
ADMIN_PASS=change-this-password
SESSION_SECRET=replace-with-a-long-random-string
DEFAULT_EMBYPULSE_BASE_URL=https://embypulse.example.com
DEFAULT_EMBYMB_BASE_URL=https://embymb.ichinosekotomi.com
DEFAULT_ZHOUSANWAN_BASE_URL=https://zhousanwan.xyz
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_DRY_RUN=false
CHECKIN_MAX_ATTEMPTS=3
CHECKIN_RETRY_DELAY_MS=5000
TELEGRAM_ALERT_ON_FAILURE=true
```

账号数据默认保存在 `data/` 下。也可以用这些变量覆盖路径：

```env
GLADOS_ACCOUNTS_FILE=
EMBYPULSE_ACCOUNTS_FILE=
EMBYMB_ACCOUNTS_FILE=
ZHOUSANWAN_ACCOUNTS_FILE=
CHECKIN_PROJECT_ROOT=
```

## 数据安全

`data/` 和 `.env` 会包含 Cookie、站点密码、Telegram Bot Token、Telegram session 和 chat id。项目已通过 `.gitignore` 排除这些运行数据。

发布到 GitHub 前，请确认不要提交：

- `.env`
- `data/*.json`
- `data/telegram-chat-id.txt`
- `data/embykeeper/config.toml`
- `data/embykeeper/form.json`
- `data/embykeeper/runtime/*`
- `.venv-*`

## 自动签到

GLaDOS：

```bash
node scripts/daily_checkin_report.js
```

EmbyPulse：

```bash
node scripts/embypulse_daily_checkin.js
```

EmbyMB：

```bash
node scripts/embymb_daily_checkin.js
```

周三晚：

```bash
node scripts/zhousanwan_daily_checkin.js
```

如果配置了 `TELEGRAM_BOT_TOKEN`，脚本会发送签到汇报。没有固定 `TELEGRAM_CHAT_ID` 时，脚本会尝试从 Bot 最近消息中识别并写入 `data/telegram-chat-id.txt`。

## Telegram Bot 签到

Telegram Bot 签到依赖 `embykeeper` 和本地 Python 虚拟环境。一个常见安装方式：

```bash
python3 -m venv .venv-embykeeper
. .venv-embykeeper/bin/activate
pip install embykeeper
```

在 `data/embykeeper/form.json` 中填写 Telegram 账号和 Bot 模板后，可先在终端执行首次登录：

```bash
scripts/embykeeper_run_once.sh
```

自定义 Telegram worker：

```bash
scripts/telegram_bot_checkin_once.sh
```

Foam（`@lilisiebot`）使用 `/start` 打开菜单，由 worker 点击「✅ 每日签到」。
Bot 模板的成功关键词设为 `签到成功`，已签到关键词包含 `今天已签到`；
不要用「积分」判断成功，以免将积分菜单误判为签到结果。通过 `targetPhones` 指定已满足 Bot 群组要求的账号。
worker 为 Foam 预留 20 秒等待独立的签到结果消息。

稳健 Emby（`@wenjian_emby_bot`）使用 `/start` 打开菜单，由 worker 点击「🎯 签到」。
HSUYS（`@hsuys_bot`）也已加入 Bot 模板：worker 发送 `/start`，查找签到按钮并等待签到结果。
这两个 Bot 的模板仅以明确的签到成功或已签到回复判定完成。
用户面板如果带有签到按钮，即使显示「未注册 / 未绑定」，worker 仍会点击签到；没有账号的 Telegram 号也可以参与签到。
只有明确拒绝（无权、需先加群等）才会跳过并写入 skip cache。
稳健杂货铺（`@libhsulife`）是群组，模板设置 `isChat: true`、`commands: ["就位"]`，
通过 `targetPhones` 选择参与签到的账号。群签到仅接受 Bot 对本次命令的直接回复，
避免把其他成员的签到结果误记为本账号成功。上述三个目标的回复等待时间均为 20 秒。

ZZMEB（`@zzmeb_bot`）同时走两种签到：`/start` 后点击「🎯 签到」，以及打开 MiniApp 面板（`t.me/zzmeb_bot/miniapp`）调用用户中心签到接口。两种方式各自计奖，worker 会把两边结果写进同一条记录。

Nayovo（`@OicOvo_bot`）使用 `/start` 打开菜单，由 worker 点击「🎯 签到」，交互与非越相同。
月饼（`@Moonkkbot`）使用 `/start` 打开用户面板，签到按钮会打开 EmbyGuard 小程序；
worker 读取 WebApp 链接，用 Telegram WebView 的 `init_data` 调用小程序签到接口。
该 Bot 要求账号已加入受管群；当前通过 `targetPhones` 指定可用账号。

Mirai（`@miraiembytest_bot`）直接发送 `/checkin`，以「签到成功」或「今日已签到」判定结果。
未加入配置群组的账号会被跳过。
ShrekPublic（`@shrekpublic_bot`）使用 `/start` 打开菜单，由 worker 点击「🎯 签到」。
茶包（`@tbagemby_bot`）同样使用 `/start` 后点击「🎯 签到」。未加入群组或频道的账号会被跳过。
Gary's Club（`@garysclubsubbot`）直接发送 `/checkin` 每日打卡领积分。
成功回复含「签到打卡成功」，已签到回复含「您今天已经签到过了」。
`/start` 会要求加入 `@garysclub` 和 `@roctech` 才能看订阅卡，worker 会忽略加群验证卡片，用 `/checkin` 完成打卡。
ChaPanda（`@ChaPanda3_bot`）使用 `/start` 打开菜单，由 worker 点击「🎯 签到」。
成功回复含「签到成功」或 callback「✔️ Done!」，已签到回复含「您今天已经签到过了」。未加入频道/群组的账号会被跳过。

## 服务器部署

`deploy/` 下提供 systemd 和 Nginx 示例模板，默认假设项目部署到：

```text
/opt/glados-checkin-web
```

根据你的服务器路径、运行用户、域名和 TLS 配置修改后再安装。

示例：

```bash
sudo cp deploy/glados-checkin-web.service /etc/systemd/system/
sudo cp deploy/glados-checkin-daily.service /etc/systemd/system/
sudo cp deploy/glados-checkin-daily.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now glados-checkin-web.service
sudo systemctl enable --now glados-checkin-daily.timer
```

Nginx 示例见 `deploy/nginx.example.conf`。

## 开发检查

```bash
npm run check
```

这个命令会对 Node.js 入口和自动签到脚本做语法检查。

## 免责声明

本项目只提供自托管账号管理和签到自动化工具。请遵守相关站点的服务条款，并自行保护账号 Cookie、密码和 Telegram 凭据。
