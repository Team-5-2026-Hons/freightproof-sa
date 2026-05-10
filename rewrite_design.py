import re

with open('frontend/DESIGN_SYSTEM.md', 'r') as f:
    content = f.read()

# 1. Rules & Creative North Star
content = re.sub(
    r'\*\*The register:\*\* Industrial authority\. Tight\. Engineered\. No decorative noise\.',
    '**The register:** Industrial authority. Tight. Engineered. Unapologetically brutalist. Zero AI-generated slop aesthetics.',
    content
)

content = re.sub(
    r'- Surface depth via tonal layering, never thin divider lines',
    '- Surface depth via stark, solid offset shadows and thick borders. No blurry glassmorphism.',
    content
)

content = re.sub(
    r'\*\*No-Line Rule:\*\* Never use 1px solid borders to separate sections\. Use background colour shifts between surface tiers instead\.',
    '**Hard-Line Rule:** Use stark 1px or 2px solid `#000000` borders to separate sections. Emphasize the grid. Never rely on subtle background colour shifts alone.',
    content
)

content = re.sub(
    r'\*\*Ghost Border Fallback:\*\* If a border is required for accessibility \(e\.g\. an input field\), use `outline-variant` at 20% opacity maximum\. Never use it decoratively\.',
    '**Solid State Rule:** Zero glassmorphism. No blurs. Floating components (mobile bottom nav, status toasts) use 100% opaque backgrounds with a sharp, hard offset shadow (e.g. `4px 4px 0px #000000`).',
    content
)

content = re.sub(
    r'\*\*Glass Rule:\*\* Floating components \(mobile bottom nav, status toasts\) use `surface` at 80% opacity with `backdrop-blur: 12px`\.',
    '**Anti-Slop Rule:** No generic SaaS gradients. No pill-shaped buttons. UI elements must feel distinct, mechanical, and purposefully jagged.',
    content
)

content = re.sub(
    r'\*\*Signal Rule:\*\* `secondary` \(Signal Blue\)',
    '**Signal Rule:** `secondary` (Signal Orange)',
    content
)

content = re.sub(
    r'\*\*Safety Amber Rule:\*\* Use `tertiary-fixed-dim` for warnings that need to be visible but not alarming \(e\.g\. checkpoint timeout, loading in progress\)\.',
    '**Safety Rule:** Use `tertiary` (Caution Yellow) for warnings that need to be visible but not fatal.',
    content
)

# 2. Colors replace (Text)
content = content.replace('Secondary — Signal Blue', 'Secondary — Signal Orange')
content = content.replace('Tertiary — Safety Amber', 'Tertiary — Caution Yellow')
content = content.replace('Success — Verified Green', 'Success — Phosphor Green')
content = content.replace('Error — Alert Red', 'Error — Emergency Red')

# 3. Colors replace (Hexes in the tables and config)
content = content.replace('#1b1b1c', '#1A1A1A')
content = content.replace('#f4f0f1', '#F4F4F0')
content = content.replace('#0051d5', '#FF4F00')
content = content.replace('#dce1ff', '#FFD2C2')
content = content.replace('#001258', '#4A1700')
content = content.replace('#8a5000', '#E6A800')
content = content.replace('#ffddb4', '#FFEB99')
content = content.replace('#2c1600', '#332500')
content = content.replace('#ffb95f', '#FFC200')
content = content.replace('#006e2c', '#00D640')
content = content.replace('#98f7ab', '#A3FFC2')
content = content.replace('#002109', '#00330F')
content = content.replace('#ba1a1a', '#FF2A00')
content = content.replace('#ffdad6', '#FFC7C2')
content = content.replace('#410002', '#4A0C00')

content = content.replace('#fcf8f9', '#EFEFE9')
content = content.replace('#f6f3f4', '#E4E3DB')
content = content.replace('#f0eded', '#D9D8CF')
content = content.replace('#eae8e8', '#CECDC2')
content = content.replace('#e5e2e3', '#C3C2B6')

content = content.replace('#46464f', '#4D4D4D')
content = content.replace('#777680', '#000000')
content = content.replace('#c7c6ca', '#8A8A85')

# 4. Fonts
content = re.sub(
    r'\*\*Primary — Inter\*\*(.*?)(<link.*?>)',
    '**Primary — Space Grotesk**\nUnapologetically modern, engineered, and sharply geometric. Evokes technical precision and brutalist architecture. Rejects the generic "Inter" SaaS look entirely.\n\n```html\n<!-- Add to layout.tsx head — both surfaces -->\n<link rel="preconnect" href="https://fonts.googleapis.com" />\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />\n```',
    content, flags=re.DOTALL
)

content = re.sub(
    r'\*\*Secondary — JetBrains Mono\*\*(.*?)<link href="https://fonts\.googleapis\.com/css2\?family=JetBrains\+Mono:wght@400;500&display=swap" rel="stylesheet" />',
    '**Secondary — IBM Plex Mono**\nThe ultimate technical monospace. Used exclusively for: trip IDs, seal codes, blockchain hashes, vehicle registration plates, and any identifier that must feel like a stamped industrial part.\n\n<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />',
    content, flags=re.DOTALL
)

content = content.replace('JetBrains Mono', 'IBM Plex Mono')

# 5. Elevation & Depth
content = re.sub(
    r'Depth is achieved \*\*exclusively through tonal layering\*\* — never arbitrary `box-shadow` values\.',
    'Depth is achieved **exclusively through harsh, solid offset shadows** and thick borders. Zero blur.',
    content
)

content = re.sub(
    r'### 5\.1 The Layering Principle(.*?)### 5\.2',
    '### 5.1 The Layering Principle\n\nBorders and shadows define the hierarchy. High contrast separates layers.\n\n```\nPage:    surface (#EFEFE9)\n  └─ Card: surface-container-lowest (#FFFFFF)\n           border: 2px solid #000000\n           box-shadow: 4px 4px 0px #000000\n```\n\n### 5.2',
    content, flags=re.DOTALL
)

content = re.sub(
    r'### 5\.2 Ambient Shadows \(Floating Elements Only\)(.*?)### 5\.3',
    '### 5.2 Solid State Shadows (Floating Elements Only)\n\nReserved for components that must float above the layout: critical alerts, modals, the driver panic button, mobile bottom navigation.\n\n```css\n/* Hard shadow — floating only */\nbox-shadow: 6px 6px 0px #000000;\nborder: 2px solid #000000;\n```\n\n- Colour: `#000000`\n- Blur: 0px\n- Y-offset: 4px or 6px\n- X-offset: 4px or 6px\n\n### 5.3',
    content, flags=re.DOTALL
)

content = re.sub(
    r'### 5\.3 The Signature Gradient \(Dark Surfaces\)(.*?)## 6\. Border Radius',
    '### 5.3 The Flat Standard\n\nNo gradients. Dark surfaces should be entirely flat `primary` or `primary-container`. Gradients are an AI slop cliché. Keep it solid, flat, and bold.\n\n---\n\n## 6. Border Radius',
    content, flags=re.DOTALL
)

# 6. Border Radius
content = re.sub(
    r'\| Token \| Value \| Tailwind \| Usage \|\n\|---\|---\|---\|---\|\n\| `radius-sm` \| 4px \| `rounded` \| Inner elements within cards, chips \|\n\| `radius-md` \| 6px \| `rounded-md` \| Buttons, input fields, badges \|\n\| `radius-lg` \| 8px \| `rounded-lg` \| Cards \(Evidence Packets\), panels \|\n\| `radius-xl` \| 12px \| `rounded-xl` \| Modals, full-screen driver overlays \|',
    '| Token | Value | Tailwind | Usage |\n|---|---|---|---|\n| `radius-none` | 0px | `rounded-none` | Outer cards, panels, layout containers |\n| `radius-sm` | 2px | `rounded-[2px]` | Inner elements, chips, badges |\n| `radius-md` | 4px | `rounded-[4px]` | Buttons, input fields |\n| `radius-lg` | 4px | `rounded-[4px]` | Modals, overlays |',
    content
)
content = content.replace('radius-lg (8px)', 'radius-none (0px)')
content = content.replace('radius-md (6px)', 'radius-md (4px)')
content = content.replace('radius-sm (4px)', 'radius-sm (2px)')
content = content.replace('radius-xl (12px)', 'radius-lg (4px)')
content = content.replace('Never use fully rounded (pill) shapes — this is a rugged logistics tool.', 'Never use fully rounded shapes. Keep it extremely sharp and brutalist. Avoid the generic AI-generated "soft" aesthetic entirely.')

# 7. Components
content = content.replace('- No borders. No dividers.', '- Hard borders (2px solid black). Strict dividers.')
content = content.replace('surface-container-lowest at 80% + backdrop-blur 12px (glass effect)', 'surface-container-lowest at 100% opacity + 2px solid border + hard shadow (4px 4px 0px #000000)')
content = content.replace('Ambient shadow (0 8px 40px rgba(27,27,28,0.06))', 'Hard shadow (4px 4px 0px #000000)')
content = content.replace('gradient(135deg, #000000 → #1A1A1A)', 'primary (#000000) flat color')
content = content.replace('1px outline at 10% opacity (depth, not decoration)', '2px solid outline (#000000) with a 2px offset shadow')
content = content.replace('bottom accent (active): 2px solid secondary', 'Full border: 2px solid secondary')
content = content.replace('No divider lines.', 'Hard 1px or 2px divider lines.')

# 8. Do's and Don'ts
content = content.replace('**Don\'t** use 1px solid borders to separate sections — use tonal surface shifts', '**Don\'t** rely on soft tonal surface shifts without borders. Embrace hard lines and structural grids. It must look engineered.')

with open('frontend/DESIGN_SYSTEM.md', 'w') as f:
    f.write(content)
