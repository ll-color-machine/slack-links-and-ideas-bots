#!/usr/bin/env bash
set -euo pipefail

# Usage: ./_scripts/push-heroku-env.sh <heroku-app-name> [env-file]
# Defaults to .env.production in repo root.

APP_NAME=${1:-}
ENV_FILE=${2:-.env.production}

if [[ -z "$APP_NAME" ]]; then
  echo "Usage: $0 <heroku-app-name> [env-file]" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 1
fi

echo "Pushing vars from $ENV_FILE to Heroku app: $APP_NAME"
while IFS= read -r line || [[ -n "$line" ]]; do
  # Skip comments and blank lines
  [[ -z "$line" || "$line" =~ ^\s*# ]] && continue
  # Keep lines that have KEY=VALUE
  if [[ "$line" =~ ^[^=]+=.*/? ]]; then
    KEY=${line%%=*}
    VAL=${line#*=}
    # Trim whitespace around KEY
    KEY=$(echo "$KEY" | sed 's/^\s*//;s/\s*$//')
    # Pass as a single assignment to preserve special chars
    echo "  > $KEY"
    heroku config:set --app "$APP_NAME" "$KEY=$VAL"
  fi
done < "$ENV_FILE"

echo "Done. Current config vars:" 
heroku config --app "$APP_NAME"

