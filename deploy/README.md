# Deployment Templates

These files are examples for a Linux host running the project from:

```text
/opt/glados-checkin-web
```

Adjust paths, user names, domains, TLS settings, and ports for your server
before installing them.

Typical install locations:

- `*.service`: `/etc/systemd/system/`
- `*.timer`: `/etc/systemd/system/`
- `nginx.example.conf`: `/etc/nginx/sites-available/checkin.example.com`

After installing systemd units:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now glados-checkin-web.service
sudo systemctl enable --now glados-checkin-daily.timer
```

Optional timers:

- `embypulse-checkin-daily.timer`
- `embykeeper-checkin-daily.timer`
- `telegram-bot-checkin-daily.timer`
