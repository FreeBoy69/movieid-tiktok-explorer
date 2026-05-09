#!/usr/bin/env bash
set -euo pipefail
mkdir -p /opt/autoyt
rm -rf /opt/autoyt/app
mkdir -p /opt/autoyt/app
tar -xzf /root/autoyt-app-vps.tar.gz -C /opt/autoyt/app
cp /root/autoyt.env /opt/autoyt/app/.env
chmod 600 /opt/autoyt/app/.env
systemctl enable --now postgresql
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='autoyt_app'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE ROLE autoyt_app LOGIN PASSWORD 'i5ISMXywdVJjpbRkQc46YrO8a2KuNADx';"
else
  sudo -u postgres psql -c "ALTER ROLE autoyt_app WITH LOGIN PASSWORD 'i5ISMXywdVJjpbRkQc46YrO8a2KuNADx';"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='autoyt'" | grep -q 1; then
  sudo -u postgres createdb -O autoyt_app autoyt
fi
sudo -u postgres pg_restore --clean --if-exists --no-owner --no-acl --role=autoyt_app -d autoyt /tmp/autoyt-db.dump
cd /opt/autoyt/app
npm ci
npm run build
python3 -m venv /opt/autoyt/venv
/opt/autoyt/venv/bin/python -m pip install --upgrade pip wheel
/opt/autoyt/venv/bin/pip install -r requirements.txt requests
mkdir -p tmp/compiled-downloads tmp/compilation-jobs/logs tmp/tiktok-videos
node --check server.js
cat >/etc/systemd/system/autoyt.service <<'UNIT'
[Unit]
Description=AutoYT Node app
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=/opt/autoyt/app
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/autoyt/app/server.js
Restart=always
RestartSec=5
User=root
Group=root
StandardOutput=journal
StandardError=journal
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now autoyt
sleep 5
systemctl --no-pager --full status autoyt | sed -n '1,24p'
