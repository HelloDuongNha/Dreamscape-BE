#!/usr/bin/env python3
"""Fast, layout-free PDF text-layer inspection for OCR routing."""

import json
import sys

import fitz


def main() -> None:
    if len(sys.argv) != 2:
        print(json.dumps({"success": False, "errorCode": "INVALID_ARGUMENTS"}))
        raise SystemExit(1)

    try:
        document = fitz.open(sys.argv[1])
        page_count = len(document)
        page_character_counts = [
            len(page.get_text("text").strip()) for page in document
        ]
        pages_with_text = sum(count > 0 for count in page_character_counts)
        total_characters = sum(page_character_counts)
        text_page_ratio = pages_with_text / page_count if page_count else 0.0
        average_characters_per_page = (
            total_characters / page_count if page_count else 0.0
        )

        if page_count <= 3:
            has_usable_text_layer = (
                total_characters > 200
                and pages_with_text > 0
                and average_characters_per_page >= 60
            )
        else:
            has_usable_text_layer = (
                total_characters > 200
                and text_page_ratio >= 0.80
                and average_characters_per_page >= 100
            )

        print(json.dumps({
            "success": True,
            "pageCount": page_count,
            "pagesWithText": pages_with_text,
            "totalCharacterCount": total_characters,
            "textPageRatio": text_page_ratio,
            "averageCharactersPerPage": average_characters_per_page,
            "hasUsableTextLayer": has_usable_text_layer,
        }))
    except Exception:
        print(json.dumps({"success": False, "errorCode": "PROBE_FAILED"}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
