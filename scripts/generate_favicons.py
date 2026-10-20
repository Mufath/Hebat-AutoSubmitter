import os
import math
from PIL import Image, ImageDraw, ImageFilter

def generate_icons():
    output_dir = "d:/Mufath/Project/AutoSubmit/ui"
    
    # 1. Write favicon.svg
    svg_content = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0A84FF"/>
      <stop offset="100%" stop-color="#0056D2"/>
    </linearGradient>
    <linearGradient id="glowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#E2F1FF"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-color="#001B44" flood-opacity="0.35"/>
    </filter>
  </defs>

  <!-- App Squircle Base -->
  <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#bgGrad)"/>
  <rect x="2" y="2" width="60" height="60" rx="14" fill="none" stroke="#FFFFFF" stroke-opacity="0.25" stroke-width="1"/>

  <!-- Stopwatch Top Crown -->
  <path d="M28.5 6.5h7a1.5 1.5 0 0 1 1.5 1.5v1h-10v-1a1.5 1.5 0 0 1 1.5-1.5z" fill="#FFFFFF" fill-opacity="0.9"/>
  <rect x="30.5" y="9" width="3" height="3" fill="#FFFFFF" fill-opacity="0.9"/>

  <!-- Precision Stopwatch Outer Dial Arc -->
  <circle cx="32" cy="35" r="18" fill="none" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="86 28"/>

  <!-- Precision Tick Marks -->
  <circle cx="32" cy="19.5" r="1.2" fill="#FFFFFF" fill-opacity="0.9"/>
  <circle cx="47" cy="35" r="1.2" fill="#FFFFFF" fill-opacity="0.9"/>
  <circle cx="17" cy="35" r="1.2" fill="#FFFFFF" fill-opacity="0.9"/>

  <!-- High-Precision Lightning Bolt / Speed Glyph in Center -->
  <path d="M34.5 18 L23.5 35 H32 L28 49 L42.5 32 H34 L37 18 Z" 
        fill="url(#glowGrad)" 
        stroke="#FFFFFF" 
        stroke-width="0.8" 
        stroke-linejoin="round" 
        filter="url(#shadow)"/>
</svg>'''

    svg_path = os.path.join(output_dir, "favicon.svg")
    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(svg_content)
    print("Created:", svg_path)

    # 2. Draw high-resolution (512x512) raster icon using Pillow
    size = 512
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    radius = int(size * 0.22)
    
    # Fast gradient generation
    grad = Image.new("RGBA", (size, size))
    grad_data = []
    for y in range(size):
        for x in range(size):
            t = (x * 0.35 + y * 0.65) / size
            r = int(10 * (1 - t) + 0 * t)
            g = int(132 * (1 - t) + 86 * t)
            b = int(255 * (1 - t) + 210 * t)
            grad_data.append((r, g, b, 255))
    grad.putdata(grad_data)
    
    # Mask squircle
    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle([16, 16, size - 16, size - 16], radius=radius, fill=255)
    
    img = Image.composite(grad, img, mask)
    draw = ImageDraw.Draw(img)
    
    # Inner border
    draw.rounded_rectangle([16, 16, size - 16, size - 16], radius=radius, outline=(255, 255, 255, 60), width=6)
    
    # Stopwatch Crown
    draw.rounded_rectangle([228, 52, 284, 68], radius=6, fill=(255, 255, 255, 230))
    draw.rectangle([244, 68, 268, 92], fill=(255, 255, 255, 230))
    
    # Stopwatch ring
    cx, cy, r = 256, 280, 144
    draw.arc([cx - r, cy - r, cx + r, cy + r], start=-220, end=75, fill=(255, 255, 255, 95), width=18)
    
    # Precision ticks
    draw.ellipse([256 - 8, cy - r - 8, 256 + 8, cy - r + 8], fill=(255, 255, 255, 230))
    draw.ellipse([cx - r - 8, cy - 8, cx - r + 8, cy + 8], fill=(255, 255, 255, 230))
    draw.ellipse([cx + r - 8, cy - 8, cx + r + 8, cy + 8], fill=(255, 255, 255, 230))
    
    # Lightning bolt coordinates scaled by 8
    bolt_coords = [
        (34.5 * 8, 18.0 * 8),
        (23.5 * 8, 35.0 * 8),
        (32.0 * 8, 35.0 * 8),
        (28.0 * 8, 49.0 * 8),
        (42.5 * 8, 32.0 * 8),
        (34.0 * 8, 32.0 * 8),
        (37.0 * 8, 18.0 * 8),
    ]
    
    # Draw drop shadow for bolt
    shadow_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow_img)
    shadow_coords = [(x, y + 10) for x, y in bolt_coords]
    shadow_draw.polygon(shadow_coords, fill=(0, 20, 60, 100))
    shadow_img = shadow_img.filter(ImageFilter.GaussianBlur(10))
    img = Image.alpha_composite(img, shadow_img)
    
    draw = ImageDraw.Draw(img)
    # Draw bolt
    draw.polygon(bolt_coords, fill=(255, 255, 255, 255), outline=(230, 245, 255, 255), width=2)

    # Save sizes
    img.save(os.path.join(output_dir, "icon-512.png"))
    img_192 = img.resize((192, 192), Image.Resampling.LANCZOS)
    img_192.save(os.path.join(output_dir, "icon-192.png"))
    img_180 = img.resize((180, 180), Image.Resampling.LANCZOS)
    img_180.save(os.path.join(output_dir, "apple-touch-icon.png"))
    img.save(os.path.join(output_dir, "favicon.ico"), format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    
    print("Generated all favicon assets in", output_dir)

if __name__ == "__main__":
    generate_icons()
