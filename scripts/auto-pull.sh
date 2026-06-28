#!/bin/bash
REPO="/home/ramis/Programming/podman"
LOG="/home/ramis/Programming/podman/scripts/auto-pull.log"

cd "$REPO" || exit 1

# Stash any local changes, pull, pop
git fetch origin main 2>>"$LOG"
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE" ]; then
    echo "[$(date)] Pulling: $LOCAL -> $REMOTE" >> "$LOG"
    git pull --ff-only origin main >> "$LOG" 2>&1
else
    echo "[$(date)] Up to date" >> "$LOG"
fi
