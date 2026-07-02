"""Test config: make the `review` package importable from the tests dir."""
import sys
from pathlib import Path

# Add `hardware/boards/scripts/` so `from review import ...` works
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
