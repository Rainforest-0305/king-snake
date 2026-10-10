# King Snake (뱀 키우기)

Single-player snake arena game built with TypeScript and Vite. Eat orbs to grow, cut off rival snakes, and unlock skins.

- Play (web build): https://rainforest-0305.github.io/king-snake/
- This branch holds the **source**. The `main` branch holds the built web output served by GitHub Pages.

## Run

```bash
npm install
npm run dev        # local dev server
npm run typecheck
npm run build:web  # web build into dist/
```

## Notes

- **Ads:** the Apps-in-Toss build of this game contains ads (rewarded and interstitial placements under `src/ads`, `src/reward`).
- Production ad placement IDs, promotion codes, and the push template code are replaced with placeholders (`ait.v2.live.XXXXXXXXXXXXXXXX`, `__PROMOTION_CODE__`, `__PUSH_TEMPLATE_CODE__`), so this source does not reproduce the production build as-is.
- Build output (`dist/`), submission bundles (`*.ait`), and internal work logs are not tracked.
