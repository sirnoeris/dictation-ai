#!/bin/bash
# Run this on your Mac after cloning the project to generate icon.icns
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
iconutil -c icns "$SCRIPT_DIR/icon.iconset" -o "$SCRIPT_DIR/icon.icns"
echo "✓ icon.icns created at $SCRIPT_DIR/icon.icns"
