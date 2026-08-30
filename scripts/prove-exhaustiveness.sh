#!/usr/bin/env bash
#
# Proves the claim the video makes out loud: adding a failure cause without
# deciding what to do about it is a BUILD ERROR, not a production incident.
#
#   bash scripts/prove-exhaustiveness.sh
#
# Temporarily adds an unhandled variant to the RootCause union, runs tsc, shows
# the errors, and restores the file. Expected result: three failures, in the
# classifier, the policy engine, and the simulator's response model -- the three
# places that must have an opinion about every cause.

set -uo pipefail
cd "$(dirname "$0")/.."

TAXONOMY="src/core/taxonomy.ts"
BACKUP="$(mktemp)"
trap 'cp "$BACKUP" "$TAXONOMY"; rm -f "$BACKUP"' EXIT

cp "$TAXONOMY" "$BACKUP"

node -e '
const fs = require("fs");
const path = "src/core/taxonomy.ts";
const src = fs.readFileSync(path, "utf8");
const anchor = "  | { readonly kind: \"RISK_BLOCKED\" };";
if (!src.includes(anchor)) {
  console.error("anchor not found; RootCause union has changed shape");
  process.exit(2);
}
fs.writeFileSync(
  path,
  src.replace(
    anchor,
    "  | { readonly kind: \"RISK_BLOCKED\" }\n  | { readonly kind: \"NEW_UNHANDLED_CAUSE\" };",
  ),
);
' || exit 2

echo "Added an unhandled RootCause variant. Type-checking..."
echo

# tsc is EXPECTED to exit non-zero here, so capture its output rather than
# piping it -- under `set -o pipefail` a failing tsc would poison the pipeline
# even when grep finds exactly what we want.
OUTPUT="$(npx tsc --noEmit 2>&1)"
MATCHES="$(printf '%s\n' "$OUTPUT" | grep "not assignable to parameter of type 'never'" || true)"

if [ -z "$MATCHES" ]; then
  echo "FAIL: the compiler did not reject the unhandled cause."
  echo "The exhaustiveness guarantee is broken."
  printf '%s\n' "$OUTPUT"
  exit 1
fi

printf '%s\n' "$MATCHES"
echo
echo "PASS: the build refuses an unhandled cause ($(printf '%s\n' "$MATCHES" | wc -l | tr -d ' ') sites)."
echo "Restoring taxonomy.ts."
