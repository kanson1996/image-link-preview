#!/bin/bash
# Run lightweight syntax checks. Requires node and python3.
set -euo pipefail

cd "$(dirname "$0")/.."

python3 -m json.tool manifest.json >/dev/null
for file in background.js viewer.js md5.js; do
  node --check "$file"
done
python3 -m py_compile native/transcriber.py
bash -n native/install.sh
bash -n native/uninstall.sh

echo "OK: manifest, JavaScript, Python and shell syntax are valid"
