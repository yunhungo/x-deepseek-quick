#!/usr/bin/env python3
# @created 2026-11-04
# @description 签名并生成可校验的 macOS 安装镜像，清理临时挂载和副本
# @author yunhungo
"""Package an existing release APP; use the configured identity or local ad-hoc signing."""
from pathlib import Path
import os
import platform
import plistlib
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / 'src-tauri/target/release/bundle'
APP = BUNDLE / 'macos/DSQuick.app'


def run(*args: str) -> None:
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)


def main() -> None:
    info = plistlib.loads((APP / 'Contents/Info.plist').read_bytes())
    version = info['CFBundleShortVersionString']
    architecture = 'aarch64' if platform.machine() == 'arm64' else platform.machine()
    output = BUNDLE / 'dmg' / f'DSQuick_{version}_{architecture}.dmg'
    output.parent.mkdir(parents=True, exist_ok=True)
    run('codesign', '--force', '--sign', os.environ.get('APPLE_SIGNING_IDENTITY', '-'),
        '--timestamp=none', str(APP))
    run('codesign', '--verify', '--deep', '--strict', str(APP))
    tasks = ROOT / '.myself/homeless'
    tasks.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='dsquick-package-', dir=tasks) as temporary:
        task = Path(temporary)
        source = task / 'installer'
        source.mkdir()
        run('ditto', str(APP), str(source / APP.name))
        (source / 'Applications').symlink_to('/Applications')
        run('hdiutil', 'create', '-volname', 'DSQuick', '-srcfolder', str(source),
            '-ov', '-format', 'UDZO', str(output))
        run('hdiutil', 'verify', str(output))
        mount = task / 'mount'
        mount.mkdir()
        run('hdiutil', 'attach', '-readonly', '-nobrowse', '-mountpoint', str(mount), str(output))
        try:
            packaged = mount / APP.name
            run('codesign', '--verify', '--deep', '--strict', str(packaged))
            relative = 'Contents/Resources/scripts/glass.js'
            if (packaged / relative).read_bytes() != (ROOT / 'src-tauri/scripts/glass.js').read_bytes():
                raise RuntimeError('Packaged adapter differs from source')
        finally:
            run('hdiutil', 'detach', str(mount))
    print(f'Verified macOS package: {output.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
