#!/usr/bin/env bash
for f in /opt/autoyt/app/.env /root/autoyt.env; do
  echo "FILE:$f"
  if [ -f "$f" ]; then
    grep -E '^TIKTOK_(MS_TOKEN|COOKIE|BROWSER|SLEEP)' "$f" | sed 's/=.*/=***redacted***/' || echo none
  else
    echo missing
  fi
done
