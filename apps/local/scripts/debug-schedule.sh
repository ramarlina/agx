#!/bin/bash
# Debug a schedule tick step-by-step
#
# Usage:
#   ./scripts/debug-schedule.sh <rootMessageId>          # dry run
#   ./scripts/debug-schedule.sh <rootMessageId> --run     # live execution
#
# Shows: workflow overview → tick check → each node (input → processing → output) → completion

ROOT_ID="${1:?Usage: debug-schedule.sh <rootMessageId> [--run]}"
RUN_FLAG=""
[ "$2" = "--run" ] && RUN_FLAG="&run=1"

BASE="http://localhost:41741"
RAW=$(curl -sf "${BASE}/api/schedules/debug?rootMessageId=${ROOT_ID}${RUN_FLAG}")

if [ $? -ne 0 ]; then
  echo "Error: could not reach ${BASE} or graph not found"
  exit 1
fi

echo "$RAW" | python3 -c "
import json, sys

data = json.load(sys.stdin)
W = data.get('workflow', {})
TC = data.get('tickCheck', {})
nodes = data.get('nodes', [])
C = data.get('completion', {})

# ── Workflow
print('━' * 60)
print('  WORKFLOW:', W.get('id', '?'))
print('━' * 60)
sched = W.get('schedule', {})
print(f\"  state={sched.get('state')}  interval={sched.get('intervalMs')}ms  runs={sched.get('runCount')}  tickInProgress={sched.get('tickInProgress')}\")
if sched.get('lastTickAt'):
    print(f\"  lastTick={sched['lastTickAt']}\")
print()
print('  Pipeline:')
for line in W.get('pipeline', []):
    print(f'    {line}')
print()
print('  Nodes:')
for nid, info in W.get('nodes', {}).items():
    parts = [f\"type={info['type']}\", f\"status={info['status']}\"]
    if 'command' in info:
        cmd = info['command']
        if len(cmd) > 60: cmd = cmd[:57] + '...'
        parts.append(f\"cmd=\\\"{cmd}\\\"\")
    if 'expression' in info:
        parts.append(f\"expr=\\\"{info['expression']}\\\"\")
    if 'inputFrom' in info:
        parts.append(f\"from={info['inputFrom']}\")
    print(f\"    [{nid}] {', '.join(parts)}\")

# ── Tick check
print()
print('━' * 60)
print('  TICK CHECK')
print('━' * 60)
if TC.get('tickFired'):
    print('  ✓ Tick fired — nodes reset to pending')
else:
    print(f\"  ✗ Tick skipped: {TC.get('skipReason', '?')}\")
    sys.exit(0)

# ── Nodes step-by-step
for i, node in enumerate(nodes):
    print()
    print('━' * 60)
    ntype = node.get('type', '?').upper()
    print(f\"  NODE {i+1}: [{node.get('node')}] ({ntype})\")
    print('━' * 60)

    inp = node.get('input', {})
    print('  Input:')
    if isinstance(inp, dict):
        for k, v in inp.items():
            val = json.dumps(v) if isinstance(v, (dict, list)) else str(v)
            if len(val) > 80: val = val[:77] + '...'
            print(f'    {k}: {val}')
    else:
        print(f'    {inp}')

    print(f\"  Processing: {node.get('processing', '?')}\")

    out = node.get('output', {})
    print('  Output:')
    if isinstance(out, dict):
        for k, v in out.items():
            val = json.dumps(v) if isinstance(v, (dict, list)) else str(v)
            if len(val) > 100: val = val[:97] + '...'
            print(f'    {k}: {val}')
    else:
        print(f'    {out}')

# ── Completion
print()
print('━' * 60)
print('  COMPLETION')
print('━' * 60)
icon = '✓' if C.get('complete') else '✗'
print(f\"  {icon} Tick complete: {C.get('complete')}\")
for rn in C.get('resetNodes', []):
    print(f\"    [{rn['id']}] → {rn['status']}\")
print()
"
