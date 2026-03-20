#!/usr/bin/env bash
set -euo pipefail

# Read current version from package.json
current_version=$(node -p "require('./package.json').version")
echo "Current version: $current_version"

IFS='.' read -r major minor patch <<< "$current_version"

echo ""
echo "How would you like to bump the version?"
echo "  1) patch ($major.$minor.$((patch + 1)))"
echo "  2) minor ($major.$((minor + 1)).0)"
echo "  3) major ($((major + 1)).0.0)"
echo ""
read -rp "Choose [1/2/3]: " bump_choice

case "$bump_choice" in
  1) new_version="$major.$minor.$((patch + 1))" ;;
  2) new_version="$major.$((minor + 1)).0" ;;
  3) new_version="$((major + 1)).0.0" ;;
  *)
    echo "Invalid choice."
    exit 1
    ;;
esac

echo "New version: $new_version"

# Update version in package.json
npm version "$new_version" --no-git-tag-version

echo "Updated package.json to version $new_version"

# Build and zip for Chrome
echo ""
echo "Building and zipping for Chrome..."
npm run zip

echo ""
echo "Done! Upload the zip file from .output/ to the Chrome Web Store:"
echo "  https://chrome.google.com/webstore/devconsole"
echo ""
ls -la .output/*.zip 2>/dev/null || echo "  (check .output/ for the zip file)"
