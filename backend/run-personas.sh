#!/usr/bin/env bash
# Run all 6 personas through the BCSM 5-stage benchmark and save to Couchbase.
# Usage: bash run-personas.sh [--force]
# --force: re-run even if a canonical run already exists in Couchbase

set -euo pipefail

API="http://localhost:4000"
FORCE=${1:-}
FORCE_FLAG="false"
[[ "$FORCE" == "--force" ]] && FORCE_FLAG="true"

PERSONAS=("chris-voss" "dale-carnegie" "zig-ziglar" "jordan-belfort" "tony-robbins" "grant-cardone")
LABELS=("Chris Voss" "Dale Carnegie" "Zig Ziglar" "Jordan Belfort" "Tony Robbins" "Grant Cardone")

MAX_TURNS=40   # hard ceiling per run
PASS=0
FAIL=0

log() { echo "[$(date '+%H:%M:%S')] $*"; }

run_persona() {
  local id="$1"
  local label="$2"

  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "Starting: $label ($id)"

  local start_body
  start_body=$(python3 -c "import json; print(json.dumps({'agentPresetId':'$id','agentLabel':'$label','force':$FORCE_FLAG}))")
  local start_resp
  start_resp=$(curl -s -X POST "$API/api/benchmark/start" \
    -H "Content-Type: application/json" \
    -d "$start_body")

  local session_id mode
  session_id=$(echo "$start_resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['sessionId'])")
  mode=$(echo "$start_resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['mode'])")
  log "  Session: $session_id  mode=$mode"

  if [[ "$mode" == "replay" ]]; then
    log "  Already cached — skipping (use --force to re-run)"
    return 0
  fi

  local turn=0 status="running" agent_first=""
  while [[ "$status" == "running" && $turn -lt $MAX_TURNS ]]; do
    turn=$((turn + 1))
    local turn_resp
    turn_resp=$(curl -s -X POST "$API/api/benchmark/turn" \
      -H "Content-Type: application/json" \
      -d "{\"sessionId\":\"$session_id\"}")

    local result stage status_new reason
    result=$(echo "$turn_resp" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['result'])")
    stage=$(echo "$turn_resp" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['newStage'])")
    status_new=$(echo "$turn_resp" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['sessionStatus'])")
    reason=$(echo "$turn_resp" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['reason'][:80])")

    if [[ $turn -eq 1 ]]; then
      agent_first=$(echo "$turn_resp" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['agentMove'][:120])")
    fi

    log "  Turn $turn: result=$result  stage=$stage  status=$status_new"
    log "    reason: $reason"
    status="$status_new"
  done

  log "  ── First agent message ──"
  log "  $agent_first"

  log "  Running evaluation + saving to Couchbase..."
  local eval_resp
  eval_resp=$(curl -s -X POST "$API/api/benchmark/evaluate" \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\":\"$session_id\"}")

  local total_score
  total_score=$(echo "$eval_resp" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['totalScore'])")
  local band
  band=$(python3 -c "
s=$total_score
if s>=13: print('Exceptional')
elif s>=10: print('Good')
elif s>=7: print('Adequate')
elif s>=4: print('Poor')
else: print('Critical Failure')
")
  log "  Score: $total_score/15 ($band)"
  log "  Saved to Couchbase ✓"
  PASS=$((PASS + 1))
}

log "═══════════════════════════════════════════"
log "Leverage BCSM Persona Batch Run"
log "Force: $FORCE_FLAG"
log "═══════════════════════════════════════════"

for i in "${!PERSONAS[@]}"; do
  run_persona "${PERSONAS[$i]}" "${LABELS[$i]}" || {
    log "  ERROR running ${PERSONAS[$i]}"
    FAIL=$((FAIL + 1))
  }
  echo ""
done

log "═══════════════════════════════════════════"
log "Done. Passed=$PASS  Failed=$FAIL"
log "═══════════════════════════════════════════"

# Verify canonical runs are in Couchbase
log ""
log "Verifying canonical runs..."
for id in "${PERSONAS[@]}"; do
  start_resp=$(curl -s -X POST "$API/api/benchmark/start" \
    -H "Content-Type: application/json" \
    -d "{\"agentPresetId\":\"$id\",\"agentLabel\":\"test\"}")
  mode=$(echo "$start_resp" | python3 -c "import sys,json;print(json.load(sys.stdin)['mode'])")
  log "  $id → mode=$mode"
done
