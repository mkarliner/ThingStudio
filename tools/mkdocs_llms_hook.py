# SPDX-License-Identifier: Apache-2.0
"""MkDocs hook (mkdocs.yml `hooks:`): after every build, write llms.txt and llms-full.txt into the built site.
Runs for `mkdocs build`, `mkdocs serve` and `mkdocs gh-deploy` alike. The work is in build_llms_txt.py."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_llms_txt  # noqa: E402


def on_post_build(config, **kwargs):
    build_llms_txt.build(Path(config["config_file_path"]).resolve().parent, Path(config["site_dir"]))
