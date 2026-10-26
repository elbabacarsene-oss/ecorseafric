#!/usr/bin/env bash
# Sauvegarde complète de la base (format custom, compressé), horodatée à l'heure de Dakar.
# Usage : DATABASE_URL=... ./scripts/sauvegarde.sh [dossier]   (à planifier chaque nuit via cron)
# Restauration : pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" fichier.dump
set -euo pipefail
DOSSIER="${1:-./sauvegardes}"
mkdir -p "$DOSSIER"
FICHIER="$DOSSIER/ecorse_btp_$(TZ=Africa/Dakar date +%Y%m%d_%H%M%S).dump"
pg_dump --format=custom --no-owner "$DATABASE_URL" > "$FICHIER"
# Conserve 30 jours de sauvegardes locales
find "$DOSSIER" -name 'ecorse_btp_*.dump' -mtime +30 -delete
echo "Sauvegarde : $FICHIER"
