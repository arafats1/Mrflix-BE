#!/usr/bin/env bash
# Run once from your Mac in the Mrflix-BE folder:
#   bash deploy/setup-github.sh <api-domain>
# Gives GitHub Actions access to the VPS, reusing the deploy key that
# Bear-BE's setup created (~/.ssh/bear_vps_deploy).
set -euo pipefail

API_DOMAIN="${1:?usage: setup-github.sh <api-domain>}"
VPS_IP=45.13.235.212
REPO=arafats1/Mrflix-BE
KEY="$HOME/.ssh/bear_vps_deploy"

gh secret set VPS_HOST --repo "$REPO" --body "$VPS_IP"
gh secret set VPS_SSH_KEY --repo "$REPO" < "$KEY"
ssh-keyscan -t ed25519,ecdsa,rsa "$VPS_IP" 2>/dev/null | gh secret set VPS_KNOWN_HOSTS --repo "$REPO"
gh variable set API_DOMAIN --repo "$REPO" --body "$API_DOMAIN"
echo "GitHub is set up for $REPO."
