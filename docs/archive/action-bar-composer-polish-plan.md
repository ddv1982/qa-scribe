# Note action bar and composer focus polish

Follow-up to the design consistency plan (v0.8.33), from user screenshots.

- [x] A1. Note action bar: drop the tray chrome (border, fill, shadow, padding) so the bordered buttons are not boxed twice.
- [x] A2. Note action bar: remove the hairline separator before Ask AI.
- [x] A3. Composer: the inner textarea draws no focus halo inside `.chat-compose-box`; only the box shows focus, so no line crosses Attach and Send.
- [x] A4. Verify live (1280 and 640, light and dark) and run `verify:fast`.
- [x] A5. PR through review and CI, merged.
- [ ] A6. Release v0.8.34 published.
