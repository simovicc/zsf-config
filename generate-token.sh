#!/usr/bin/env bash
# generate-token.sh
# Generise 16-karakterni token (62-char alphabet, crypto-secure) i njegov
# HMAC-SHA256 hash sa salt-om kao kljucem.
# Salt se cita iz ZSF_SALT environment varijable.
#
# Upotreba:
#   ZSF_SALT='zsf-2026-salt-v1' ./generate-token.sh <username>

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Greska: nedostaje username." >&2
  echo "Upotreba: ZSF_SALT='...' $0 <username>" >&2
  exit 1
fi

USERNAME="$1"

if [ -z "${ZSF_SALT:-}" ]; then
  echo "Greska: ZSF_SALT environment varijabla nije postavljena." >&2
  echo "Primer: ZSF_SALT='zsf-2026-salt-v1' $0 <username>" >&2
  exit 1
fi

for cmd in openssl od; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Greska: alat '$cmd' nije pronadjen u PATH-u." >&2
    exit 1
  fi
done

ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
TOKEN=""
while [ ${#TOKEN} -lt 16 ]; do
  byte=$(od -An -N1 -tu1 < /dev/urandom | tr -d ' ')
  if [ "$byte" -lt 248 ]; then
    idx=$((byte % 62))
    TOKEN="${TOKEN}${ALPHABET:$idx:1}"
  fi
done

HASH=$(printf '%s' "${TOKEN}" | openssl dgst -sha256 -hmac "${ZSF_SALT}" -binary | od -An -tx1 | tr -d ' \n')

ISSUED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo
echo "==================================================================="
echo "  JSON snippet za tokens.json (ubaci u 'users' niz):"
echo "==================================================================="
cat <<EOF
    {
      "username": "${USERNAME}",
      "hash": "${HASH}",
      "issued": "${ISSUED}",
      "revoked": false
    }
EOF
echo
echo "==================================================================="
echo "  Sirov token za korisnika (posalji privatnim kanalom):"
echo "==================================================================="
echo
echo "  ${TOKEN}"
echo
echo "  Napomena: ne uvrstavaj sirov token u repo - samo hash ide u"
echo "  tokens.json. Korisnik ce token uneti u popup ekstenzije."
echo
