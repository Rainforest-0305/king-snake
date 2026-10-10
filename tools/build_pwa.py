#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_pwa.py - assemble the GitHub Pages / Microsoft Store PWA deploy folder
for King Snake.

Ported from territory-clash/store/build_pwa.py. The main structural
difference: King Snake keeps manifest.json / sw.js / privacy.html / icons/ as
static sources under public/, so Vite's own public/** passthrough already
copies them into dist/ on `npm run build:web`. This script therefore
VALIDATES their presence in dist/ (fail-closed) instead of copying them in
from a separate store/icons/ folder like the precedent did.

Run AFTER `npm run build:web` (and after `python tools/make_icons.py` at
least once, since that populates public/icons/ which Vite then copies):

    python tools/build_pwa.py

Inputs
    <proj>/dist/               Vite output of `npm run build:web` ONLY.
    <proj>/store/screenshots/  optional; Store listing needs >= 1 to actually
                                submit, but this script does not hard-fail on
                                zero - it warns, same as the precedent.

Output
    <proj>/store/pwa/          wiped and rebuilt on every run

Why sw.js is templated, not hand-written
    Vite emits content-hashed filenames (assets/index-XXXXXXXX.js). A
    hand-maintained PRECACHE list would silently rot the moment a rebuild
    changes a hash, shipping an offline mode that 404s on its own bundle.
    public/sw.js therefore ships two literal placeholder tokens,
    __CACHE_NAME__ and __PRECACHE_LIST__; this script rewrites ONLY the
    copy in store/pwa/sw.js, substituting a content hash and the real file
    list. The source template under public/ is never touched.

Determinism
    Every directory scan is sorted, every text file is written UTF-8 with LF
    newlines, and the cache version is a content hash. Two runs over identical
    input produce byte-identical output.

Standard library only. Python 3.8+.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

# --------------------------------------------------------------------------
# Paths - derived from this script's own location so the tree can be moved.
# --------------------------------------------------------------------------
TOOLS_DIR = Path(__file__).resolve().parent
PROJ_DIR = TOOLS_DIR.parent
STORE_DIR = PROJ_DIR / "store"

# The ONLY accepted input, same reasoning as the territory-clash precedent:
# `npm run build:web` runs plain `vite build` with no Toss/ait mode switch,
# so there is only one build output for this project (no dist/web split).
# Still validated explicitly so a missing/interrupted build fails loudly
# instead of silently packaging stale or partial files.
DIST_DIR = PROJ_DIR / "dist"

SHOTS_SRC = STORE_DIR / "screenshots"
OUT_DIR = STORE_DIR / "pwa"

APP_NAME = "King Snake"
APP_SHORT_NAME = "King Snake"
THEME_COLOR = "#05060e"
CACHE_PREFIX = "king-snake-v1-"

# 11 "any" + 3 maskable (required for manifest.json / PWABuilder / the Store)
# + icon-600 (앱스인토스 콘솔 앱 로고 규격 - not in manifest, console upload only,
# but still a required deliverable of this build).
ICON_SIZES = [48, 72, 96, 128, 144, 152, 192, 256, 384, 512, 1024]
MASKABLE_SIZES = [192, 512, 1024]
REQUIRED_ICONS = (
    [f"icon-{s}.png" for s in ICON_SIZES]
    + [f"maskable-{s}.png" for s in MASKABLE_SIZES]
    + ["icon-600.png"]
)

# Files that must already exist in dist/ courtesy of Vite's public/**
# passthrough (public/manifest.json, public/sw.js, public/privacy.html,
# public/icons/*). If any are missing the source public/ tree is broken or
# `npm run build:web` was not run after adding them - fail closed rather than
# silently shipping a PWA build with no manifest or no offline support.
REQUIRED_DIST_FILES = (
    ["manifest.json", "sw.js", "privacy.html"]
    + [f"icons/{name}" for name in REQUIRED_ICONS]
)

# Never copied into the deploy folder at all (sourcemaps are off in
# vite.config.ts already, but excluded here too as a second line of defense -
# a sourcemap would publish readable source on a public Pages site).
DEPLOY_EXCLUDE_SUFFIXES = {".map"}

# Kept in the folder and in manifest.json (PWABuilder and the Store listing
# need them) but deliberately NOT precached: the runtime never renders these,
# and together they are a meaningful slice of what would otherwise be the
# offline payload. They stay fetchable on demand via the cache-first handler.
PRECACHE_EXCLUDE = {
    "icons/icon-1024.png",
    "icons/maskable-1024.png",
    "icons/icon-600.png",  # AIT console asset only, never referenced at runtime
}

# 스크린샷은 «스토어 리스팅 자산»이지 앱 자산이 아니다.
# 배포는 하되(PWABuilder / manifest 가 참조한다) 프리캐시에는 절대 넣지 않는다.
# 넣었더니 서비스워커 설치 시 내려받는 양이 0.54MB -> 6.98MB 로 뛰었다(실측).
# 첫 실행에서 7MB 를 받게 만드는 것은 그 자체로 품질 결함이다.
PRECACHE_EXCLUDE_PREFIXES = ("screenshots/",)


def _precache_ok(rel: str) -> bool:
    """프리캐시에 넣을 파일인가. 배포 여부와는 «다른» 판단이다."""
    if rel in PRECACHE_EXCLUDE:
        return False
    return not rel.startswith(PRECACHE_EXCLUDE_PREFIXES)

LANGUAGES = ["de", "en", "es", "fr", "ja", "ko", "pt-BR", "ru", "zh-Hans"]

SW_TOKEN_CACHE = "__CACHE_NAME__"
SW_TOKEN_PRECACHE = "__PRECACHE_LIST__"


class BuildError(Exception):
    """A fatal, user-actionable problem. Never leaves a half-built folder."""


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def copy_tree(src: Path, dst: Path) -> int:
    """Copy src/** into dst/**, skipping excluded suffixes. Returns count."""
    count = 0
    for path in sorted(src.rglob("*"), key=lambda p: p.as_posix()):
        if not path.is_file():
            continue
        rel = path.relative_to(src)
        if path.suffix.lower() in DEPLOY_EXCLUDE_SUFFIXES:
            continue
        target = dst / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
        count += 1
    return count


def deployed_files() -> list[Path]:
    """All files currently in OUT_DIR, as sorted relative paths."""
    return sorted(
        (p.relative_to(OUT_DIR) for p in OUT_DIR.rglob("*") if p.is_file()),
        key=lambda p: p.as_posix(),
    )


def png_size(path: Path) -> tuple[int, int]:
    """Read (width, height) straight out of the PNG IHDR header."""
    with path.open("rb") as fh:
        header = fh.read(24)
    if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n":
        raise BuildError(f"Not a valid PNG (bad header): {path}")
    if header[12:16] != b"IHDR":
        raise BuildError(f"Not a valid PNG (IHDR missing): {path}")
    width = int.from_bytes(header[16:20], "big")
    height = int.from_bytes(header[20:24], "big")
    if width == 0 or height == 0:
        raise BuildError(f"PNG reports zero dimensions: {path}")
    return width, height


def write_text(path: Path, text: str) -> None:
    """UTF-8, LF newlines - byte-identical on Windows and Linux."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def label_from_stem(stem: str) -> str:
    words = re.split(r"[-_]+", stem)
    return f"{APP_NAME} - " + " ".join(w for w in words if w)


# --------------------------------------------------------------------------
# 1. validate
# --------------------------------------------------------------------------
def resolve_dist() -> Path:
    if (DIST_DIR / "index.html").is_file():
        return DIST_DIR
    if DIST_DIR.is_dir():
        raise BuildError(
            f"{DIST_DIR} exists but has no index.html - the build looks "
            f"incomplete or interrupted.\n"
            f"  Re-run the web build:\n"
            f"      cd {PROJ_DIR}\n"
            f"      npm run build:web"
        )
    raise BuildError(
        f"Vite build output not found: {DIST_DIR}\n"
        f"  Run the web build first:\n"
        f"      cd {PROJ_DIR}\n"
        f"      npm run build:web"
    )


def validate_required_dist_files(dist: Path) -> None:
    """Fail-closed check that Vite's public/** passthrough actually ran.

    icons/, manifest.json, sw.js and privacy.html all live under public/ in
    this project and are never generated by this script - if any is missing
    from dist/, either public/ is incomplete (e.g. icons never generated with
    tools/make_icons.py) or something intercepted the Vite copy step.
    """
    missing = [name for name in REQUIRED_DIST_FILES if not (dist / name).is_file()]
    if missing:
        raise BuildError(
            f"{len(missing)} of {len(REQUIRED_DIST_FILES)} required PWA files "
            f"missing from {dist} (expected via Vite's public/** passthrough):\n    "
            + "\n    ".join(missing)
            + "\n\n  Most likely cause: public/icons/*.png were never generated, "
            "or the web build ran before they existed.\n"
            f"  Fix:\n"
            f"      cd {PROJ_DIR}\n"
            f"      python tools/make_icons.py\n"
            f"      npm run build:web"
        )


def validate() -> Path:
    dist = resolve_dist()
    validate_required_dist_files(dist)
    return dist


# --------------------------------------------------------------------------
# 2. manifest.json - inject screenshots (the only part not static in public/)
# --------------------------------------------------------------------------
def inject_manifest_screenshots() -> int:
    """Adds a "screenshots" array to the deployed manifest.json, discovered
    from store/screenshots/*.png at build time (Store listing images are not
    checked into public/ - they are store-submission assets, not app assets).

    Returns the screenshot count. Leaves manifest.json untouched (no key) if
    none are found, same graceful-degradation behaviour as the precedent.
    """
    manifest_path = OUT_DIR / "manifest.json"
    manifest = json.loads(read_text(manifest_path))

    # BUG FIX (2026-08-18): 원래는 manifest 에 screenshots 키가 «이미 있으면»
    #   여기서 곧장 return 했다. 그런데 그 분기는 «파일 복사»까지 같이 건너뛴다.
    #   결과: 손으로 작성한 manifest 가 screenshots/*.png 를 가리키는데 그 파일이
    #   배포본에 «없는» 상태가 나온다(실측: 참조 8건이 전부 404 될 뻔했다).
    #   복사와 주입은 «다른 일»이다. 복사는 항상 하고, 주입만 건너뛴다.
    had_manifest_shots = "screenshots" in manifest

    shots = []
    if SHOTS_SRC.is_dir():
        n_copied = copy_tree(SHOTS_SRC, OUT_DIR / "screenshots")
        for png in sorted(SHOTS_SRC.glob("*.png"), key=lambda p: p.name):
            width, height = png_size(png)
            shots.append(
                {
                    "src": f"screenshots/{png.name}",
                    "sizes": f"{width}x{height}",
                    "type": "image/png",
                    "form_factor": "wide" if width >= height else "narrow",
                    "label": label_from_stem(png.stem),
                }
            )
        _ = n_copied  # counted via shots below; kept for clarity only

    if had_manifest_shots:
        # 손으로 쓴 라벨/순서를 존중한다. 파일은 위에서 이미 복사됐다.
        return len(manifest["screenshots"])

    if shots:
        manifest["screenshots"] = shots
        write_text(
            manifest_path, json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
        )
    else:
        print(
            "WARNING: no screenshots found at\n"
            f"           {SHOTS_SRC}\n"
            "         manifest.json ships without a 'screenshots' key.\n"
            "         The Microsoft Store listing requires AT LEAST ONE\n"
            "         screenshot - add PNGs there and re-run this script\n"
            "         before submitting."
        )

    return len(shots)


# --------------------------------------------------------------------------
# 3. wire index.html (idempotent - our index.html already ships every tag)
# --------------------------------------------------------------------------
HEAD_TAGS = [
    # (idempotency probe -> regex, tag to inject if missing)
    (r'rel=["\']manifest["\']', '<link rel="manifest" href="./manifest.json" />'),
    (
        r'rel=["\']icon["\'][^>]*icons/icon-192\.png',
        '<link rel="icon" type="image/png" sizes="192x192" href="./icons/icon-192.png" />',
    ),
    (
        r'rel=["\']icon["\'][^>]*icons/icon-512\.png',
        '<link rel="icon" type="image/png" sizes="512x512" href="./icons/icon-512.png" />',
    ),
    (
        r'rel=["\']apple-touch-icon["\']',
        '<link rel="apple-touch-icon" href="./icons/icon-192.png" />',
    ),
    (
        r'name=["\']application-name["\']',
        f'<meta name="application-name" content="{APP_NAME}" />',
    ),
    (
        r'name=["\']theme-color["\']',
        f'<meta name="theme-color" content="{THEME_COLOR}" />',
    ),
]

SW_PROBE = re.compile(r"serviceWorker\s*\.\s*register", re.IGNORECASE)

SW_SNIPPET = """    <script>
      // Injected by tools/build_pwa.py - offline support for the PWA build.
      if ("serviceWorker" in navigator) {
        window.addEventListener("load", function () {
          navigator.serviceWorker.register("./sw.js").catch(function (err) {
            console.warn("[pwa] service worker registration failed:", err);
          });
        });
      }
    </script>
"""


def wire_index_html() -> list[str]:
    """Idempotently inject PWA head tags + SW registration if missing.

    index.html for King Snake already ships manifest link, icon links,
    apple-touch-icon, theme-color and an SW registration script (see the
    project's own index.html) - so on a normal run this probes clean and
    returns an empty list. Kept anyway so a future edit that strips one of
    those tags is self-healing rather than a silent regression.
    """
    path = OUT_DIR / "index.html"
    html = read_text(path)
    added: list[str] = []

    missing_tags = [tag for probe, tag in HEAD_TAGS if not re.search(probe, html)]
    if missing_tags:
        block = "".join(f"    {tag}\n" for tag in missing_tags)
        match = re.search(r"[ \t]*</head>", html, re.IGNORECASE)
        if not match:
            raise BuildError(f"No </head> found in {path} - cannot wire the PWA tags.")
        html = html[: match.start()] + block + html[match.start() :]
        added.extend(missing_tags)

    if not SW_PROBE.search(html):
        match = re.search(r"[ \t]*</body>", html, re.IGNORECASE)
        if not match:
            raise BuildError(f"No </body> found in {path} - cannot register the SW.")
        html = html[: match.start()] + SW_SNIPPET + html[match.start() :]
        added.append("service worker registration")

    if added:
        write_text(path, html)
    return added


# --------------------------------------------------------------------------
# 4. sw.js - substitute __CACHE_NAME__ / __PRECACHE_LIST__
# --------------------------------------------------------------------------
def build_sw() -> tuple[str, int, int, int]:
    """Rewrites the deployed sw.js in place.

    Returns (cache version, precache entry count, precached bytes,
    total deployed bytes).

    Must run AFTER inject_manifest_screenshots() and wire_index_html() so the
    hash covers their final bytes - otherwise a manifest or index.html edit
    would not bump the cache version and a redeploy could be masked by a
    stale cached page.
    """
    sw_path = OUT_DIR / "sw.js"
    template = read_text(sw_path)

    # Matched as whole statements, not a blind whole-file string replace:
    # public/sw.js's own header comment explains these tokens by NAME (so a
    # future reader knows what they mean), which means the literal token
    # strings also appear inside prose. A naive template.replace(token, ...)
    # would corrupt that prose too. Anchoring to the exact `const X = ...;`
    # declaration lines leaves the comment text untouched.
    cache_stmt_re = re.compile(
        r"^const CACHE = '" + re.escape(SW_TOKEN_CACHE) + r"';$", re.MULTILINE
    )
    precache_stmt_re = re.compile(
        r"^const PRECACHE = " + re.escape(SW_TOKEN_PRECACHE) + r";$", re.MULTILINE
    )
    if not cache_stmt_re.search(template) or not precache_stmt_re.search(template):
        raise BuildError(
            f"{sw_path} is missing the `const CACHE = '{SW_TOKEN_CACHE}';` / "
            f"`const PRECACHE = {SW_TOKEN_PRECACHE};` placeholder statements - "
            "has public/sw.js been hand-edited? Restore the template tokens "
            "there; this script only rewrites the copy in store/pwa/, never "
            "the public/ source."
        )

    files = [rel for rel in deployed_files() if rel.as_posix() != "sw.js"]

    # The hash covers every deployed file, including the ones left out of
    # PRECACHE - swapping a 1024px icon is still a content change and should
    # still invalidate the cache.
    digest = hashlib.sha256()
    for rel in files:
        digest.update(rel.as_posix().encode("utf-8"))
        digest.update(b"\x00")
        digest.update((OUT_DIR / rel).read_bytes())
        digest.update(b"\x00")
    cache = CACHE_PREFIX + digest.hexdigest()[:8]

    entries = ["./"] + [
        f"./{rel.as_posix()}" for rel in files if _precache_ok(rel.as_posix())
    ]
    precache_json = json.dumps(entries, indent=2)

    out = cache_stmt_re.sub(lambda _m: f"const CACHE = '{cache}';", template)
    out = precache_stmt_re.sub(lambda _m: f"const PRECACHE = {precache_json};", out)
    write_text(sw_path, out)

    precached_bytes = sum(
        (OUT_DIR / rel).stat().st_size
        for rel in files
        if _precache_ok(rel.as_posix())
    )
    total_bytes = sum((OUT_DIR / rel).stat().st_size for rel in files)
    return cache, len(entries), precached_bytes, total_bytes


# --------------------------------------------------------------------------
# 5. .nojekyll + README.md
# --------------------------------------------------------------------------
README = """# {app} - PWA deploy folder

GENERATED by `tools/build_pwa.py`. Do not hand-edit anything in this folder -
it is wiped and rebuilt on every run. Change public/ or the script instead.

## The game

Single-player snake arena against 28 AI rivals. Eat orbs to grow, cut off a
rival so it crashes into your coil, hold to boost by burning your own length.
12 unlockable skins, {lang_count} languages.

## Properties

- **Fully offline.** A service worker precaches the entire build on first
  load, so the game runs with no network at all afterwards.
- **No sign-in.** No account, no email, no login of any kind.
- **No data collection.** No analytics, no tracking, no telemetry. Nothing
  leaves the device; progress and settings stay in local storage.

## Languages ({lang_count})

{langs}

## Deploying

Publish this folder as the GitHub Pages root, or point PWABuilder at it to
generate the Microsoft Store MSIX. `.nojekyll` is required for GitHub Pages:
without it Pages runs Jekyll, which can interfere with hashed asset paths.

## Regenerating

```
cd <project root>
python tools/make_icons.py
npm run build:web
python tools/build_pwa.py
```
"""


def build_docs() -> None:
    write_text(OUT_DIR / ".nojekyll", "")
    write_text(
        OUT_DIR / "README.md",
        README.format(
            app=APP_NAME,
            lang_count=len(LANGUAGES),
            langs="\n".join(f"- `{code}`" for code in LANGUAGES),
            proj=PROJ_DIR,
        ),
    )


# --------------------------------------------------------------------------
# 6. safety gate - zero external network references
# --------------------------------------------------------------------------
URL_RE = re.compile(rb"https?://")
HTML_COMMENT_RE = re.compile(rb"<!--.*?-->", re.DOTALL)


def external_url_scan() -> tuple[list[str], int]:
    """Scans every deployed file for http:// / https:// references.

    privacy.html is scanned with its HTML comments stripped first, since an
    explanatory comment (not an active request) is not a network reference -
    this is the one documented exception. mailto: links do not match this
    regex at all (different scheme), so they need no special-casing.

    Returns (hit descriptions, files scanned). Does NOT delete the output on
    a hit - unlike a leaked ad SDK this is a text match that may need human
    judgement to resolve, so the folder is left in place for inspection.
    """
    hits: list[str] = []
    scanned = deployed_files()

    for rel in scanned:
        path = OUT_DIR / rel
        blob = path.read_bytes()
        if rel.as_posix() == "privacy.html":
            blob = HTML_COMMENT_RE.sub(b"", blob)
        matches = URL_RE.findall(blob)
        if matches:
            hits.append(f"{rel.as_posix()}: {len(matches)} occurrence(s)")

    return hits, len(scanned)


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
def main() -> int:
    try:
        dist = validate()

        if OUT_DIR.exists():
            shutil.rmtree(OUT_DIR)
        OUT_DIR.mkdir(parents=True)
        n_web = copy_tree(dist, OUT_DIR)

        n_shots = inject_manifest_screenshots()
        added = wire_index_html()
        cache, n_precache, precached_bytes, total_bytes = build_sw()
        build_docs()

        url_hits, n_scanned = external_url_scan()
        if url_hits:
            raise BuildError(
                "EXTERNAL NETWORK REFERENCE(S) FOUND - fix before submitting:\n    "
                + "\n    ".join(url_hits)
                + "\n\n  The Store / privacy declaration for this app states zero "
                "network requests. Any http(s):// reference in the shipped bytes "
                "makes that declaration false. store/pwa/ was left in place so "
                "you can inspect the hit(s) above."
            )

    except BuildError as exc:
        print(f"\nERROR: {exc}\n", file=sys.stderr)
        return 1

    print("")
    print(f"  PWA build complete")
    mb = lambda n: f"{n / 1048576:.2f} MB"
    print(f"    output         : {OUT_DIR}")
    print(f"    cache version  : {cache}")
    print(f"    precache       : {n_precache} entries, {mb(precached_bytes)}")
    print(
        f"    deployed       : {mb(total_bytes)} "
        f"(excluded from precache: {mb(total_bytes - precached_bytes)})"
    )
    print(f"    screenshots    : {n_shots}")
    print(f"    source build   : {dist}  ({n_web} files)")
    if added:
        print(f"    index.html     : injected {len(added)} item(s)")
        for item in added:
            print(f"                     + {item}")
    else:
        print(f"    index.html     : already wired (nothing to inject)")
    print(f"    external URLs  : PASS - 0 occurrences in {n_scanned} files")
    print("")
    return 0


if __name__ == "__main__":
    sys.exit(main())
