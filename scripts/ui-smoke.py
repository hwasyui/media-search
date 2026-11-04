# Penyisiran UI di Chromium sungguhan (Playwright): membuka semua halaman, tab, filter, urutan, modal, lalu melaporkan JS error dan permintaan gagal.
# Pakai:  python scripts/ui-smoke.py http://localhost:3062   (server harus menyala; butuh: pip install playwright && playwright install chromium)
import sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 1366, 'height': 900}).new_page()
    errs, bad = [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append('console.error: ' + m.text) if m.type == 'error' else None)
    pg.on('response', lambda r: bad.append(f'{r.status} {r.url.replace(BASE, "")}') if r.status >= 400 and 'favicon' not in r.url and 'google.com/s2' not in r.url else None)
    pg.add_init_script("sessionStorage.setItem('ms.asst.seen','1'); localStorage.setItem('ms.asst.open','false');")
    for url in ['/portal.html', '/portal.html#/c/bca', '/portal.html#/c/freeport', '/portal.html#/c/gotoyoy', '/portal.html#/c/pertamina', '/jobs.html', '/diagnose.html']:
        pg.goto(BASE + url); pg.wait_for_timeout(2200)
        if '#/c/' in url:
            for t in ('risiko', 'analisis', 'keuangan', 'berita', 'profil', 'ringkasan'):
                el = pg.query_selector(f'[data-t="{t}"]')
                if el: el.click(); pg.wait_for_timeout(1300)
    # beranda: tiap tab filter, tiap urutan, filter lanjutan, modal, pencarian
    pg.goto(BASE + '/portal.html'); pg.wait_for_timeout(2500)
    for t in pg.query_selector_all('#exploreMount [data-f]'):
        pg.query_selector(f'#exploreMount [data-f="{t.get_attribute("data-f")}"]').click(); pg.wait_for_timeout(700)
    for s in ['latest', 'oldest', 'risk', 'credibility', 'confidence', 'seen', 'relevant', 'mix']:
        pg.select_option('#fsort', s); pg.wait_for_timeout(700)
    pg.click('#fadv'); pg.wait_for_timeout(200)
    ids = pg.evaluate("[...document.querySelectorAll('#fadvBox select')].map(e => e.id)")
    for sid in ids:
        opts = pg.evaluate("id => [...document.getElementById(id).options].map(o => o.value).filter(Boolean)", sid)
        if opts:
            pg.select_option('#' + sid, opts[0]); pg.wait_for_timeout(600)
            pg.select_option('#' + sid, ''); pg.wait_for_timeout(500)
    pg.click('#fraw'); pg.wait_for_timeout(700); pg.click('#fraw'); pg.wait_for_timeout(700)
    pg.fill('#fq', 'saham'); pg.keyboard.press('Enter'); pg.wait_for_timeout(1200)
    a = pg.query_selector('#exploreMount .news')
    if a: a.click(); pg.wait_for_timeout(1500); pg.keyboard.press('Escape')
    pg.click('#addCo'); pg.wait_for_timeout(200); pg.click('#acClose')
    print('halaman & interaksi disapu | permintaan gagal (>=400):', sorted(set(bad)) or 'tidak ada')
    print('error JS/console:', sorted(set(errs))[:6] or 'tidak ada')
    b.close()
