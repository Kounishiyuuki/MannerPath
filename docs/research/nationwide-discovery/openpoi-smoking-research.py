#!/usr/bin/env python3
"""Research only. Raw data/cache goes to an explicitly supplied directory, never D1.
Python 3; bulk requires duckdb==1.4.5. Commands: fetch, bulk, analyze, check.
No production source approval, canonical IDs, merges, or publication.
"""
import argparse
import collections
import hashlib
import json
import math
import pathlib
import re
import struct
import time
import unicodedata
import urllib.parse
import urllib.request

RELEASE = '2026-09-23.1'
QUERIES = ['喫煙', '禁煙', '防煙', '灰皿', 'smoking', 'smoke', 'スモーキング', '喫烟', 'たばこ', 'タバコ', '煙草']
BBOX = [122, 20, 154, 46]
POSITIVE = r'指定喫煙場所|公衆喫煙場所|喫煙場所|喫煙休憩室|喫煙所|喫煙室|喫煙ルーム|喫煙スペース|喫煙コーナー|喫煙ラウンジ|喫煙処|(?<![a-z])smoking\s+(?:area|room|lounge)(?![a-z])'
NEGATIVE = r'禁煙|喫煙禁止|路上喫煙禁止|受動喫煙|喫煙対策|防煙|喫煙防止|non[ -]?smoking|no\s+smoking|smoke[ -]?free'
HOST_CATEGORIES = {'restaurant', 'cafe', 'bar_izakaya', 'lodging', 'medical', 'hookah_bar', 'hotel', 'bar', 'casual_eatery', 'coffee_shop', 'tobacco_shop', 'smoke_and_vape_store', 'smokehouse'}
PROVIDER_LICENSE = {**dict.fromkeys(['overture', 'meta', 'microsoft', 'pinmeto', 'krick', 'renderseo', 'dac', 'brightquery'], 'CDLA-Permissive-2.0'), 'foursquare': 'Apache-2.0', 'alltheplaces': 'CC0-1.0'}
ALLOW = {'CC0-1.0', 'CDLA-Permissive-2.0', 'Apache-2.0', 'CC BY 4.0', 'PDL1.0'}


def dump(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def get(url):
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=90) as response:
                return response.read()
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)


def fetch(root):
    root.mkdir(parents=True, exist_ok=True)
    logs, records, unresolved = [], {}, []

    def scan(query, bbox=None, depth=0):
        params = {'q': query, 'limit': 200}
        if bbox is not None:
            params['bbox'] = ','.join(map(str, bbox))
        url = 'https://api.openpoiapi.com/v1/search?' + urllib.parse.urlencode(params)
        raw = get(url)
        result = json.loads(raw)
        filename = f'response-{len(logs):04}.json'
        (root / filename).write_bytes(raw)
        logs.append({'url': url, 'count': result['count'], 'sha256': hashlib.sha256(raw).hexdigest(), 'file': filename})
        if result['count'] != len(result['results']):
            raise ValueError('count != returned rows')
        if len(result['results']) == 200:
            if depth == 18:
                unresolved.append(params)
                return
            x0, y0, x1, y1 = bbox or BBOX
            xm, ym = (x0 + x1) / 2, (y0 + y1) / 2
            for child in [[x0, y0, xm, ym], [xm, y0, x1, ym], [x0, ym, xm, y1], [xm, ym, x1, y1]]:
                scan(query, child, depth + 1)
        else:
            for row in result['results']:
                # Research response deduplication only. NEVER a canonical natural key.
                key = hashlib.sha256(json.dumps(row, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
                entry = records.setdefault(key, {'record': row, 'queries': []})
                entry['queries'].append(query)
        time.sleep(.15)
    for query in QUERIES:
        scan(query)
        print(query, len(records), flush=True)
    dump(root / 'openpoi-scan.json', {'queries': QUERIES, 'requests': logs, 'unresolved': unresolved, 'records': list(records.values())})
    for filename, url in {
        'openapi.json': 'https://api.openpoiapi.com/openapi.json',
        'legal.html': 'https://docs.openpoiapi.com/legal.html',
        'attribution.html': 'https://openpoiapi.com/attribution.html',
        'taxonomy.csv': 'https://docs.overturemaps.org/taxonomy/2026-09-23.0/taxonomy.csv',
        'municipalities.json': 'https://raw.githubusercontent.com/geolonia/japanese-addresses/master/api/ja.json',
    }.items():
        (root / filename).write_bytes(get(url))


def bulk(root):
    import duckdb
    root.mkdir(parents=True, exist_ok=True)
    connection = duckdb.connect(str(root / 'research.duckdb'))
    connection.execute('SET extension_directory=?', [str(root / 'extensions')])
    connection.execute('INSTALL httpfs; LOAD httpfs')
    connection.execute("SET s3_region='us-west-2'; SET threads=6")
    path = f's3://overturemaps-us-west-2/release/{RELEASE}/theme=places/type=place/*'
    connection.execute(f"CREATE OR REPLACE TABLE jp AS SELECT * FROM read_parquet('{path}') WHERE bbox.xmin BETWEEN 122 AND 154 AND bbox.ymin BETWEEN 20 AND 46")
    # Bbox deliberately overcovers Japan incl. islands; country check is separate.
    connection.execute("COPY (SELECT * EXCLUDE(geometry), hex(geometry) AS geometry_wkb_hex FROM jp WHERE regexp_matches(lower(coalesce(names.primary,'')), '喫煙|禁煙|防煙|smok|たばこ|タバコ|煙草|灰皿') OR regexp_matches(lower(coalesce(taxonomy.primary,'')), 'smok|tobacco|hookah')) TO ? (FORMAT JSON, ARRAY true)", [str(root / 'overture-signals.json')])
    connection.execute('COPY (SELECT taxonomy.primary AS category,count(*) AS count FROM jp GROUP BY 1 ORDER BY 1) TO ? (FORMAT JSON, ARRAY true)', [str(root / 'overture-categories.json')])
    dump(root / 'bulk-counts.json', {'release': RELEASE, 'bbox': BBOX, 'bbox_count': connection.execute('SELECT count(*) FROM jp').fetchone()[0], 'jp_address_count': connection.execute("SELECT count(*) FROM jp WHERE list_contains(list_transform(addresses,a->a.country),'JP')").fetchone()[0]})
    connection.close()
    url = 'https://overturemaps-us-west-2.s3.amazonaws.com/?' + urllib.parse.urlencode({'list-type': 2, 'prefix': f'release/{RELEASE}/theme=places/type=place/'})
    import xml.etree.ElementTree as xml
    tree = xml.fromstring(get(url))
    ns = {'s': 'http://s3.amazonaws.com/doc/2006-03-01/'}
    if tree.findtext('s:IsTruncated', namespaces=ns) != 'false':
        raise ValueError('Release object manifest truncated')
    dump(root / 'overture-manifest.json', {'url': url, 'is_truncated': 'false', 'objects': [{'key': item.findtext('s:Key', namespaces=ns), 'etag': item.findtext('s:ETag', namespaces=ns), 'size': int(item.findtext('s:Size', namespaces=ns))} for item in tree.findall('s:Contents', ns)]})


def norm(text):
    return unicodedata.normalize('NFKC', text or '').lower()


def gate(row):
    name = norm(row['name'])
    if re.search(NEGATIVE, name):
        return 'negative_smoking_statement', None
    match = re.search(POSITIVE, name)
    if not match:
        return 'no_explicit_physical_smoking_place', None
    if row['source'] == 'jff':
        return 'food_permit_not_smoking_feature', match.group()
    if re.search(r'(?:喫煙所|喫煙室|喫煙コーナー|喫煙休憩室)(?:横|前|南|側|内|カップ|\s*[①②])', name):
        return 'relative_host_or_vending_location', match.group()
    if re.search(r'従業員|職員|従食|工場|株式会社|\(株\)|生産部|営業所|ディストリビューション', name):
        return 'private_or_staff_access_unestablished', match.group()
    if row['category'] in HOST_CATEGORIES or any(c in ['food_and_drink', 'lodging'] for c in row.get('taxonomy_hierarchy', [])):
        return 'host_category_conflict', match.group()
    if row.get('operating_status') in ['permanently_closed', 'temporarily_closed']:
        return 'closed', match.group()
    return 'strong_name_candidate', match.group()


def overture_row(row):
    wkb = bytes.fromhex(row['geometry_wkb_hex'])
    endian = '<' if wkb[0] == 1 else '>'
    if len(wkb) != 21 or struct.unpack(endian + 'I', wkb[1:5])[0] != 1:
        raise ValueError('Expected WGS84 2D Point WKB')
    longitude, latitude = struct.unpack(endian + 'dd', wkb[5:])
    addresses = row.get('addresses') or []
    address = next((a for a in addresses if a.get('country') == 'JP'), addresses[0] if addresses else {})
    countries = {a.get('country') for a in addresses if a.get('country')}
    licenses = set()
    unknown = False
    for source in row.get('sources') or []:
        license_name = source.get('license')
        if license_name != PROVIDER_LICENSE.get((source.get('dataset') or '').lower()):
            unknown = True
        if not license_name:
            unknown = True
        else:
            licenses.add(license_name)
    if not row.get('sources'):
        unknown = True
    return {'id': row['id'], 'name': (row.get('names') or {}).get('primary') or '', 'category': (row.get('taxonomy') or {}).get('primary') or 'unknown', 'source': 'overture', 'providers': sorted({s.get('dataset') or 'unknown' for s in row.get('sources') or []}), 'licenses': sorted(licenses), 'unknown_license': unknown, 'prefecture': address.get('region') or '', 'city': address.get('locality') or '', 'address': address.get('freeform') or '', 'lat': latitude, 'lng': longitude, 'confidence': row.get('confidence'), 'taxonomy_hierarchy': (row.get('taxonomy') or {}).get('hierarchy') or [], 'operating_status': row.get('operating_status'), 'foreign': bool(countries and 'JP' not in countries), 'country_unknown': not countries}


def prefecture(row, municipalities):
    for p in municipalities:
        if p in row.get('prefecture', '') or p in row.get('address', ''):
            return p
    city = row.get('city') or ''
    candidates = {p for p, cities in municipalities.items() if city and any(city == c or city.startswith(c) or c.startswith(city) for c in cities)}
    return next(iter(candidates)) if len(candidates) == 1 else 'unknown'


def distance(a, b):
    lat1, lat2 = math.radians(a['lat']), math.radians(b['latitude'])
    dlat, dlon = lat2-lat1, math.radians(b['longitude']-a['lng'])
    value = math.sin(dlat/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 6371008.8*2*math.asin(min(1, math.sqrt(value)))


def compare(row, official):
    pairs = [(distance(row, item), item) for item in official]
    exact = [(d, i) for d, i in pairs if d <= 1 and norm(row['name']) == norm(i['name'])]
    near = [(d, i) for d, i in pairs if d <= 100]
    kind = 'exact_duplicate' if exact else 'near_duplicate' if any(norm(row['name']) == norm(i['name']) for d, i in near) else 'ambiguous' if near else 'clearly_new_relative_to_baseline'
    return {'classification': kind, 'matches': [{'spot_id': i['spot_id'], 'name': i['name'], 'distance_m': round(d, 1)} for d, i in (exact or near)]}


def summarize(rows, municipalities, official):
    reasons, strong, keywords = collections.Counter(), [], collections.Counter()
    for row in rows:
        reason, keyword = ('non_japan_address', None) if row.get('foreign') else ('country_unknown', None) if row.get('country_unknown') else gate(row)
        reasons[reason] += 1
        if reason == 'strong_name_candidate':
            row = dict(row, keyword=keyword, resolved_prefecture=prefecture(row, municipalities))
            row['license_gate'] = 'pass' if row.get('licenses') and all(l in ALLOW for l in row['licenses']) and not row.get('unknown_license') else 'fail'
            row['official_comparison'] = compare(row, official)
            strong.append(row)
            keywords[keyword] += 1
    def counts(key, sequence=rows):
        return dict(sorted(collections.Counter(r.get(key) or 'unknown' for r in sequence).items()))
    return {'raw_signal_records': len(rows), 'unknown_license_records': sum(bool(r.get('unknown_license')) or not r.get('licenses') for r in rows), 'unsupported_or_missing_license_records': sum(bool(r.get('unknown_license')) or not r.get('licenses') or any(l not in ALLOW for l in r.get('licenses', [])) for r in rows), 'raw_by_provider': dict(sorted(collections.Counter(p for r in rows for p in r.get('providers', [r['source']])).items())), 'strong_by_provider': dict(sorted(collections.Counter(p for r in strong for p in r.get('providers', [r['source']])).items())), 'strong_smoking_candidates': len(strong), 'excluded': len(rows)-len(strong), 'exclusion_reasons': dict(sorted((k, v) for k, v in reasons.items() if k != 'strong_name_candidate')), 'raw_by_source': counts('source'), 'raw_by_category': counts('category'), 'raw_by_license': dict(sorted(collections.Counter(l for r in rows for l in r.get('licenses') or ['unknown']).items())), 'strong_by_prefecture': counts('resolved_prefecture', strong), 'prefectures_represented': len({r['resolved_prefecture'] for r in strong}-{ 'unknown'}), 'strong_by_city': counts('city', strong), 'strong_by_source': counts('source', strong), 'strong_by_category': counts('category', strong), 'strong_by_license': dict(sorted(collections.Counter(l for r in strong for l in r.get('licenses') or ['unknown']).items())), 'strong_by_keyword': dict(sorted(keywords.items())), 'strong_license_gate': counts('license_gate', strong), 'official_comparison': {k: sum(r['official_comparison']['classification'] == k for r in strong) for k in ['exact_duplicate','near_duplicate','ambiguous','clearly_new_relative_to_baseline']}, 'candidates': sorted(strong, key=lambda r: (r.get('id') or '', r['name'], r['lat'], r['lng']))}


def analyze(root, output):
    scan = json.loads((root / 'openpoi-scan.json').read_text())
    official = json.loads((root / 'official.json').read_text())
    municipalities = json.loads((root / 'municipalities.json').read_text())
    overture = [overture_row(r) for r in json.loads((root / 'overture-signals.json').read_text())]
    result = {'schema_version': 1, 'decision': 'NOT VIABLE', 'architecture': 'D', 'publication_approved': False, 'human_per_record_review_required_for_current_candidates': True, 'automatic_publication_records': 0, 'research_gate_version': 'openpoi-smoking-name-research.v1', 'evidence_tier_proposal': {'existence': 'openData', 'evidenceQuality': 'openDataListing', 'label': 'オープンデータ掲載', 'implemented': False}, 'lastVerifiedAt_proposal': None, 'foundation_conditions': {'sufficient_scale': 'FAIL', 'machine_only_precision': 'UNPROVEN', 'license_machine_gate': 'CONDITIONAL: provider/license names supported; notices and source registry approval remain', 'stable_identity': 'DESIGN VIABLE with Overture GERS crosswalk; cross-release replay not performed'}, 'minimum_scale_target': 200, 'license_gate_scope': 'license-name/provider compatibility only; notices, attribution delivery and source approval not implemented', 'false_positive_rate': None, 'false_positive_retrieval_examples': [{'name': '禁煙Bar 4416 No Smoking Bar', 'reason': 'negative_smoking_statement'}, {'name': 'Smoking & Non Smoking', 'reason': 'negative_smoking_statement'}, {'name': 'Smoke and Grill Rivage', 'reason': 'no_explicit_physical_smoking_place'}, {'name': 'スパーク・喫煙具専門店', 'reason': 'no_explicit_physical_smoking_place'}, {'name': '546：301249：山陽オート センターホール１Ｆ喫煙所横', 'reason': 'food_permit_not_smoking_feature'}], 'bulk': json.loads((root / 'bulk-counts.json').read_text()), 'research_date': '2026-10-04', 'overture_release_manifest': json.loads((root / 'overture-manifest.json').read_text()), 'official_baseline': {'kind': 'fresh_in_memory_reviewed_fixture_publication', 'count': len(official), 'sources': dict(collections.Counter(r['source_id'] for r in official))}, 'openpoi': summarize([r['record'] for r in scan['records']], municipalities, official), 'overture': summarize(overture, municipalities, official), 'openpoi_request_count': len(scan['requests']), 'openpoi_requests': scan['requests'], 'openpoi_unresolved_saturated_cells': scan['unresolved'], 'openpoi_keyword_return_counts': dict(collections.Counter(q for r in scan['records'] for q in set(r['queries']))), 'artifact_hashes': {f: digest(root / f) for f in ['openapi.json', 'legal.html', 'attribution.html', 'taxonomy.csv', 'municipalities.json', 'openpoi-scan.json', 'overture-signals.json', 'overture-categories.json', 'bulk-counts.json', 'official.json', 'overture-manifest.json']}, 'limitations': ['OpenPOI keyword corpus is not a full POI dump or a smoking completeness guarantee.', 'Overture bbox overcovers Japan; known non-JP countries excluded from candidate lane; missing country is unresolved.', 'Clearly new means no official fixture point within 100m, not independently verified novelty or public access.', 'No independently labeled ground truth: real-world false-positive rate unknown.', 'Names alone plus generic categories do not establish current public access or legal smoking permission.']}
    dump(output, result)
    print(json.dumps({k: result['overture'][k] for k in ['raw_signal_records','strong_smoking_candidates','prefectures_represented','official_comparison']}, ensure_ascii=False))


def check(root, output):
    result = json.loads(output.read_text())
    assert isinstance(result, dict)
    assert result['bulk']['bbox_count'] >= result['bulk']['jp_address_count'] >= result['overture']['strong_smoking_candidates']
    assert result['official_baseline']['count'] == sum(result['official_baseline']['sources'].values())
    assert result['schema_version'] == 1 and result['decision'] in ['VIABLE', 'NOT VIABLE']
    assert result['architecture'] in ['A','B','C','D']
    assert result['automatic_publication_records'] == 0 and not result['publication_approved']
    for key in ['openpoi','overture']:
        summary = result[key]
        assert summary['raw_signal_records'] == summary['strong_smoking_candidates'] + summary['excluded']
        assert summary['excluded'] == sum(summary['exclusion_reasons'].values())
        assert summary['strong_smoking_candidates'] == len(summary['candidates']) == sum(summary['official_comparison'].values())
    assert not result['openpoi_unresolved_saturated_cells']
    for filename, expected in result['artifact_hashes'].items():
        assert digest(root / filename) == expected, filename
    cases = [('禁煙Bar 4416 No Smoking Bar','negative_smoking_statement'), ('Smoking & Non Smoking','negative_smoking_statement'), ('喫煙所横','relative_host_or_vending_location'), ('喫煙所','strong_name_candidate'), ('コンビニ','no_explicit_physical_smoking_place'), ('喫煙具専門店','no_explicit_physical_smoking_place'), ('Smoke and Grill','no_explicit_physical_smoking_place'), ('喫煙禁止区域','negative_smoking_statement'), ('ホテル喫煙ルーム','host_category_conflict')]
    for name, reason in cases:
        assert gate({'name':name,'source':'overture','category':'lodging' if name.startswith('ホテル') else 'unknown'})[0] == reason, name
    assert gate({'name':'喫煙所','source':'jff','category':'unknown'})[0] == 'food_permit_not_smoking_feature'
    fixture = json.loads((root / 'overture-signals.json').read_text())[0]
    mixed = dict(fixture, sources=[{'dataset':'meta','license':'CDLA-Permissive-2.0'},{'dataset':'unknown','license':None}])
    assert overture_row(mixed)['unknown_license']
    missing = dict(fixture, sources=[{'dataset':'meta','license':None}])
    assert overture_row(missing)['unknown_license'] and not overture_row(missing)['licenses']
    mismatch = dict(fixture, sources=[{'dataset':'meta','license':'CC0-1.0'}])
    assert overture_row(mismatch)['unknown_license']
    point = overture_row(fixture)
    assert -180 <= point['lng'] <= 180 and -90 <= point['lat'] <= 90
    print('Schema/count/hash checks, 10 adversarial name cases, 3 license cases and Point decode passed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['fetch','bulk','analyze','check'])
    parser.add_argument('--cache', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path)
    args = parser.parse_args()
    if args.command in ['analyze','check'] and not args.output:
        parser.error('--output required')
    {'fetch': lambda: fetch(args.cache), 'bulk': lambda: bulk(args.cache), 'analyze': lambda: analyze(args.cache,args.output), 'check': lambda: check(args.cache,args.output)}[args.command]()
