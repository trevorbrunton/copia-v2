#!/bin/bash
set -euo pipefail

STAGE=${1:-dev}
echo "Deploying Mayfly stack (stage: $STAGE)..."

cd "$(dirname "$0")"

# Install deps if needed
if [ ! -d "node_modules" ]; then
  echo "Installing CDK dependencies..."
  bun install
fi

# Synth and deploy
npx cdk deploy "Mayfly-${STAGE}" \
  -c env="$STAGE" \
  --require-approval never \
  --outputs-file "../cdk-outputs.json"

echo "Deploy complete. Outputs saved to cdk-outputs.json"
