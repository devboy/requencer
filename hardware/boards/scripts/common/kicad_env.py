"""KiCad path resolution and environment setup.

Centralizes the KiCad application paths (Python, CLI, frameworks)
that were previously duplicated across autoroute.sh and Makefile.

Usage:
    from common.kicad_env import setup_kicad_env, get_kicad_cli

    setup_kicad_env()  # adds KiCad Python to sys.path + sets DYLD env
    import pcbnew      # now available

    cli = get_kicad_cli()  # path to kicad-cli binary
"""

import os
import sys


def _find_kicad_app():
    """Find the KiCad application directory."""
    app = os.environ.get("KICAD_APP", "/Applications/KiCad/KiCad.app")
    if os.path.isdir(app):
        return app
    # Docker / Linux fallback — KiCad installed system-wide
    return None


def get_kicad_python():
    """Get the path to KiCad's bundled Python interpreter."""
    custom = os.environ.get("KICAD_PYTHON")
    if custom:
        return custom
    app = _find_kicad_app()
    if app:
        return os.path.join(
            app, "Contents", "Frameworks", "Python.framework",
            "Versions", "3.9", "bin", "python3"
        )
    return "python3"  # system python (Docker)


def get_kicad_cli():
    """Get the path to kicad-cli binary."""
    custom = os.environ.get("KICAD_CLI")
    if custom:
        return custom
    app = _find_kicad_app()
    if app:
        return os.path.join(app, "Contents", "MacOS", "kicad-cli")
    return "kicad-cli"  # system PATH (Docker)


def get_java():
    """Get the path to Java binary (for FreeRouting)."""
    return os.environ.get("JAVA", "/opt/homebrew/opt/openjdk/bin/java")


def setup_kicad_env():
    """Set up environment so `import pcbnew` works.

    On macOS, KiCad bundles its own Python with pcbnew in a framework.
    This function adds the framework paths to sys.path and sets the
    DYLD_FRAMEWORK_PATH so native libraries load correctly.

    Safe to call multiple times — checks if already configured.
    """
    # Skip if pcbnew is already importable
    try:
        import pcbnew  # noqa: F401
        return
    except ImportError:
        pass

    app = _find_kicad_app()
    if not app:
        return  # Docker/Linux — pcbnew should be on sys.path already

    fw_path = os.path.join(app, "Contents", "Frameworks")
    py_path = os.path.join(
        fw_path, "Python.framework", "Versions", "3.9",
        "lib", "python3.9", "site-packages"
    )

    if py_path not in sys.path:
        sys.path.insert(0, py_path)

    os.environ["DYLD_FRAMEWORK_PATH"] = fw_path

    # Also set PYTHONPATH for subprocesses
    existing = os.environ.get("PYTHONPATH", "")
    if py_path not in existing:
        os.environ["PYTHONPATH"] = py_path + (":" + existing if existing else "")


def kicad_env_dict():
    """Return env dict for subprocess calls that need KiCad Python.

    Use as: subprocess.run([...], env={**os.environ, **kicad_env_dict()})
    """
    app = _find_kicad_app()
    if not app:
        return {}

    fw_path = os.path.join(app, "Contents", "Frameworks")
    py_path = os.path.join(
        fw_path, "Python.framework", "Versions", "3.9",
        "lib", "python3.9", "site-packages"
    )
    return {
        "DYLD_FRAMEWORK_PATH": fw_path,
        "PYTHONPATH": py_path,
    }
