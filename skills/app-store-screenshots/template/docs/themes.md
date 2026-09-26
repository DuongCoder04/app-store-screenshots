# Themes

Use the **Theme** menu in the toolbar to preview and apply a color system across the entire screenshot deck. Each option shows its background, alternate background, and accent colors before you choose it.

Changing a theme updates every slide immediately and saves the selected theme in `app-store-screenshots.json`. It changes the canvas background, text colors, muted text, accent details, and each slide’s alternate background. It does not change screenshot images, text, layouts, or element placement.

## Included themes

- Five base palettes: **Clean Light**, **Dark Bold**, **Warm Editorial**, **Ocean Fresh**, and **Bloom Roast**.
- One preset per named style in `style-prompts/` (for example **Liquid Glass Aurora**, **Swiss Grid Bold**, **Quiet Japandi**). These are flat palettes for the editor; the style prompt still drives fonts, backgrounds, and decoration.

Themes only set colors. Pick the screenshot typeface separately with the **Font** menu (see `screenshot-fonts.md`), and override a single slide with **Background** in the inspector (see `background-controls.md`).

## Relevant code

- `src/lib/constants.ts` defines the available theme colors.
- `src/components/editor/toolbar.tsx` renders the live theme menu.
- `src/components/editor/slide-canvas.tsx` applies the active theme to the exported and previewed canvas.
