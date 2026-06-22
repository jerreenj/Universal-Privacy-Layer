#!/usr/bin/env python3
"""
DEPRECATED — Standalone test script (kept for reference only).

All tests have been migrated to the pytest suite in test_privacy_features.py.
Use that file instead:

    cd backend
    pip install -r requirements.txt
    pytest tests/ -v

Environment variables required:
    REACT_APP_BACKEND_URL=https://...
    ACCESS_CODE=your_passphrase
"""

raise RuntimeError(
    "This standalone script is deprecated. "
    "Run the pytest suite instead: pytest tests/ -v"
)
