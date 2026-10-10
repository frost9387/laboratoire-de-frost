"""Relit les exports du moteur avec Pillow (décodeur indépendant) et vérifie DPI, mode et profil ICC.

Usage : python -I tests/verify_exports.py <dossier-de-sortie>
"""
import io
import sys
import zipfile
from pathlib import Path

from PIL import Image, ImageCms

sys.stdout.reconfigure(encoding="utf-8")
folder = Path(sys.argv[1])
failures = 0


def check(cond, msg):
    global failures
    print(("  ✓ " if cond else "  ✗ ") + msg)
    if not cond:
        failures += 1


def inspect(name, data):
    if name.endswith(".svg"):
        txt = data.decode("utf-8")
        check(txt.startswith("<?xml") and txt.rstrip().endswith("</svg>"), f"{name} : SVG bien formé ({txt.count('<path')} chemins)")
        return
    if not name.lower().endswith((".tif", ".png", ".jpg")):
        return
    im = Image.open(io.BytesIO(data))
    im.load()
    dpi = im.info.get("dpi")
    icc = im.info.get("icc_profile")
    desc = ""
    if icc:
        try:
            desc = ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(icc))).strip()
        except Exception as exc:  # profil illisible
            desc = f"ICC illisible ({exc})"
    ink = ""
    if im.mode in ("1", "L"):
        hist = im.convert("L").histogram()
        dark = sum(hist[:128]) / max(1, sum(hist))
        ink = f", encre {dark * 100:.1f} %"
    check(
        dpi is not None and round(float(dpi[0])) > 0,
        f"{name} : {im.format} {im.mode} {im.size[0]}×{im.size[1]} px, {round(float(dpi[0])) if dpi else '?'} dpi"
        + (f", ICC « {desc} »" if icc else ", sans ICC")
        + ink,
    )


for path in sorted(folder.iterdir()):
    data = path.read_bytes()
    if path.suffix == ".zip":
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            bad = z.testzip()
            check(bad is None, f"{path.name} : ZIP valide ({len(z.namelist())} fichiers)")
            for n in z.namelist():
                inspect(n, z.read(n))
    else:
        inspect(path.name, data)

print("\nRelecture OK." if not failures else f"\n{failures} échec(s) de relecture.")
sys.exit(1 if failures else 0)
