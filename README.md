# GLaDOS Check-in Web

一个轻量的多站点签到管理面板，用于集中管理账号、查看状态并执行单个或批量签到。

当前支持：

- GLaDOS Cookie 签到
- EmbyPulse 账号密码签到
- Incudal Cookie 签到
- Telegram Bot 签到配置和手动触发
- 自动签到脚本和 Telegram 汇报

## 功能

- 登录保护的本地 Web 面板
- 账号新增、编辑、删除、导入、导出
- 账号状态刷新和批量签到
- 签到失败重试
- 可选 Telegram 汇报
- 可选 systemd timer 定时任务

## 环境要求

- Node.js 18 或更高版本
- Linux/macOS/Windows 均可运行 Web 面板
- 可选：Python 3.11+ 和 `embykeeper`，用于 Telegram Bot 签到
- 可选：systemd 和 Nginx，用于服务器部署

## 快速开始

```bash
git clone https://github.com/your-name/glados-checkin-web.git
cd glados-checkin-web
cp .env.example .env
node server.js
```

默认监听：

```text
http://127.0.0.1:22821
```

首次使用前请编辑 `.env`，至少修改：

```env
ADMIN_USER=admin
ADMIN_PASS=change-this-password
SESSION_SECRET=replace-with-a-long-random-string
```

也可以使用 npm 脚本：

```bash
npm start
```

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
INCUDAL_ACCOUNTS_FILE=
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

GLaDOS 和 Incudal：

```bash
node scripts/daily_checkin_report.js
```

EmbyPulse：

```bash
node scripts/embypulse_daily_checkin.js
```

如果配置了 `TELEGRAM_BOT_TOKEN`，脚本会发送签到汇报。没有固定 `TELEGRAM_CHAT_ID` 时，脚本会尝试从 Bot 最近消息中识别并写入 `data/telegram-chat-id.txt`。

## Telegram Bot 签到

Telegram Bot 签到依赖 `embykeeper` 和本地 Python 虚拟环境。一个常见安装方式：

```bash
python3 -m venv .venv-embykeeper
. .venv-embykeeper/bin/activate
pip install embykeeper
```

在面板中填写 Telegram 账号和 Bot 模板后，可先在终端执行首次登录：

```bash
scripts/embykeeper_run_once.sh
```

自定义 Telegram worker：

```bash
scripts/telegram_bot_checkin_once.sh
```

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
