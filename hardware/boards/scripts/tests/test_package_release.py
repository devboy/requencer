"""Tests for the release packaging script (plain python3, no pcbnew)."""

import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from export.package_release import artifact_manifest, build_zip, check_missing


def make_fake_hardware(root: Path) -> Path:
    """Create a minimal fake hardware/ tree with all required artifacts."""
    hw = root / "hardware"
    build = hw / "boards" / "build"
    (build / "review").mkdir(parents=True)
    (build / "3d").mkdir(parents=True)
    fp = hw / "faceplate" / "elec" / "layout"
    fp.mkdir(parents=True)

    for f in [
        build / "control-poured.kicad_pcb",
        build / "main-poured.kicad_pcb",
        build / "review" / "control.pdf",
        build / "review" / "main.pdf",
        build / "3d" / "control.step",
        fp / "faceplate.kicad_pcb",
    ]:
        f.write_text("fake")

    # manufacturing tree (collected recursively)
    mfg = build / "manufacturing" / "control"
    mfg.mkdir(parents=True)
    (mfg / "control-F_Cu.gbr").write_text("fake gerber")
    return hw


def test_check_missing_reports_required_files(tmp_path):
    hw = tmp_path / "hardware"
    (hw / "boards" / "build").mkdir(parents=True)
    missing = check_missing(artifact_manifest(hw))
    assert any("control-poured.kicad_pcb" in m for m in missing)
    assert any("review/control.pdf" in m or "control.pdf" in m for m in missing)


def test_check_missing_empty_when_complete(tmp_path):
    hw = make_fake_hardware(tmp_path)
    assert check_missing(artifact_manifest(hw)) == []


def test_build_zip_contains_expected_layout(tmp_path):
    hw = make_fake_hardware(tmp_path)
    out = tmp_path / "out"
    zip_path = build_zip(hw, "hw-review-r1", out)

    assert zip_path.name == "requencer-hardware-hw-review-r1.zip"
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
    assert "kicad/control/control-poured.kicad_pcb" in names
    assert "kicad/main/main-poured.kicad_pcb" in names
    assert "kicad/faceplate/faceplate.kicad_pcb" in names
    assert "review/control.pdf" in names
    assert "review/main.pdf" in names
    assert "manufacturing/control/control-F_Cu.gbr" in names
    assert "README.txt" in names
    # release notes written next to the zip
    assert (out / "release-notes.md").exists()


def test_build_zip_fails_loudly_on_missing_required(tmp_path):
    hw = tmp_path / "hardware"
    (hw / "boards" / "build").mkdir(parents=True)
    out = tmp_path / "out"
    try:
        build_zip(hw, "r1", out)
        raise AssertionError("expected SystemExit")
    except SystemExit as e:
        assert e.code != 0
