# Update the synthetic example screenshot

The SVG is original project-owned source for the fictional checkout in the example.
It contains no customer content. The bundled PNG is 800 by 440 pixels.

To regenerate the PNG with an installed ImageMagick SVG renderer, run from the repository root.

```sh
convert -background none frontend/src/onboarding/assets/example-evidence.svg frontend/src/onboarding/assets/example-evidence.png
```

Inspect the result and run the maintained first-use scenario before replacing the asset.
