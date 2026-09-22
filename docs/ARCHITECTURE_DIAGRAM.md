# Corsiri Architecture Diagram

Primary diagram asset:

- [ARCHITECTURE_DIAGRAM_CHATGPT.png](ARCHITECTURE_DIAGRAM_CHATGPT.png)

Alternate vector version:

- [ARCHITECTURE_DIAGRAM.svg](ARCHITECTURE_DIAGRAM.svg)

Recommended submission placements:

- Image carousel
- File upload
- Code repo

The diagram shows:

- the user input surfaces: selection, image/lasso, voice, and Logitech trigger
- the Windows companion app and UI surfaces
- the Nova backend deployed on AWS (App Runner / ECS)
- the real-browser current-tab execution path through the Chromium extension bridge
- the managed-browser fallback path
- the final output surfaces: result panel, clipboard, insert/replace, and Take Action
