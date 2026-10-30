# Gera os ícones do app e a imagem de prévia (WhatsApp/redes) a partir de pôsteres do TMDB.
# Uso: python3 scripts/make-images.py   (rodar na pasta do projeto; precisa de Pillow e internet)
import io, subprocess
from PIL import Image, ImageDraw, ImageFilter, ImageFont

CORAL, ORANGE, BG = (255, 91, 74), (255, 138, 61), (10, 10, 15)
FONT = '/System/Library/Fonts/Avenir Next.ttc'
font = lambda size, face: ImageFont.truetype(FONT, size, index=face)  # 0 Bold, 5 Medium, 8 Heavy

def gradient(w, h, a=CORAL, b=ORANGE):
    g = Image.new('RGB', (w, h))
    px = g.load()
    for y in range(h):
        for x in range(w):
            t = (x + y) / (w + h - 2)
            px[x, y] = tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
    return g

def play_icon(size, rounded=True):
    s = 4  # supersampling
    S = size * s
    img = gradient(S, S).convert('RGBA')
    d = ImageDraw.Draw(img)
    # brilho de vidro no topo
    gloss = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(gloss).ellipse((-S * .3, -S * .75, S * 1.3, S * .45), fill=(255, 255, 255, 46))
    img = Image.alpha_composite(img, gloss)
    d = ImageDraw.Draw(img)
    # triângulo de play com cantos suaves
    cx, cy, r = S * .54, S * .5, S * .25
    tri = [(cx - r * .8, cy - r), (cx - r * .8, cy + r), (cx + r, cy)]
    d.polygon(tri, fill='white')
    d.line(tri + [tri[0]], fill='white', width=int(S * .06), joint='curve')
    img = img.resize((size, size), Image.LANCZOS)
    if rounded:
        m = Image.new('L', (S, S), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, S - 1, S - 1), radius=S * .225, fill=255)
        img.putalpha(m.resize((size, size), Image.LANCZOS))
    return img

play_icon(512).save('icon-512.png')
play_icon(192).save('icon-192.png')
play_icon(180, rounded=False).convert('RGB').save('apple-touch-icon.png')  # o iOS arredonda sozinho
play_icon(64).save('favicon.png')

# ---------- prévia 1200x630 ----------
POSTERS = [  # Stranger Things, Duna 2, The Last of Us, Wandinha, Coringa
    'twfKp60THrcOIep9sjHODOOfO8d.jpg', 'VMy4UGsI2u3f4fALGeCqCdsQBb.jpg', 'qWo5TP7mBijoZrfxBJkUMctkBt0.jpg', '7rxiQrZjrer0RB9qNA8rHYFo53R.jpg', 'xLxgVxFWvb9hhUyCDDXxRPPnFck.jpg']
def poster(path, h=430):
    data = subprocess.run(['curl', '-sf', '-m', '30', f'https://image.tmdb.org/t/p/w500/{path}'], capture_output=True, check=True).stdout
    im = Image.open(io.BytesIO(data)).convert('RGBA')
    im = im.resize((round(h * 2 / 3), h), Image.LANCZOS)
    m = Image.new('L', im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius=22, fill=255)
    im.putalpha(m)
    return im

W, H = 1200, 630
og = Image.new('RGBA', (W, H), BG + (255,))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((700, -60, 1300, 700), fill=CORAL + (60,))
og = Image.alpha_composite(og, glow.filter(ImageFilter.GaussianBlur(160)))

# leque de pôsteres à direita
fan = [(-14, 640, 150), (-7, 735, 120), (0, 840, 95), (7, 945, 120), (14, 1040, 150)]
ims = [poster(p) for p in POSTERS]
for (ang, x, y), im in sorted(zip(fan, ims), key=lambda t: -abs(t[0][0])):
    shadow = Image.new('RGBA', (im.width + 80, im.height + 80), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((40, 50, im.width + 40, im.height + 50), radius=22, fill=(0, 0, 0, 150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18)).rotate(-ang, expand=True, resample=Image.BICUBIC)
    rot = im.rotate(-ang, expand=True, resample=Image.BICUBIC)
    og.alpha_composite(shadow, (x - shadow.width // 2, y - 40))
    og.alpha_composite(rot, (x - rot.width // 2, y))

# degradê para o texto respirar
fade = Image.new('RGBA', (W, H), (0, 0, 0, 0))
fd = ImageDraw.Draw(fade)
for x in range(780):
    a = int(255 * max(0, min(1, (780 - x) / 400)) ** 1.6)
    fd.line([(x, 0), (x, H)], fill=BG + (a,))
og = Image.alpha_composite(og, fade)

d = ImageDraw.Draw(og)
og.alpha_composite(play_icon(96), (80, 150))
d.text((80, 270), 'O que ver hoje', font=font(76, 8), fill='white')
d.text((82, 370), 'A recomendação de filme ou série', font=font(32, 5), fill=(200, 200, 212))
d.text((82, 412), 'do dia, nas suas plataformas.', font=font(32, 5), fill=(200, 200, 212))
label = 'Netflix · Prime · Disney+ · HBO Max…'
tw = d.textlength(label, font=font(22, 2))
pill = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(pill).rounded_rectangle((82, 486, 82 + tw + 48, 538), radius=26, fill=(255, 255, 255, 28), outline=(255, 255, 255, 70), width=2)
og = Image.alpha_composite(og, pill)
d = ImageDraw.Draw(og)
d.text((106, 497), label, font=font(22, 2), fill='white')
og.convert('RGB').save('og.jpg', quality=86, optimize=True, progressive=True)
print('ok')
