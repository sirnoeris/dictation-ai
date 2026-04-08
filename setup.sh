#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Dictation AI — one-command setup
# Usage: bash setup.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
RESET="\033[0m"

echo ""
echo -e "${BOLD}🎙  Dictation AI — Setup${RESET}"
echo "────────────────────────────────"

# ── 1. Node.js check ──────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo -e "${RED}✗ Node.js not found.${RESET}"
  echo "  Install it from https://nodejs.org (LTS version) then re-run this script."
  exit 1
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo -e "${RED}✗ Node.js 18+ required (you have $(node -v)).${RESET}"
  echo "  Update at https://nodejs.org"
  exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v)${RESET}"

# ── 2. npm install ────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Installing dependencies…${RESET}"
npm install --silent
echo -e "${GREEN}✓ Dependencies installed${RESET}"

# ── 3. Generate macOS icon ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Generating app icon…${RESET}"
if command -v iconutil &>/dev/null; then
  bash assets/make-icns.sh
  echo -e "${GREEN}✓ icon.icns created${RESET}"
else
  echo -e "${YELLOW}⚠  iconutil not found (this only runs on macOS).${RESET}"
  echo "  The app will still work; the .icns is only needed for packaging a .dmg."
fi

# ── 4. Accessibility permission reminder ─────────────────────────────────────
echo ""
echo -e "${BOLD}One permission you'll need to grant:${RESET}"
echo -e "  ${YELLOW}Accessibility${RESET} — lets the app paste text at your cursor."
echo "  System Settings → Privacy & Security → Accessibility → add Electron → toggle ON"
echo ""
echo "  Run this to jump straight there:"
echo -e "  ${BOLD}open \"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility\"${RESET}"

# ── 5. Done ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}✓ Setup complete!${RESET}"
echo ""
echo "  Start the app:  ${BOLD}npm start${RESET}"
echo "  Build a .dmg:   ${BOLD}npm run build${RESET}"
echo ""
echo "  On first launch, Settings opens automatically."
echo "  Add your Groq API key (free at https://console.groq.com)"
echo "  and optionally your xAI key for AI text cleanup."
echo ""
