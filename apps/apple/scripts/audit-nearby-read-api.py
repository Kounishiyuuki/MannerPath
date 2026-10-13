#!/usr/bin/env python3
"""GET-only Release read-path audit. No device location, credentials or DB access."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import tempfile
import urllib.parse

PRODUCTION = 'https://mannerpath-api-production.happywestyuki.workers.dev'
TILES = [f'14/{x}/{y}' for x in range(14552, 14555) for y in range(6448, 6451)]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def audit(base, expected):
    with tempfile.TemporaryDirectory(prefix='mannerpath-read-audit-') as directory:
        root = pathlib.Path(directory)

        def get(path, etag=None):
            headers, body = root / 'headers', root / 'body'
            body.unlink(missing_ok=True)
            command = ['curl', '--silent', '--show-error', '--max-time', '30',
                       '--max-filesize', '1048576', '--proto', '=https',
                       '-D', str(headers), '-o', str(body), '-w', '%{http_code}']
            if etag:
                command += ['-H', 'If-None-Match: ' + etag]
            status = int(subprocess.check_output(command + [base + path], text=True))
            values = {line.split(':', 1)[0].lower(): line.split(':', 1)[1].strip()
                      for line in headers.read_text().splitlines() if ':' in line}
            return status, body.read_bytes() if body.exists() else b'', values.get('etag')

        def published(path, version):
            status, body, etag = get(path)
            require(status == 200, 'published GET failed: ' + path)
            digest = hashlib.sha256(body).hexdigest()
            require(etag == f'"{version}-{digest}"', 'ETag/body mismatch: ' + path)
            status304, body304, etag304 = get(path, etag)
            require(status304 == 304 and not body304 and etag304 == etag,
                    'conditional GET failed: ' + path)
            return json.loads(body), digest

        status, body, _ = get('/v1/config')
        config = json.loads(body)
        require(status == 200 and config['dataTileZoom'] == 14, 'unsupported config')
        require(config['minimumSupportedSchemaVersions']['tile'] <= 2
                and config['schemaVersions']['tile'] >= 1, 'unsupported tile schema')
        require(config['reports']['available'] is False, 'report intake unexpectedly enabled')
        tiles, spots, sources = [], {}, set()
        for tile in TILES:
            path = '/v1/tiles/' + tile
            status, body, _ = get(path)
            if status == 404:
                require(json.loads(body)['error'] == 'tileNotPublished', 'unexpected 404')
                tiles.append({'tile': tile, 'status': 404, 'spots': 0})
                continue
            whole, _ = published(path, 1)
            manifest, _ = published(path + '/manifest', 2)
            require(whole['tile'] == manifest['tile'] == tile, 'tile identity mismatch')
            require(manifest['partPolicy'] == 'tile-parts.v1' and len(manifest['parts']) <= 128,
                    'unsupported manifest')
            assembled = []
            for index, entry in enumerate(manifest['parts']):
                require(entry['index'] == index, 'noncanonical part index')
                part, digest = published(path + '/parts/' + str(index), 2)
                require(digest == entry['sha256'] and part['tile'] == tile
                        and part['part'] == index and part['partCount'] == len(manifest['parts'])
                        and len(part['spots']) == entry['spotCount'], 'part mismatch')
                assembled += part['spots']
            require(assembled == whole['spots'] and len(assembled) == manifest['spotCount'],
                    'snapshot/parts mismatch')
            source_ids = {source['id'] for source in whole['sources']}
            sources.update(source_ids)
            for spot in whole['spots']:
                require(spot['id'] not in spots, 'duplicate canonical spot')
                require(set(spot['sourceIds']).issubset(source_ids), 'missing attribution')
                detail_status, detail_body, _ = get('/v1/spots/' + spot['id'])
                detail = json.loads(detail_body)
                require(detail_status == 200, 'spot detail unavailable')
                # Detail is {schemaVersion, spot, sources}; only common normalized fields must match.
                detail_spot = detail['spot']
                require(all(detail_spot.get(k) == v for k, v in spot.items()),
                        'tile/detail field mismatch')
                spots[spot['id']] = spot
            tiles.append({'tile': tile, 'status': 200, 'spots': len(whole['spots']),
                          'revision': whole['revision']})
        require(len(spots) == expected, 'published count changed; review baseline before accepting')
        return {'origin': base, 'tileZoom': 14, 'tiles': tiles, 'uniqueSpots': len(spots),
                'sources': sorted(sources), 'reportsAvailable': False,
                'etag304AndPartHashes': 'PASS', 'tileDetailParity': 'PASS',
                'deviceRenderingAndAppGroup': 'UNVERIFIED'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default=PRODUCTION)
    parser.add_argument('--expected-spots', type=int, default=32)
    args = parser.parse_args()
    url = urllib.parse.urlsplit(args.base_url)
    require(url.scheme == 'https' and url.hostname and not url.username and not url.password
            and not url.query and not url.fragment and url.path in ('', '/'), 'HTTPS origin required')
    require(0 <= args.expected_spots <= 1000, 'bounded expected count required')
    print(json.dumps(audit(args.base_url.rstrip('/'), args.expected_spots), indent=2))
