#!/usr/bin/env bash
# Finds which Supabase pooler hosts a project. Usage: PGPASSWORD=... scripts/find-pooler.sh <project-ref>
set -uo pipefail
REF="$1"
REGIONS="ap-south-1 ap-southeast-1 ap-southeast-2 ap-northeast-1 ap-northeast-2 us-east-1 us-east-2 us-west-1 us-west-2 eu-central-1 eu-central-2 eu-west-1 eu-west-2 eu-west-3 eu-north-1 ca-central-1 sa-east-1"
for prefix in aws-0 aws-1; do
  for region in $REGIONS; do
    host="$prefix-$region.pooler.supabase.com"
    ip="$(python3 -c "import socket,sys;print(socket.gethostbyname(sys.argv[1]))" "$host" 2>/dev/null)" || continue
    out="$(docker run --rm --network host -e PGPASSWORD="$PGPASSWORD" postgres:16-alpine \
      psql "host=$host hostaddr=$ip port=5432 user=postgres.$REF dbname=postgres sslmode=require connect_timeout=8" \
      -tAc "select 'connected'" 2>&1)"
    if echo "$out" | grep -q "tenant/user .* not found"; then continue; fi
    echo "$host ($ip): $out"
    exit 0
  done
done
echo "no pooler found for $REF"
exit 1
