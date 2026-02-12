---
description: Create a timestamped backup snapshot of the current code
---

This workflow creates a Git tag named `backup-YYYYMMDD-HHMM` to snapshot the current code before starting new features.

1. Ensure all changes are committed
// turbo
2. Run the backup script:
```powershell
$tag = "backup-$(get-date -format 'yyyyMMdd-HHmm')"
git tag $tag
git push origin $tag
echo "Backup created with tag: $tag"
```
