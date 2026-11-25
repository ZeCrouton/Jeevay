#!/usr/bin/env python3
"""Construit la base de lieux de Jeevay à partir d'un export osmium (GeoJSON séquentiel).
Entrée : fichier .geojsonseq ; sortie : dossier avec index.json et un fichier par case de 0,25°.
Format d'une case : {"v":1,"p":[[cat, lon, lat, nom, extra], ...]}  (extra : dict court ou 0)."""
import json, math, os, sys, datetime

SIZE = 0.25
EXTRA = ('opening_hours', 'ele', 'fuel:diesel', 'fuel:octane_98', 'automated', 'brand')
# Hébergements : type, étoiles et moyens de contact (téléphone, site web)
SLEEP = ('hotel', 'motel', 'guest_house', 'hostel', 'chalet', 'apartment', 'camp_site', 'alpine_hut')
SLEEP_EXTRA = ('tourism', 'stars', 'phone', 'contact:phone', 'website', 'contact:website')

def cat_of(t):
    tr = t.get('tourism')
    if tr in SLEEP:
        # locations sans nom (souvent des logements de particuliers) ignorées
        return 'sleep' if t.get('name') or tr in ('hotel', 'motel', 'camp_site', 'alpine_hut', 'hostel') else None
    a = t.get('amenity')
    if a == 'fuel': return 'fuel'
    if a == 'drinking_water': return 'water'
    if a == 'toilets': return 'wc'
    if a in ('cafe', 'restaurant'): return 'food' if t.get('name') else None
    if a == 'bicycle_repair_station' or t.get('shop') == 'bicycle': return 'bike'
    if t.get('mountain_pass') == 'yes': return 'pass' if t.get('name') else None
    if t.get('tourism') == 'viewpoint': return 'view'
    return None

def centre(g):
    t, c = g['type'], g['coordinates']
    if t == 'Point': return c
    ring = {'LineString': c, 'Polygon': c[0] if c else [], 'MultiPolygon': c[0][0] if c and c[0] else [],
            'MultiLineString': c[0] if c else []}.get(t, [])
    if not ring: return None
    return [sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)]

def main(src, out):
    tiles, n, seen = {}, 0, set()
    with open(src, encoding='utf-8') as f:
        for line in f:
            line = line.strip().lstrip('\x1e')
            if not line: continue
            ft = json.loads(line)
            t = ft.get('properties') or {}
            cat = cat_of(t)
            if not cat or not ft.get('geometry'): continue
            uid = (t.get('@type', '?')[:1]) + str(t.get('@id', n))
            if uid in seen: continue
            seen.add(uid)
            c = centre(ft['geometry'])
            if not c: continue
            x, y = math.floor(c[0] / SIZE), math.floor(c[1] / SIZE)
            keys = EXTRA + SLEEP_EXTRA if cat == 'sleep' else EXTRA
            ex = {k.replace('contact:', ''): str(t[k])[:120] for k in keys if k in t}
            name = t.get('name') or t.get('brand') or t.get('operator') or ''
            tiles.setdefault(f'{x}_{y}', []).append([cat, round(c[0], 5), round(c[1], 5), str(name)[:80], ex or 0, uid])
            n += 1
    os.makedirs(out, exist_ok=True)
    for k, pts in tiles.items():
        with open(os.path.join(out, k + '.json'), 'w', encoding='utf-8') as f:
            json.dump({'v': 1, 'p': pts}, f, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(out, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump({'v': 1, 'size': SIZE, 'date': datetime.date.today().isoformat(), 'count': n, 'tiles': sorted(tiles)}, f, separators=(',', ':'))
    print(f'{n} lieux, {len(tiles)} cases')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
