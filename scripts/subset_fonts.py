#!/usr/bin/env python3
"""Subset MiSans for web delivery.

- latin subsets (UI + watermark ASCII text): a few dozen KB per weight
- cjk subsets (watermark custom text): GB2312 hanzi + latin, ~1.2MB per weight

Full MiSans woff2 files are expected in public/fonts/ (not committed); run
this script once after adding them, then remove the full files.
"""
import os
import subprocess
import sys

FONT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "fonts")
WEIGHTS = {
    "Light": "300",
    "Regular": "400",
    "Demibold": "600",
    "Bold": "700",
}

LATIN_RANGES = (
    "U+0020-007E,"      # basic latin
    "U+00A0-00FF,"      # latin-1 (° ×  ÷ etc.)
    "U+0391-03C9,"      # greek (α)
    "U+2000-206F,"      # general punctuation (′ ″ – —)
    "U+20A0-20BF,"      # currency
    "U+2100-214F,"      # letterlike (ℤ)
    "U+2460-24FF,"      # enclosed alphanumerics ①
    "U+3000-3004,"      # cjk punctuation ，。、《》
    "U+FF01-FF65,"      # fullwidth forms
)


def gb2312_unicodes() -> list[str]:
    codes: list[str] = []
    for hi in range(0xB0, 0xF8):
        for lo in range(0xA1, 0xFF):
            try:
                ch = bytes([hi, lo]).decode("gb2312")
                codes.append(f"U+{ord(ch):04X}")
            except UnicodeDecodeError:
                continue
    return codes


def main() -> None:
    cjk_codes = ",".join(gb2312_unicodes())
    for weight_name, _ in WEIGHTS.items():
        src = os.path.join(FONT_DIR, f"MiSans-{weight_name}.woff2")
        if not os.path.exists(src):
            print(f"skip MiSans-{weight_name} (source not found)")
            continue

        latin_out = os.path.join(FONT_DIR, f"MiSans-{weight_name}-latin.woff2")
        subprocess.run(
            [
                "pyftsubset", src,
                f"--output-file={latin_out}",
                "--flavor=woff2",
                f"--unicodes={LATIN_RANGES}",
                "--layout-features=*",
                "--no-hinting",
                "--desubroutinize",
            ],
            check=True,
        )

        if weight_name in ("Regular", "Demibold", "Bold"):
            cjk_out = os.path.join(FONT_DIR, "wm", f"MiSans-{weight_name}-cjk.woff2")
            os.makedirs(os.path.dirname(cjk_out), exist_ok=True)
            subprocess.run(
                [
                    "pyftsubset", src,
                    f"--output-file={cjk_out}",
                    "--flavor=woff2",
                    f"--unicodes={LATIN_RANGES},{cjk_codes}",
                    "--layout-features=*",
                    "--no-hinting",
                    "--desubroutinize",
                ],
                check=True,
            )
        print(f"done MiSans-{weight_name}")


if __name__ == "__main__":
    sys.exit(main())
