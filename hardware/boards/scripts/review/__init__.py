"""Schematic review pack generator.

Reads committed *-placed.kicad_pcb files, extracts the atopile subcircuit
hierarchy from the `atopile_address` footprint field, and renders
schematic-style SVGs + a single PDF per board for offline review.

Two-stage pipeline:
  extract.py   — uses KiCad's pcbnew (KICAD_PYTHON only)
  symbols.py   — pure-Python SVG symbol library
  layout.py    — grid + force-directed layout helpers
  render_*.py  — SVG renderers
  gen_review_pack.py — orchestrator, outputs build/review/{board}.pdf
"""
