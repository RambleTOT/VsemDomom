#!/usr/bin/env bash
# Резервная копия базы стенда: pg_dump раз в сутки (cron), хранение 7 дней.
#   /opt/app/infra/backup.sh [каталог]    по умолчанию /var/backups/vsemdomom
# В копии есть MAX ID жителей и номера квартир — каталог только для владельца (700).
# Восстановление — docs/DEPLOY.md, раздел «Резервные копии».
set -euo pipefail

cd "$(dirname "$0")/.."
dir="${1:-/var/backups/vsemdomom}"
keep_days="${KEEP_DAYS:-7}"

mkdir -p "$dir"
chmod 700 "$dir"
file="$dir/app-$(date -u +%Y-%m-%dT%H%M%SZ).dump"

docker compose -f compose.yaml -f infra/compose.prod.yaml exec -T db \
  pg_dump -U app -d app --format=custom > "$file.part"
mv "$file.part" "$file"
chmod 600 "$file"

find "$dir" -name 'app-*.dump' -mtime +"$keep_days" -delete
echo "$(date -u +%FT%TZ) копия $file ($(du -h "$file" | cut -f1))"
