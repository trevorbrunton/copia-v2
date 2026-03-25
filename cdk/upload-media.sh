#!/bin/bash
set -euo pipefail

ENVIRONMENT="${1:-dev}"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Get bucket name from CloudFormation output
BUCKET=$(aws cloudformation describe-stacks \
  --stack-name "CopiaMedia-${ENVIRONMENT}" \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" \
  --output text 2>/dev/null)

if [ -z "$BUCKET" ] || [ "$BUCKET" = "None" ]; then
  echo "Error: Could not find bucket for CopiaMedia-${ENVIRONMENT}."
  echo "Have you run: ./cdk/deploy.sh ${ENVIRONMENT}"
  exit 1
fi

echo "=== Uploading media to s3://${BUCKET} ==="

# Sync audio files
echo "Syncing audio files..."
aws s3 sync "${PROJECT_ROOT}/public/audio/" "s3://${BUCKET}/audio/" \
  --exclude "*.DS_Store" \
  --cache-control "public, max-age=31536000, immutable" \
  --content-type "audio/mpeg" \
  --exclude "*.pcm"

# Sync PCM files separately (different content type)
echo "Syncing PCM files..."
aws s3 sync "${PROJECT_ROOT}/public/audio/" "s3://${BUCKET}/audio/" \
  --exclude "*" \
  --include "*.pcm" \
  --cache-control "public, max-age=31536000, immutable" \
  --content-type "application/octet-stream"

# Sync video files
echo "Syncing video files..."
aws s3 sync "${PROJECT_ROOT}/public/video/" "s3://${BUCKET}/video/" \
  --exclude "*.DS_Store" \
  --cache-control "public, max-age=31536000, immutable" \
  --content-type "video/mp4"

echo ""
echo "=== Upload complete ==="

# Get CloudFront domain
CDN_URL=$(aws cloudformation describe-stacks \
  --stack-name "CopiaMedia-${ENVIRONMENT}" \
  --query "Stacks[0].Outputs[?OutputKey=='MediaBaseUrl'].OutputValue" \
  --output text 2>/dev/null)

echo ""
echo "Media is available at: ${CDN_URL}"
echo "Set NEXT_PUBLIC_MEDIA_BASE_URL=${CDN_URL} in your environment"
