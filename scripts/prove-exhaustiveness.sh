#!/usr/bin/env bash

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
