"""Extracts geometry/text/images of the first copy of the reference PDF into dist/receipt-template.js."""
import fitz, json, sys
PDF = sys.argv[1]
d = fitz.open(PDF); p = d[0]
STEP = 264.05
rects = []
for x in p.get_drawings():
    r = x['rect']
    if r.y0 > 268 or (r.width > 500 and r.height > 700) or x.get('dashes'):
        continue
    kinds = {i[0] for i in x['items']}
    assert kinds <= {'re', 'l'} or x['type'] == 'f', (kinds, r)
    fill = x.get('fill') or x.get('color')
    rects.append([round(r.x0, 2), round(r.y0, 2), round(r.width, 2), round(r.height, 2),
                  '#%02x%02x%02x' % tuple(round(c * 255) for c in fill)])
FIX = {'Balaj i': 'Balaji', 'Guj arat': 'Gujarat', 'Kuv a': 'Kuva', 'Verav al': 'Veraval'}
texts = []
for b in p.get_text('rawdict')['blocks']:
    for l in b.get('lines', []):
        for s in l['spans']:
            if s['bbox'][1] >= 268 or s['bbox'][1] < 5: continue
            t = ''.join(c['c'] for c in s['chars'])
            if not t.strip() or t.startswith('H.O.'): continue  # head-office address line is intentionally left off
            xs = [round(c['origin'][0], 2) for c in s['chars']]
            texts.append({'t': t, 'xs': xs if len(xs) == len(t) else None, 'x0': round(s['bbox'][0], 2), 'x1': round(s['bbox'][2], 2), 'y': round(s['origin'][1], 2),
                          'b': 'Bold' in s['font'], 's': round(s['size'], 1), 'w': s['color'] == 0xffffff})
for i in p.get_image_info(xrefs=True):
    if i['bbox'][1] < 268:
        pix = fitz.Pixmap(d, i['xref'])
        if pix.alpha == 0:
            sm = d.xref_get_key(i['xref'], 'SMask')
            if sm[0] == 'xref':
                mask = fitz.Pixmap(d, int(sm[1].split()[0]))
                pix = fitz.Pixmap(pix, mask)
        name = 'logo' if i['bbox'][1] < 100 else 'qr'
        pix.save(f'dist/assets/{name}.png')
        print(name, [round(v, 1) for v in i['bbox']], pix.alpha)
# average glyph advance of the original relative to Arial's natural advance (the PDF was laid out with hinted widths)
from fontTools.ttLib import TTFont
import collections
FT = {True: TTFont('C:/Windows/Fonts/arialbd.ttf'), False: TTFont('C:/Windows/Fonts/arial.ttf')}
acc = collections.defaultdict(lambda: [0.0, 0.0])
for b in p.get_text('rawdict')['blocks']:
    for l in b.get('lines', []):
        for sp in l['spans']:
            if sp['bbox'][1] >= 268: continue
            bold = 'Bold' in sp['font']; cm = FT[bold].getBestCmap()
            for a, c2 in zip(sp['chars'], sp['chars'][1:]):
                if ' ' in (a['c'], c2['c']): continue
                nat = FT[bold]['hmtx'][cm[ord(a['c'])]][0] / 2048 * sp['size']
                k = f"{int(bold)}|{round(sp['size'], 1)}"
                acc[k][0] += c2['origin'][0] - a['origin'][0]; acc[k][1] += nat
ratio = {k: round(v[0] / v[1], 4) for k, v in acc.items()}
print(ratio)
with open('tools/template.json', 'w') as f:
    json.dump({'step': STEP, 'rects': rects, 'texts': texts, 'ratio': ratio}, f)
print(len(rects), 'rects', len(texts), 'texts')
for t in texts: print(t['t'].__repr__(), t['x0'], t['x1'], t['y'], t['b'], t['s'])
