#!/usr/bin/env python3
# @created 2026-11-03
# @description 根据正式头像源图重新生成应用图标
# @author yunhungo
"""Regenerate platform icons from the maintained avatar source."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
subprocess.run(
    ['npm', 'run', 'tauri', 'icon', 'src-tauri/icons/source.png'],
    cwd=root,
    check=True,
)
