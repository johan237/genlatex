"""Install the optional upstream browser PDF engine. No pip packages required."""
import hashlib
import io
import json
from pathlib import Path
import sys
import urllib.request
import zipfile

TAG = 'v20022022'
REPO = 'https://github.com/SwiftLaTeX/SwiftLaTeX'
DEST = Path(__file__).resolve().parents[1] / 'public' / 'vendor' / 'swiftlatex'


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'GenLaTeX-PDF-Installer'})
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.read()


def install():
    release = json.loads(get('https://api.github.com/repos/SwiftLaTeX/SwiftLaTeX/releases/tags/' + TAG))
    assets = [a for a in release.get('assets', []) if a['name'].endswith('.zip')]
    if len(assets) != 1:
        raise RuntimeError('Expected one release ZIP; inspect the upstream release before continuing.')
    data = get(assets[0]['browser_download_url'])
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        found = {}
        for item in archive.infolist():
            name = Path(item.filename).name
            if name.startswith('swiftlatexpdftex.') or name.endswith('.fmt') or name.lower() in {'license', 'license.txt', 'copying'}:
                if item.file_size > 100_000_000:
                    raise RuntimeError('Unexpectedly large engine asset.')
                if name in found:
                    raise RuntimeError('Duplicate engine asset: ' + name)
                found[name] = archive.read(item)
    for required in ('swiftlatexpdftex.js', 'swiftlatexpdftex.wasm'):
        if required not in found:
            raise RuntimeError('Release is missing ' + required)
    # Keep the original licence and upstream source reference with the binaries.
    found['LICENSE.upstream'] = get('https://raw.githubusercontent.com/SwiftLaTeX/SwiftLaTeX/' + TAG + '/LICENSE')
    DEST.mkdir(parents=True, exist_ok=True)
    for name, content in found.items():
        (DEST / name).write_bytes(content)
    (DEST / 'SOURCE.json').write_text(json.dumps({
        'upstream': REPO, 'source': REPO + '/tree/' + TAG,
        'release': TAG, 'archive': assets[0]['browser_download_url'],
        'sha256': hashlib.sha256(data).hexdigest(),
        'files': {name: hashlib.sha256(content).hexdigest() for name, content in found.items()},
    }, indent=2) + '\n', encoding='utf-8')
    print('Installed browser PDF engine in', DEST)


if __name__ == '__main__':
    try:
        install()
    except Exception as exc:
        print('PDF engine installation failed:', exc, file=sys.stderr)
        sys.exit(1)
