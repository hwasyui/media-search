import re

for name, label in [('industry_dump', 'Industry.co.id (#536)'), ('kalimantan_dump', 'Kalimantan Post (#1007)'), ('1942_fajarpapua', 'Fajar Papua (#1942)'), ('5303_pedoman', 'Pedoman Bengkulu (#5303)')]:
    with open(f'{name}.html', encoding='utf-8') as f:
        html = f.read()

    # Pre-clean
    c = re.sub(r'<script\b[^<]*(?:(?!</script>)<[^<]*)*</script>', ' ', html, flags=re.I)
    c = re.sub(r'<style\b[^<]*(?:(?!</style>)<[^<]*)*</style>', ' ', c, flags=re.I)
    c = re.sub(r'<header\b[^<]*(?:(?!</header>)<[^<]*)*</header>', ' ', c, flags=re.I)
    c = re.sub(r'<footer\b[^<]*(?:(?!</footer>)<[^<]*)*</footer>', ' ', c, flags=re.I)
    c = re.sub(r'<nav\b[^<]*(?:(?!</nav>)<[^<]*)*</nav>', ' ', c, flags=re.I)
    c = re.sub(r'<aside\b[^<]*(?:(?!</aside>)<[^<]*)*</aside>', ' ', c, flags=re.I)
    
    # Normalize:
    c = re.sub(r'<br\s*/?>\s*<br\s*/?>', '</p><p>', c, flags=re.I)
    c = re.sub(r'<p\b([^>]*)>', r'</p><p\1>', c, flags=re.I)
    c = re.sub(r'<div\b[^>]*style=[\'"][^\'"]*text-align:\s*(?:justify|left)[^\'"]*[\'"][^>]*>([\s\S]*?)</div>', r'</p><p>\1</p><p>', c, flags=re.I)
    
    paras = []
    for m in re.finditer(r'<p\b[^>]*>([\s\S]*?)</p>', c, flags=re.I):
        raw = re.sub(r'<[^>]+>', ' ', m.group(1)).strip()
        raw = re.sub(r'\s+', ' ', raw)
        if len(raw) >= 35 and not re.match(r'^(baca juga|simak juga|baca disini|baca artikel|pilihan editor|advertisement|halaman selanjutnya|editor:|penulis:|kontributor:|pewarta\s*:|copyright\s*&copy;)', raw, flags=re.I):
            paras.append(raw)
            
    print(f'{label}: {len(paras)} paragraphs, Total chars: {sum(len(p) for p in paras)}')
    if paras:
        print(f'   First: {paras[0][:70]}...')
        print(f'   Last:  {paras[-1][:70]}...')

