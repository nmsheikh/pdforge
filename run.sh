#!/bin/sh
# Start PDFKit. Creates a virtualenv on first run and keeps dependencies up to date.
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
exec .venv/bin/python app.py
