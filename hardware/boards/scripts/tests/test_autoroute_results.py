"""Tests for autoroute result JSON output (parallel safety).

Tests the functions that extract metrics from DRC reports and write
structured result.json files, replacing sys.exit(1) calls.
"""

import json
import os
import tempfile

import pytest

from routing.autoroute import (
    write_result_json,
    parse_drc_metrics,
    build_result,
)


class TestWriteResultJson:
    def test_writes_pass_result(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "control-variant-a-result.json")
            result = {
                "status": "pass",
                "via_count": 42,
                "trace_length_mm": 1234.5,
                "drc_warnings": 3,
                "unconnected_count": 0,
            }
            write_result_json(path, result)

            with open(path) as f:
                data = json.load(f)
            assert data["status"] == "pass"
            assert data["via_count"] == 42
            assert data["trace_length_mm"] == 1234.5
            assert data["drc_warnings"] == 3
            assert data["unconnected_count"] == 0

    def test_writes_fail_result(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "result.json")
            result = {
                "status": "fail",
                "reason": "SES file too small",
            }
            write_result_json(path, result)

            with open(path) as f:
                data = json.load(f)
            assert data["status"] == "fail"
            assert "SES file too small" in data["reason"]


class TestParseDrcMetrics:
    def test_extracts_warnings_and_unconnected(self):
        report = {
            "violations": [
                {"severity": "error", "description": "Clearance"},
                {"severity": "warning", "description": "Silk overlap"},
                {"severity": "warning", "description": "Courtyard"},
            ],
            "unconnected_items": [
                {"items": [{"description": "pad [net1]"}]},
                {"items": [{"description": "pad [net2]"}]},
            ],
        }
        metrics = parse_drc_metrics(report)
        assert metrics["drc_errors"] == 1
        assert metrics["drc_warnings"] == 2
        assert metrics["unconnected_count"] == 2

    def test_empty_report(self):
        report = {"violations": [], "unconnected_items": []}
        metrics = parse_drc_metrics(report)
        assert metrics["drc_errors"] == 0
        assert metrics["drc_warnings"] == 0
        assert metrics["unconnected_count"] == 0

    def test_missing_keys(self):
        report = {}
        metrics = parse_drc_metrics(report)
        assert metrics["drc_errors"] == 0
        assert metrics["drc_warnings"] == 0
        assert metrics["unconnected_count"] == 0


class TestBuildResult:
    def test_pass_result(self):
        drc_metrics = {
            "drc_errors": 0,
            "drc_warnings": 1,
            "unconnected_count": 0,
        }
        result = build_result(
            status="pass",
            via_count=50,
            trace_length_mm=800.0,
            drc_metrics=drc_metrics,
        )
        assert result["status"] == "pass"
        assert result["via_count"] == 50
        assert result["trace_length_mm"] == 800.0
        assert result["drc_warnings"] == 1
        assert result["unconnected_count"] == 0
        assert "reason" not in result

    def test_fail_result(self):
        result = build_result(
            status="fail",
            reason="FreeRouting crashed",
        )
        assert result["status"] == "fail"
        assert result["reason"] == "FreeRouting crashed"
        assert result.get("via_count", 0) == 0

    def test_pass_with_unconnected_still_records(self):
        """Even 'pass' status should record unconnected count for scoring."""
        drc_metrics = {
            "drc_errors": 2,
            "drc_warnings": 0,
            "unconnected_count": 3,
        }
        result = build_result(
            status="pass",
            via_count=20,
            trace_length_mm=500.0,
            drc_metrics=drc_metrics,
        )
        assert result["unconnected_count"] == 3


class TestRoutingError:
    def test_is_catchable_exception(self):
        from routing.autoroute import RoutingError
        with pytest.raises(RoutingError, match="DSN export failed"):
            raise RoutingError("DSN export failed")

    def test_build_result_from_routing_error(self):
        """RoutingError message should map cleanly to a fail result."""
        from routing.autoroute import RoutingError
        err = RoutingError("SES file too small")
        result = build_result(status="fail", reason=str(err))
        assert result["status"] == "fail"
        assert result["reason"] == "SES file too small"


class TestFreeroutingJsonIsolation:
    """Test that freerouting.json is written to work_dir, not $TMPDIR."""

    def test_settings_written_to_work_dir(self):
        """The freerouting settings file path should use the work directory."""
        # We test the path construction, not the actual FreeRouting run.
        # Import the helper that builds the settings path.
        from routing.autoroute import _freerouting_settings_path

        work_dir = "/tmp/variant-abc123"
        path = _freerouting_settings_path(work_dir)
        assert path == os.path.join(work_dir, "freerouting.json")
        assert "$TMPDIR" not in path
        assert "/tmp/freerouting.json" != path
