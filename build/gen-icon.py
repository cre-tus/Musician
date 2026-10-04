"""Build the Windows icon from the generated Musician guitar pictogram."""
from PIL import Image

source = Image.open("build/icon.png").convert("RGBA")
width, height = source.size
side = min(width, height)
left = (width - side) // 2
top = (height - side) // 2
source = source.crop((left, top, left + side, top + side))
source.save(
    "build/icon.ico",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print("ICON_OK")
