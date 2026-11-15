# SVG fixtures

`ram.svg` and `rbias_component.svg` come from the local `kuroko2-mock` experiment.
`ram.svg` exercises 72 Office shadow filters, gradients, clipping and vector paths.
`rbias_component.svg` exercises Office text/font requirements and is useful for
manual checks with the original installed fonts. It is not silently substituted
with Linux fonts in the automated browser tests.

`embedded-image.svg` is a synthetic red/blue PNG in PowerPoint's
`defs/image` + clipped/transformed `use` layout. Its valid PNG Base64 happens to
contain `UrL`; CSS URL checks must not remove the image reference. The 16×8 source
PNG uses synthetic pixels; no user image content is included.
