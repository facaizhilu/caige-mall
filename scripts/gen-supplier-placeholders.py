# 生成供应商演示商品占位图(白底、中性灰色简单图形,无文字/Logo)
# 用法: python3 scripts/gen-supplier-placeholders.py  (需要 Pillow;生成结果已提交,运行时无需 Python)
from PIL import Image, ImageDraw
import os
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'img', 'supplier-demo')
os.makedirs(OUT, exist_ok=True)
S = 800
def canvas():
    im = Image.new('RGB', (S, S), (255, 255, 255)); return im, ImageDraw.Draw(im)
G, G2, G3 = (205, 208, 212), (178, 182, 188), (230, 232, 235)
def tint(c, t): return tuple(int(a * 0.7 + b * 0.3) for a, b in zip(c, t))
def roll(d, c=G):  # 卷纸
    for i, x in enumerate((230, 400, 570)):
        d.rounded_rectangle((x - 75, 260, x + 75, 560), 30, fill=c); d.ellipse((x - 75, 230, x + 75, 290), fill=G3, outline=G2, width=4); d.ellipse((x - 22, 248, x + 22, 272), fill=G2)
def box(d, c=G):  # 盒装
    d.polygon([(200, 300), (400, 220), (600, 300), (400, 380)], fill=G3); d.polygon([(200, 300), (400, 380), (400, 620), (200, 540)], fill=c); d.polygon([(400, 380), (600, 300), (600, 540), (400, 620)], fill=G2)
def carton(d, c=G):  # 牛奶盒
    for x in (260, 420):
        d.rectangle((x, 300, x + 130, 600), fill=c); d.polygon([(x, 300), (x + 65, 230), (x + 130, 300)], fill=G2); d.rectangle((x + 50, 205, x + 80, 235), fill=G2)
def fruit(d, c=G):
    for (x, y, r) in ((330, 430, 140), (480, 470, 120)):
        d.ellipse((x - r, y - r, x + r, y + r), fill=c); d.line((x, y - r, x + 10, y - r - 40), fill=G2, width=10); d.ellipse((x + 10, y - r - 50, x + 70, y - r - 20), fill=G3)
def shrimp(d, c=G):
    d.rounded_rectangle((200, 260, 600, 560), 40, fill=G3, outline=G2, width=6)
    for i in range(3): d.arc((250 + i * 100, 330, 370 + i * 100, 470), 30, 300, fill=c, width=26)
def pot(d, c=G):
    d.rounded_rectangle((230, 300, 570, 600), 60, fill=c); d.ellipse((230, 260, 570, 340), fill=G2); d.rounded_rectangle((360, 220, 440, 270), 15, fill=G2); d.ellipse((370, 420, 430, 480), fill=G3)
def kettle(d, c=G):
    d.polygon([(280, 600), (520, 600), (490, 300), (310, 300)], fill=c); d.arc((440, 320, 600, 520), 270, 90, fill=G2, width=26); d.polygon([(310, 330), (230, 280), (240, 260), (320, 300)], fill=G2); d.rectangle((260, 600, 540, 630), fill=G2)
def fryer(d, c=G):
    d.rounded_rectangle((250, 230, 550, 610), 90, fill=c); d.rounded_rectangle((290, 420, 510, 580), 30, fill=G2); d.ellipse((370, 280, 430, 340), fill=G3)
def shirt(d, c=G):
    d.polygon([(300, 220), (500, 220), (620, 300), (570, 380), (520, 350), (520, 620), (280, 620), (280, 350), (230, 380), (180, 300)], fill=c); d.polygon([(360, 220), (400, 280), (440, 220)], fill=(255, 255, 255))
def bottle(d, c=G):
    d.rounded_rectangle((320, 300, 480, 620), 40, fill=c); d.rectangle((365, 230, 435, 300), fill=G2); d.rectangle((350, 200, 450, 235), fill=G2)
def tube(d, c=G):
    for i in range(3): y = 300 + i * 90; d.polygon([(220, y), (540, y), (560, y + 30), (540, y + 60), (220, y + 60)], fill=c if i % 2 == 0 else G2); d.rectangle((560, y + 18, 590, y + 42), fill=G2)
def nuts(d, c=G):
    d.rounded_rectangle((230, 240, 570, 620), 30, fill=G3, outline=G2, width=6)
    for (x, y) in ((320, 360), (450, 340), (380, 470), (500, 480), (300, 530)): d.ellipse((x - 45, y - 32, x + 45, y + 32), fill=c)
def chips(d, c=G):
    d.polygon([(260, 220), (540, 220), (520, 620), (280, 620)], fill=c); d.rectangle((260, 220, 540, 250), fill=G2); d.rectangle((280, 590, 520, 620), fill=G2); d.ellipse((350, 360, 450, 460), fill=G3)
def shoe(d, c=G):
    d.polygon([(180, 520), (260, 360), (380, 380), (470, 470), (620, 500), (630, 580), (180, 580)], fill=c); d.rectangle((180, 580, 630, 610), fill=G2)
def mouse(d, c=G):
    d.ellipse((310, 220, 490, 600), fill=c); d.line((400, 220, 400, 360), fill=(255, 255, 255), width=8); d.rounded_rectangle((388, 280, 412, 330), 10, fill=G2)
def keyboard(d, c=G):
    d.rounded_rectangle((140, 320, 660, 520), 24, fill=c)
    for r in range(3):
        for k in range(10): d.rounded_rectangle((165 + k * 49, 345 + r * 55, 205 + k * 49, 385 + r * 55), 6, fill=G3)
def bag(d, c=G):  # 双肩包
    d.rounded_rectangle((260, 250, 540, 620), 70, fill=c); d.rounded_rectangle((300, 430, 500, 560), 24, fill=G2); d.arc((330, 180, 470, 300), 180, 360, fill=G2, width=18)
def cable(d, c=G):  # 数据线
    d.arc((220, 260, 580, 600), 200, 520, fill=c, width=22); d.rounded_rectangle((180, 380, 250, 470), 12, fill=G2); d.rounded_rectangle((550, 380, 620, 470), 12, fill=G2)
def wok(d, c=G):  # 炒锅
    d.ellipse((170, 330, 530, 560), fill=c); d.ellipse((190, 340, 510, 470), fill=G2); d.rounded_rectangle((520, 410, 680, 450), 18, fill=G2)
def pen(d, c=G):  # 中性笔
    for i, x in enumerate((300, 400, 500)):
        d.rounded_rectangle((x - 22, 220, x + 22, 560), 18, fill=c if i != 1 else G2); d.polygon([(x - 22, 560), (x + 22, 560), (x, 620)], fill=G2); d.rectangle((x + 22, 240, x + 32, 360), fill=G2)
def jar(d, c=G):  # 面霜
    d.rounded_rectangle((250, 360, 550, 580), 40, fill=c); d.rounded_rectangle((240, 300, 560, 370), 20, fill=G2)
def bowl(d, c=G):  # 碗
    d.pieslice((200, 220, 600, 620), 0, 180, fill=c); d.rectangle((200, 410, 600, 425), fill=G2); d.rounded_rectangle((330, 610, 470, 640), 10, fill=G2)
def earbuds(d, c=G):  # 耳机
    d.rounded_rectangle((260, 360, 540, 580), 60, fill=G3, outline=G2, width=6)
    for x in (340, 460): d.ellipse((x - 45, 250, x + 45, 340), fill=c); d.rounded_rectangle((x - 14, 320, x + 14, 420), 10, fill=c)
def powerbank(d, c=G):  # 充电宝
    d.rounded_rectangle((280, 200, 520, 620), 40, fill=c); d.rounded_rectangle((370, 230, 430, 250), 8, fill=G2)
    for i in range(4): d.ellipse((330 + i * 40, 540, 350 + i * 40, 560), fill=G3)
def case(d, c=G):  # 手机壳
    d.rounded_rectangle((290, 180, 510, 640), 50, fill=c); d.rounded_rectangle((320, 210, 400, 330), 24, fill=G2); d.ellipse((340, 230, 380, 270), fill=G3); d.ellipse((340, 280, 380, 320), fill=G3)
def sdcard(d, c=G):  # 存储卡
    d.polygon([(300, 220), (460, 220), (520, 280), (520, 600), (300, 600)], fill=c)
    for i in range(5): d.rectangle((320 + i * 34, 240, 340 + i * 34, 300), fill=G2)
def speaker(d, c=G):  # 蓝牙音箱
    d.rounded_rectangle((200, 300, 600, 560), 120, fill=c); d.ellipse((260, 350, 420, 510), fill=G2); d.ellipse((440, 380, 540, 480), fill=G2)
def router(d, c=G):  # 路由器
    d.rounded_rectangle((180, 440, 620, 560), 30, fill=c)
    for x in (240, 340, 460, 560): d.rounded_rectangle((x - 12, 230, x + 12, 450), 10, fill=G2)
    for i in range(4): d.ellipse((240 + i * 40, 490, 260 + i * 40, 510), fill=G3)
def hdd(d, c=G):  # 移动硬盘
    d.rounded_rectangle((260, 220, 540, 600), 36, fill=c); d.ellipse((370, 520, 430, 560), fill=G2); d.rectangle((300, 260, 500, 270), fill=G3)
def veg(d, c=G):  # 蔬菜
    for (x, y, r) in ((320, 420, 120), (470, 430, 110), (400, 330, 110)): d.ellipse((x - r, y - r, x + r, y + r), fill=c)
    d.rounded_rectangle((370, 450, 430, 620), 20, fill=G2)
def egg(d, c=G):  # 鸡蛋
    d.rounded_rectangle((180, 470, 620, 600), 30, fill=G2)
    for x in (260, 360, 460, 560): d.ellipse((x - 48, 330, x + 48, 490), fill=c)
def phone(d, c=G):  # 手机整机
    d.rounded_rectangle((290, 170, 510, 640), 40, fill=c); d.rounded_rectangle((310, 210, 490, 590), 16, fill=G3); d.rounded_rectangle((370, 185, 430, 197), 6, fill=G2)
def printer(d, c=G):  # 打印机
    d.rectangle((300, 200, 500, 320), fill=G3, outline=G2, width=4); d.rounded_rectangle((200, 300, 600, 520), 30, fill=c); d.rectangle((290, 480, 510, 620), fill=G3, outline=G2, width=4)
def rice(d, c=G):  # 大米(预包装)
    d.polygon([(250, 260), (550, 260), (580, 620), (220, 620)], fill=c); d.rectangle((250, 230, 550, 270), fill=G2); d.ellipse((340, 380, 460, 500), fill=G3)
SHAPES = {'case': case, 'sdcard': sdcard, 'speaker': speaker, 'router': router, 'hdd': hdd, 'veg': veg, 'egg': egg, 'phone': phone, 'printer': printer, 'rice': rice, 'roll': roll, 'box': box, 'carton': carton, 'fruit': fruit, 'shrimp': shrimp, 'pot': pot, 'kettle': kettle, 'fryer': fryer, 'shirt': shirt, 'bottle': bottle, 'tube': tube, 'nuts': nuts, 'chips': chips, 'shoe': shoe, 'mouse': mouse, 'keyboard': keyboard, 'bag': bag, 'cable': cable, 'wok': wok, 'pen': pen, 'jar': jar, 'bowl': bowl, 'earbuds': earbuds, 'powerbank': powerbank}
VARIANTS = {'shirt-blue': ('shirt', tint(G, (120, 160, 210))), 'carton-2': ('carton', tint(G, (220, 210, 170))), 'bag-grey': ('bag', tint(G, (120, 125, 135))), 'mango': ('fruit', tint(G, (230, 190, 90))), 'case-blue': ('case', tint(G, (120, 160, 210)))}
for n, f in SHAPES.items():
    im, d = canvas(); f(d); im.save(os.path.join(OUT, n + '.png'), optimize=True)
for n, (s, c) in VARIANTS.items():
    im, d = canvas(); SHAPES[s](d, c); im.save(os.path.join(OUT, n + '.png'), optimize=True)
print('ok', len(SHAPES) + len(VARIANTS))
