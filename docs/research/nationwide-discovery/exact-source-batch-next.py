#!/usr/bin/env python3
"""Replay the frozen research selection and capture bounded, advisory HTTP receipts.

No approval, raw publication, geocoding, registry writes or database operations.
Raw bodies are written only to a caller-supplied scratch directory outside the repo.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
from urllib.error import HTTPError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[3]
INPUT = Path(__file__).with_name('2026-10-10-exact-source-batch-next.json')
CAP = 2 * 1024 * 1024

class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []
    def handle_starttag(self, tag, attrs):
        if tag in ('a', 'script'):
            for key, value in attrs:
                if key in ('href', 'src') and value:
                    self.urls.append(value)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch', type=Path)
    args = parser.parse_args()
    document = json.loads(INPUT.read_text())
    manifest_path = ROOT / 'services/data-pipeline/discovery/manifest.json'
    assert hashlib.sha256(manifest_path.read_bytes()).hexdigest() == document['selection']['manifestSha256'], 'manifest changed: review selection before replay'
    known = {row['name'] for row in json.loads(manifest_path.read_text())['targets']}
    selected = sorted((row for row in document['candidates'] if row['publisher'] not in known), key=lambda row: row['code'])[:document['selection']['cap']]
    assert len(selected) == 20 and len({row['code'] for row in selected}) == 20
    print(json.dumps({'selectedCodes': [r['code'] for r in selected], 'classifications': dict(sorted(Counter(r['classification'] for r in selected).items()))}, ensure_ascii=False))
    if args.scratch is None:
        return
    scratch = args.scratch.resolve()
    assert not scratch.is_relative_to(ROOT), 'scratch must be outside the repository'
    scratch.mkdir(parents=True, exist_ok=False)
    receipts, stopped, last = [], set(), {}
    for row in selected:
        for url in row['urls']:
            host = urlparse(url).netloc
            receipt = {'code': row['code'], 'url': url, 'fetchedAt': datetime.now(timezone.utc).isoformat()}
            if host in stopped:
                receipts.append({**receipt, 'status': 'hostStopped'})
                continue
            time.sleep(max(0, 1.5 - (time.monotonic() - last.get(host, 0))))
            try:
                with urlopen(Request(url, headers={'User-Agent': 'MannerPath-source-research/1.0'}), timeout=15) as response:
                    body = response.read(CAP + 1)
                    if len(body) > CAP:
                        receipts.append({**receipt, 'status': 'sizeLimit', 'maxBytes': CAP})
                        continue
                    digest = hashlib.sha256(body).hexdigest()
                    (scratch / digest).write_bytes(body)
                    content_type = response.headers.get('Content-Type', '')
                    receipt.update(status=response.status, finalUrl=response.url, bytes=len(body), sha256=digest, contentType=content_type)
                    if 'html' in content_type:
                        encoding = response.headers.get_content_charset() or 'utf-8'
                        text = body.decode(encoding, errors='replace')
                        links = Links()
                        links.feed(text)
                        # URLs only, no extracted coordinates, descriptions, personal data or raw rows.
                        useful = [urljoin(response.url, link) for link in links.urls if re.search(r'\.csv(?:$|\?)|\.geojson|\.kml|\.zip|opendata|bodik|wagmap|gis|map_data', link, re.I)]
                        receipt['discoveryLinks'] = sorted(set(useful))[:30]
                        receipt['smokingKeywordOccurrences'] = len(re.findall(r'喫煙|灰皿', text))
                    receipts.append(receipt)
            except HTTPError as error:
                receipts.append({**receipt, 'status': error.code})
                if error.code in (403, 429):
                    stopped.add(host)
            except Exception as error:
                receipts.append({**receipt, 'status': 'unavailable', 'errorType': type(error).__name__})
            finally:
                last[host] = time.monotonic()
    (scratch / 'receipts.json').write_text(json.dumps(receipts, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'receipts': len(receipts), 'statuses': dict(Counter(str(r['status']) for r in receipts)), 'scratch': str(scratch)}, ensure_ascii=False))

if __name__ == '__main__':
    main()
