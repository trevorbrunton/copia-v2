#!/bin/bash
set -euo pipefail

ENVIRONMENT="${1:-dev}"

echo "=== Copia Media CDK Deploy ==="
echo "Environment: $ENVIRONMENT"
echo ""

# Safety gate for production
if [ "$ENVIRONMENT" = "prod" ]; then
  read -p "You are deploying to PRODUCTION. Type 'deploy-prod' to confirm: " confirm
  if [ "$confirm" != "deploy-prod" ]; then
    echo "Aborted."
    exit 1
  fi
fi

cd "$(dirname "$0")"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing CDK dependencies..."
  npm install
fi

# Deploy
echo "Deploying CopiaMedia-${ENVIRONMENT}..."
npx cdk deploy "CopiaMedia-${ENVIRONMENT}" \
  --context environment="$ENVIRONMENT" \
  --require-approval broadening

echo ""
echo "=== Deploy complete ==="
echo ""
echo "Next steps:"
echo "  1. Copy the MediaBaseUrl from the output above"
echo "  2. Set NEXT_PUBLIC_MEDIA_BASE_URL in .env.local and Vercel"
echo "  3. Run: ./cdk/upload-media.sh $ENVIRONMENT"
