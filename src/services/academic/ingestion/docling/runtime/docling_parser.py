#!/usr/bin/env python3
import sys
import os
import json
import time
import re
import html as html_mod
import hashlib
import importlib.util
import traceback
import unicodedata

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import EasyOcrOptions, OcrMacOptions, PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption


_VIETOCR_PREDICTOR = None
_VIETOCR_UNAVAILABLE = False
_VIETNAMESE_TONE_MARKS = {"\u0300", "\u0301", "\u0303", "\u0309", "\u0323"}


def _fold_vietnamese_token(value):
    decomposed = unicodedata.normalize("NFD", value or "")
    folded = "".join(char for char in decomposed if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9]+", "", folded.replace("đ", "d").replace("Đ", "D").casefold())


def _has_vietnamese_tone(value):
    return any(char in _VIETNAMESE_TONE_MARKS for char in unicodedata.normalize("NFD", value or ""))


def _split_token_punctuation(value):
    match = re.match(r"^([^\wĐđ]*)(.*?)([^\wĐđ]*)$", value or "", re.UNICODE)
    return match.groups() if match else ("", value or "", "")


def _merge_easyocr_vietocr_text(easy_text, viet_text):
    """
    VietOCR is substantially better at restoring Vietnamese tones, while
    EasyOCR sometimes preserves an already-correct tone that VietOCR changes
    (for example ``vấn`` -> ``văn``). Keep an EasyOCR syllable when it already
    contains a Vietnamese tone and both recognizers agree on its ASCII base;
    otherwise prefer VietOCR's Vietnamese-specific recognition.
    """
    easy_tokens = (easy_text or "").split()
    viet_tokens = (viet_text or "").split()
    if not easy_tokens or len(easy_tokens) != len(viet_tokens):
        return (viet_text or easy_text or "").strip()

    merged = []
    for easy_token, viet_token in zip(easy_tokens, viet_tokens):
        easy_prefix, easy_core, easy_suffix = _split_token_punctuation(easy_token)
        _, viet_core, _ = _split_token_punctuation(viet_token)
        if not viet_core:
            merged.append(easy_token)
            continue

        same_base = _fold_vietnamese_token(easy_core) == _fold_vietnamese_token(viet_core)
        if _has_vietnamese_tone(easy_core) and same_base:
            chosen_core = easy_core
        else:
            chosen_core = viet_core
        merged.append(f"{easy_prefix}{chosen_core}{easy_suffix}")
    return " ".join(merged)


def _looks_like_vietnamese_ocr(results):
    text = " ".join(
        str(result[1])
        for result in results
        if isinstance(result, (list, tuple)) and len(result) >= 2
    )
    if not text:
        return False
    accent_count = len(re.findall(r"[ăâđêôơưà-ỹ]", text, re.IGNORECASE))
    common_words = re.findall(
        r"\b(?:và|của|những|không|được|người|một|này|trong|với|cho|các|"
        r"nhưng|khi|đã|tôi|ông|bà|giấc|mơ)\b",
        text,
        re.IGNORECASE,
    )
    return accent_count >= 3 or len(common_words) >= 2


def _vietocr_config(weights_path):
    return {
        "vocab": (
            "aAàÀảẢãÃáÁạẠăĂằẰẳẲẵẴắẮặẶâÂầẦẩẨẫẪấẤậẬbBcCdDđĐ"
            "eEèÈẻẺẽẼéÉẹẸêÊềỀểỂễỄếẾệỆfFgGhHiIìÌỉỈĩĨíÍịỊjJkKlLmMnN"
            "oOòÒỏỎõÕóÓọỌôÔồỒổỔỗỖốỐộỘơƠờỜởỞỡỠớỚợỢpPqQrRsStT"
            "uUùÙủỦũŨúÚụỤưƯừỪửỬữỮứỨựỰvVwWxXyYỳỲỷỶỹỸýÝỵỴzZ"
            "0123456789!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~ "
        ),
        "device": "cpu",
        "seq_modeling": "transformer",
        "transformer": {
            "d_model": 256,
            "nhead": 8,
            "num_encoder_layers": 6,
            "num_decoder_layers": 6,
            "dim_feedforward": 2048,
            "max_seq_length": 1024,
            "pos_dropout": 0.1,
            "trans_dropout": 0.1,
        },
        "dataset": {
            "image_height": 32,
            "image_min_width": 32,
            "image_max_width": 512,
        },
        "predictor": {"beamsearch": False},
        "weights": weights_path,
        "backbone": "vgg19_bn",
        "cnn": {
            "pretrained": False,
            "ss": [[2, 2], [2, 2], [2, 1], [2, 1], [1, 1]],
            "ks": [[2, 2], [2, 2], [2, 1], [2, 1], [1, 1]],
            "hidden": 256,
        },
        "quiet": True,
    }


def _get_vietocr_predictor():
    global _VIETOCR_PREDICTOR, _VIETOCR_UNAVAILABLE
    if _VIETOCR_PREDICTOR is not None:
        return _VIETOCR_PREDICTOR
    if _VIETOCR_UNAVAILABLE or os.environ.get("VIETOCR_ENABLED", "true").lower() == "false":
        return None
    if importlib.util.find_spec("vietocr") is None:
        _VIETOCR_UNAVAILABLE = True
        return None

    try:
        from vietocr.tool.predictor import Predictor

        runtime_root = os.path.dirname(os.path.dirname(os.path.dirname(sys.executable)))
        default_weights = os.path.join(runtime_root, "models", "vietocr", "vgg_transformer.pth")
        weights_path = os.environ.get("VIETOCR_WEIGHTS_PATH", "").strip()
        if not weights_path:
            weights_path = default_weights if os.path.isfile(default_weights) else (
                "https://vocr.vn/data/vietocr/vgg_transformer.pth"
            )
        _VIETOCR_PREDICTOR = Predictor(_vietocr_config(weights_path))
        return _VIETOCR_PREDICTOR
    except Exception as exc:
        _VIETOCR_UNAVAILABLE = True
        print(f"VietOCR unavailable; retaining EasyOCR text: {exc}", file=sys.stderr)
        return None


def _recognize_vietnamese_lines(image, ordered_results):
    if not _looks_like_vietnamese_ocr(ordered_results):
        return ordered_results
    predictor = _get_vietocr_predictor()
    if predictor is None:
        return ordered_results

    try:
        import numpy as np
        from PIL import Image

        page_image = image if isinstance(image, Image.Image) else Image.fromarray(np.asarray(image))
        page_image = page_image.convert("RGB")
        crops = []
        valid_indexes = []
        for index, result in enumerate(ordered_results):
            if not isinstance(result, (list, tuple)) or len(result) < 3:
                continue
            box = result[0]
            xs = [float(point[0]) for point in box]
            ys = [float(point[1]) for point in box]
            left = max(0, int(min(xs)) - 4)
            top = max(0, int(min(ys)) - 3)
            right = min(page_image.width, int(max(xs)) + 5)
            bottom = min(page_image.height, int(max(ys)) + 4)
            if right - left < 8 or bottom - top < 8:
                continue
            crops.append(page_image.crop((left, top, right, bottom)))
            valid_indexes.append(index)

        if not crops:
            return ordered_results
        predictions, probabilities = predictor.predict_batch(crops, return_prob=True)
        enriched = list(ordered_results)
        for result_index, prediction, probability in zip(valid_indexes, predictions, probabilities):
            original = ordered_results[result_index]
            easy_text = str(original[1]).strip()
            viet_text = str(prediction or "").strip()
            confidence = float(probability or 0.0)
            length_ratio = len(viet_text) / max(1, len(easy_text))
            if not viet_text or confidence < 0.72 or not 0.65 <= length_ratio <= 1.45:
                continue
            merged_text = _merge_easyocr_vietocr_text(easy_text, viet_text)
            enriched[result_index] = (original[0], merged_text, max(float(original[2]), confidence))
        return enriched
    except Exception as exc:
        print(f"VietOCR line recognition failed; retaining EasyOCR text: {exc}", file=sys.stderr)
        return ordered_results


def _sort_easyocr_results_spatially(results):
    """
    EasyOCR can return slightly slanted words after all axis-aligned words.
    Docling then preserves that detector order while composing a paragraph,
    which moves valid words to the end of the paragraph. Reorder detections
    into visual lines before Docling creates TextCell indices.
    """
    if not isinstance(results, list) or len(results) < 2:
        return results

    positioned = []
    unpositioned = []
    for sequence, result in enumerate(results):
        try:
            box = result[0]
            xs = [float(point[0]) for point in box]
            ys = [float(point[1]) for point in box]
            positioned.append({
                "result": result,
                "sequence": sequence,
                "left": min(xs),
                "top": min(ys),
                "right": max(xs),
                "bottom": max(ys),
                "center_y": (min(ys) + max(ys)) / 2,
                "height": max(1.0, max(ys) - min(ys)),
            })
        except (IndexError, TypeError, ValueError):
            unpositioned.append((sequence, result))

    if len(positioned) < 2:
        return results

    lines = []
    for item in sorted(positioned, key=lambda value: (value["center_y"], value["left"], value["sequence"])):
        best_line = None
        best_distance = None
        for line in lines:
            overlap = max(
                0.0,
                min(item["bottom"], line["bottom"]) - max(item["top"], line["top"]),
            )
            min_height = min(item["height"], line["height"])
            center_distance = abs(item["center_y"] - line["center_y"])
            same_visual_line = (
                overlap >= min_height * 0.35
                or center_distance <= max(item["height"], line["height"]) * 0.55
            )
            if same_visual_line and (best_distance is None or center_distance < best_distance):
                best_line = line
                best_distance = center_distance

        if best_line is None:
            lines.append({
                "items": [item],
                "top": item["top"],
                "bottom": item["bottom"],
                "center_y": item["center_y"],
                "height": item["height"],
            })
            continue

        best_line["items"].append(item)
        best_line["top"] = min(best_line["top"], item["top"])
        best_line["bottom"] = max(best_line["bottom"], item["bottom"])
        best_line["center_y"] = sum(value["center_y"] for value in best_line["items"]) / len(best_line["items"])
        best_line["height"] = max(1.0, best_line["bottom"] - best_line["top"])

    ordered = []
    for line in sorted(lines, key=lambda value: value["center_y"]):
        ordered.extend(
            value["result"]
            for value in sorted(line["items"], key=lambda item: (item["left"], item["center_y"], item["sequence"]))
        )
    ordered.extend(result for _, result in sorted(unpositioned))
    return ordered


def _install_easyocr_spatial_order_patch():
    import easyocr

    if getattr(easyocr.Reader.readtext, "_dreamscape_spatial_order", False):
        return
    original_readtext = easyocr.Reader.readtext

    def spatially_ordered_readtext(reader, *args, **kwargs):
        return _sort_easyocr_results_spatially(original_readtext(reader, *args, **kwargs))

    spatially_ordered_readtext._dreamscape_spatial_order = True
    easyocr.Reader.readtext = spatially_ordered_readtext


def _safe_relative(parent_real: str, child_real: str) -> str | None:
    """
    Return the relative path from parent_real to child_real.
    Returns None if child is not strictly inside parent.
    """
    try:
        rel = os.path.relpath(child_real, parent_real)
    except ValueError:
        return None
    # Reject empty, starts with '..', or is absolute
    if not rel or rel.startswith('..') or os.path.isabs(rel):
        return None
    return rel


def _clean_table_text(text: str) -> str:
    """Normalize extraction-only glyph failures without guessing the glyph."""
    cleaned = (text or "").replace("\ufffd", "*").replace("\x03", "*")
    return re.sub(r"\s+", " ", cleaned).strip()


def _is_unlabelled_body_heading(text: str) -> bool:
    clean = (text or "").strip()
    if not clean or len(clean) > 140 or re.search(r"[.!?]\s*$", clean):
        return False
    normalized = re.sub(r"[^a-z0-9]+", " ", clean.lower()).strip()
    known = re.compile(
        r"^(?:limitations?|limitations? of (?:the )?model|discussion|conclusions?|"
        r"results?|methods?|materials and methods|future directions?|summary)$",
        re.IGNORECASE,
    )
    return bool(known.match(normalized))


def _is_back_matter_metadata(text: str) -> bool:
    clean = (text or "").strip()
    if not clean or re.fullmatch(r"[-–—•]+", clean):
        return True
    return bool(re.match(
        r"^(?:conflict of interest(?: statement)?|received\s*:|accepted\s*:|"
        r"published online\s*:|citation\s*:|this article was submitted to\b|"
        r"copyright\b|©|author contributions?\b|funding\b|acknowledg(?:e)?ments?\b|"
        r"data availability\b|ethics statement\b|reviewed by\b|academic editor\b)",
        clean,
        re.IGNORECASE,
    ))


def _serialize_raw_table_cells(tbl) -> list[dict]:
    return [
        {
            "startRow": cell.start_row_offset_idx,
            "endRow": cell.end_row_offset_idx,
            "startColumn": cell.start_col_offset_idx,
            "endColumn": cell.end_col_offset_idx,
            "text": cell.text or "",
            "columnHeader": bool(getattr(cell, "column_header", False)),
            "rowHeader": bool(getattr(cell, "row_header", False)),
        }
        for cell in tbl.data.table_cells
    ]


def _generate_repeated_statistics_table(tbl) -> dict | None:
    """
    Reconstruct statistical tables whose logical leaf schema repeats
    ``N | % | 95% CI``. The CI heading spans two logical data columns: its lower
    and upper bounds remain separate cells exactly as they are in the PDF.
    TableFormer commonly merges adjacent N/% cells or shifts their offsets, so
    sequential logical parsing is safer than trusting unstable coordinates.
    Returns None for every other table so the coordinate-preserving renderer is
    still the general fallback.
    """
    data = tbl.data
    num_rows = max((cell.end_row_offset_idx for cell in data.table_cells), default=0)
    row_cells: dict[int, list] = {r: [] for r in range(num_rows)}
    for cell in data.table_cells:
        row_cells[cell.start_row_offset_idx].append(cell)
    for cells in row_cells.values():
        cells.sort(key=lambda c: c.start_col_offset_idx)

    repeated_leaf = re.compile(r"\bn\s*%\s*95\s*%\s*ci\b", re.IGNORECASE)
    leaf_row = -1
    group_count = 0
    for row, cells in row_cells.items():
        joined = " ".join(_clean_table_text(cell.text) for cell in cells)
        matches = repeated_leaf.findall(joined)
        if len(matches) >= 2:
            leaf_row = row
            group_count = len(matches)
            break
    if leaf_row < 1 or group_count < 2:
        return None

    header_rows = [row_cells[r] for r in range(leaf_row)]
    group_row = header_rows[-1]
    first_header = _clean_table_text(header_rows[0][0].text) if header_rows and header_rows[0] else ""
    group_titles = [_clean_table_text(cell.text) for cell in group_row if cell.start_col_offset_idx > 0]
    if len(group_titles) != group_count:
        return None

    umbrella_text = ""
    has_umbrella = len(header_rows) > 1
    if has_umbrella:
        umbrella_candidates = [
            _clean_table_text(cell.text)
            for cell in header_rows[0]
            if cell.start_col_offset_idx > 0
        ]
        if len(umbrella_candidates) != 1:
            return None
        umbrella_text = umbrella_candidates[0]

    number = r"\d+(?:\.\d+)?(?:\s*[*†‡§])*"
    percent = r"\d+(?:\.\d+)?%"
    group_pattern = re.compile(
        rf"^\s*(?P<n>{number})(?:\s+(?P<pct>{percent}))?"
        rf"(?:\s+\[\s*(?P<low>{percent})\s*,?\s*(?P<high>{percent})\s*\])?"
    )

    logical_rows: list[tuple[str, list[tuple[str, str, str, str]]]] = []
    for row in range(leaf_row + 1, num_rows):
        cells = row_cells[row]
        if not cells:
            continue
        row_label_cells = [cell for cell in cells if cell.start_col_offset_idx == 0]
        if not row_label_cells:
            return None
        row_label = _clean_table_text(row_label_cells[0].text)
        remainder = " ".join(
            _clean_table_text(cell.text)
            for cell in cells
            if cell is not row_label_cells[0]
        )

        groups: list[tuple[str, str, str, str]] = []
        cursor = remainder
        for _ in range(group_count):
            match = group_pattern.match(cursor)
            if not match:
                return None
            n_value = (match.group("n") or "").strip()
            pct_value = (match.group("pct") or "").strip()
            low = (match.group("low") or "").strip()
            high = (match.group("high") or "").strip()
            low_value = f"[{low}," if low else ""
            high_value = f"{high}]" if high else ""
            groups.append((n_value, pct_value, low_value, high_value))
            cursor = cursor[match.end():]
        if cursor.strip():
            return None
        logical_rows.append((row_label, groups))

    if not logical_rows:
        return None

    header_depth = 3 if has_umbrella else 2
    html_lines = ["<table>"]
    if has_umbrella:
        html_lines.append("  <tr>")
        html_lines.append(
            f'    <th rowspan="{header_depth}">{html_mod.escape(first_header)}</th>'
        )
        html_lines.append(
            f'    <th colspan="{group_count * 4}">{html_mod.escape(umbrella_text)}</th>'
        )
        html_lines.append("  </tr>")
        html_lines.append("  <tr>")
    else:
        html_lines.append("  <tr>")
        html_lines.append(
            f'    <th rowspan="{header_depth}">{html_mod.escape(first_header)}</th>'
        )
    for title in group_titles:
        html_lines.append(f'    <th colspan="4">{html_mod.escape(title)}</th>')
    html_lines.append("  </tr>")
    html_lines.append("  <tr>")
    for _ in range(group_count):
        html_lines.extend(["    <th>N</th>", "    <th>%</th>", '    <th colspan="2">95% CI</th>'])
    html_lines.append("  </tr>")

    for row_label, groups in logical_rows:
        html_lines.append("  <tr>")
        html_lines.append(f'    <th>{html_mod.escape(row_label)}</th>')
        for n_value, pct_value, low_value, high_value in groups:
            html_lines.append(f'    <td>{html_mod.escape(n_value)}</td>')
            html_lines.append(f'    <td>{html_mod.escape(pct_value)}</td>')
            html_lines.append(f'    <td>{html_mod.escape(low_value)}</td>')
            html_lines.append(f'    <td>{html_mod.escape(high_value)}</td>')
        html_lines.append("  </tr>")
    html_lines.append("</table>")
    normalized_cells: list[dict] = []
    normalized_cells.append({
        "row": 0,
        "column": 0,
        "rowSpan": header_depth,
        "columnSpan": 1,
        "text": first_header,
        "role": "header",
    })
    group_header_row = 1 if has_umbrella else 0
    if has_umbrella:
        normalized_cells.append({
            "row": 0,
            "column": 1,
            "rowSpan": 1,
            "columnSpan": group_count * 4,
            "text": umbrella_text,
            "role": "header",
        })
    for group_index, title in enumerate(group_titles):
        base_column = 1 + group_index * 4
        normalized_cells.append({
            "row": group_header_row,
            "column": base_column,
            "rowSpan": 1,
            "columnSpan": 4,
            "text": title,
            "role": "header",
        })
        leaf_row_index = header_depth - 1
        normalized_cells.extend([
            {"row": leaf_row_index, "column": base_column, "rowSpan": 1, "columnSpan": 1, "text": "N", "role": "header"},
            {"row": leaf_row_index, "column": base_column + 1, "rowSpan": 1, "columnSpan": 1, "text": "%", "role": "header"},
            {"row": leaf_row_index, "column": base_column + 2, "rowSpan": 1, "columnSpan": 2, "text": "95% CI", "role": "header"},
        ])
    for row_offset, (row_label, groups) in enumerate(logical_rows):
        output_row = header_depth + row_offset
        normalized_cells.append({
            "row": output_row,
            "column": 0,
            "rowSpan": 1,
            "columnSpan": 1,
            "text": row_label,
            "role": "header",
        })
        for group_index, (n_value, pct_value, low_value, high_value) in enumerate(groups):
            base_column = 1 + group_index * 4
            for column_offset, value in enumerate((n_value, pct_value, low_value, high_value)):
                normalized_cells.append({
                    "row": output_row,
                    "column": base_column + column_offset,
                    "rowSpan": 1,
                    "columnSpan": 1,
                    "text": value,
                    "role": "data",
                })

    return {
        "html": "\n".join(html_lines),
        "tableData": {
            "version": 1,
            "source": "docling",
            "reconstructionMethod": "repeated_statistics_v2",
            "rowCount": header_depth + len(logical_rows),
            "columnCount": 1 + group_count * 4,
            "cells": normalized_cells,
            "rawCells": _serialize_raw_table_cells(tbl),
            "warnings": [],
        },
    }


def generate_table_payload(tbl) -> tuple[str, dict]:
    data = tbl.data
    if not data or not data.table_cells:
        return "", {}

    reconstructed = _generate_repeated_statistics_table(tbl)
    if reconstructed:
        return reconstructed["html"], reconstructed["tableData"]

    num_rows = 0
    num_cols = 0
    for cell in data.table_cells:
        num_rows = max(num_rows, cell.end_row_offset_idx)
        num_cols = max(num_cols, cell.end_col_offset_idx)

    row_cells: dict[int, list] = {r: [] for r in range(num_rows)}
    for cell in data.table_cells:
        row_cells[cell.start_row_offset_idx].append(cell)

    html_lines = ["<table>"]
    for r in range(num_rows):
        html_lines.append("  <tr>")
        cells = sorted(row_cells[r], key=lambda c: c.start_col_offset_idx)
        cells_by_start = {cell.start_col_offset_idx: cell for cell in cells}

        # Columns covered by a rowspan that began on an earlier row must not
        # receive another cell. Gaps not covered by a rowspan are real empty
        # grid cells (commonly the top-left corner of a multi-level header).
        covered_by_prior_rowspan: set[int] = set()
        for cell in data.table_cells:
            if cell.start_row_offset_idx < r < cell.end_row_offset_idx:
                covered_by_prior_rowspan.update(
                    range(cell.start_col_offset_idx, cell.end_col_offset_idx)
                )

        row_is_header = any(
            getattr(cell, "column_header", False) for cell in cells
        )
        c = 0
        while c < num_cols:
            if c in covered_by_prior_rowspan:
                c += 1
                continue

            cell = cells_by_start.get(c)
            if cell is None:
                # Preserve a contiguous coordinate gap as one empty cell. This
                # keeps following grouped headers aligned with body columns.
                gap_end = c + 1
                while (
                    gap_end < num_cols
                    and gap_end not in covered_by_prior_rowspan
                    and gap_end not in cells_by_start
                ):
                    gap_end += 1
                gap_span = gap_end - c
                tag = "th" if row_is_header else "td"
                span_attr = f' colspan="{gap_span}"' if gap_span > 1 else ""
                html_lines.append(
                    f'    <{tag}{span_attr} class="table-empty-cell" aria-hidden="true"></{tag}>'
                )
                c = gap_end
                continue

            row_span = cell.end_row_offset_idx - cell.start_row_offset_idx
            col_span = cell.end_col_offset_idx - cell.start_col_offset_idx
            tag = "th" if getattr(cell, "column_header", False) or getattr(cell, "row_header", False) else "td"
            span_attrs = ""
            if row_span > 1:
                span_attrs += f' rowspan="{row_span}"'
            if col_span > 1:
                span_attrs += f' colspan="{col_span}"'
            escaped_text = html_mod.escape(_clean_table_text(cell.text))
            html_lines.append(f"    <{tag}{span_attrs}>{escaped_text}</{tag}>")
            c = max(c + 1, cell.end_col_offset_idx)
        html_lines.append("  </tr>")
    html_lines.append("</table>")
    raw_cells = _serialize_raw_table_cells(tbl)
    normalized_cells = [
        {
            "row": raw["startRow"],
            "column": raw["startColumn"],
            "rowSpan": max(1, raw["endRow"] - raw["startRow"]),
            "columnSpan": max(1, raw["endColumn"] - raw["startColumn"]),
            "text": _clean_table_text(raw["text"]),
            "role": "header" if raw["columnHeader"] or raw["rowHeader"] else "data",
        }
        for raw in raw_cells
    ]
    return "\n".join(html_lines), {
        "version": 1,
        "source": "docling",
        "reconstructionMethod": "docling_native_v1",
        "rowCount": num_rows,
        "columnCount": num_cols,
        "cells": normalized_cells,
        "rawCells": raw_cells,
        "warnings": [],
    }


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "errorCode": "INVALID_ARGUMENTS", "errorDetail": "Missing arguments."}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    output_dir = sys.argv[2]

    if not os.path.exists(pdf_path):
        print(json.dumps({"success": False, "errorCode": "FILE_NOT_FOUND", "errorDetail": "PDF file not found."}))
        sys.exit(1)

    if not os.path.isdir(output_dir):
        print(json.dumps({"success": False, "errorCode": "DIR_NOT_FOUND", "errorDetail": "Output directory not found."}))
        sys.exit(1)

    pdf_real = os.path.realpath(pdf_path)
    out_real = os.path.realpath(output_dir)

    # Ensure output dir is not the pdf file itself or a parent of it
    if _safe_relative(out_real, pdf_real) is not None or out_real == pdf_real:
        print(json.dumps({"success": False, "errorCode": "INVALID_PATH", "errorDetail": "Output directory must be outside the PDF path."}))
        sys.exit(1)

    try:
        start_time = time.time()

        do_ocr = False
        if len(sys.argv) >= 4:
            do_ocr = sys.argv[3].lower() == "true"

        image_scale = 2.0
        artifacts_path = os.environ.get("DOCLING_ARTIFACTS_PATH", "").strip()
        pipeline_options = PdfPipelineOptions(
            artifacts_path=artifacts_path if artifacts_path and os.path.isdir(artifacts_path) else None
        )
        pipeline_options.do_ocr = do_ocr
        # EasyOCR is the primary engine for Vietnamese scans. OCRMac accepts a
        # Vietnamese locale but has returned successful, empty pages on some
        # book scans; using it first silently produced image-only readers.
        if (
            do_ocr
            and importlib.util.find_spec("easyocr") is not None
        ):
            _install_easyocr_spatial_order_patch()
            configured_easyocr_dir = os.environ.get("EASYOCR_MODEL_DIR", "").strip()
            default_easyocr_dir = os.path.expanduser("~/.EasyOCR/model")
            easyocr_model_dir = (
                configured_easyocr_dir
                or (default_easyocr_dir if os.path.isdir(default_easyocr_dir) else "")
            )
            pipeline_options.ocr_options = EasyOcrOptions(
                lang=["vi", "en"],
                force_full_page_ocr=True,
                use_gpu=None,
                confidence_threshold=0.3,
                model_storage_directory=easyocr_model_dir or None,
            )
        elif (
            do_ocr
            and sys.platform == "darwin"
            and importlib.util.find_spec("ocrmac") is not None
        ):
            pipeline_options.ocr_options = OcrMacOptions(
                # OCRMac exposes Apple's Vietnamese locale as ``vi-VT``.
                lang=["vi-VT", "en-US"],
                force_full_page_ocr=True,
                recognition="accurate",
            )
        pipeline_options.do_table_structure = True
        pipeline_options.generate_picture_images = True
        pipeline_options.images_scale = image_scale

        converter = DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
            }
        )

        result = converter.convert(pdf_path)
        doc = result.document

        items = []
        item_counter = 0

        has_seen_references = False
        reference_quality_degraded = False
        has_extracted_title = False

        for element, level in doc.iterate_items():
            text = getattr(element, "text", "").strip()

            # Map Docling classification label
            item_label = "text"
            if hasattr(element, "label") and element.label:
                item_label = getattr(element.label, "value", str(element.label))

            item_id = f"docling_item_{item_counter}"
            item_counter += 1

            bbox_coords = None
            page_no = 1
            if hasattr(element, "prov") and element.prov:
                prov = element.prov[0]
                page_no = prov.page_no
                if hasattr(prov, "bbox") and prov.bbox:
                    bbox_coords = [prov.bbox.l, prov.bbox.t, prov.bbox.r, prov.bbox.b] if hasattr(prov.bbox, "l") else None

            item_type = "paragraph"
            caption_text = None
            table_html = None
            table_data = None
            img_desc = None
            file_path = None
            width = None
            height = None
            img_format = None
            image_hash = None
            fig_type = "embedded"
            confidence = 1.0

            if item_label == "title":
                item_type = "title"
                has_extracted_title = True
            elif item_label == "section_header":
                item_type = "heading"
                if (not has_extracted_title and page_no == 1 and len(text) > 30
                        and "article info" not in text.lower()
                        and "abstract" not in text.lower()):
                    item_type = "title"
                    has_extracted_title = True
                normalized_heading = re.sub(r'[^a-z0-9\u00c0-\u024f]+', ' ', text.lower()).strip()
                if normalized_heading in ["references", "bibliography", "literature cited", "tài liệu tham khảo"]:
                    has_seen_references = True
                elif has_seen_references:
                    # Reference mode is a section state, not a permanent
                    # document state. Layout engines can emit a later column
                    # heading (for example Conclusion) after a References
                    # heading. Never turn that later section into numbered
                    # bibliography entries.
                    has_seen_references = False
            elif item_label == "page_header":
                item_type = "page_header"
            elif item_label == "page_footer":
                item_type = "page_footer"
            elif item_label == "footnote":
                item_type = "footnote"
            elif item_label == "caption":
                item_type = "caption"
            elif item_label == "list_item":
                item_type = "list_item"
            elif item_label == "table":
                item_type = "table"
                if hasattr(element, "caption") and element.caption:
                    caption_text = element.caption.text
                table_html, table_data = generate_table_payload(element)
            elif item_label == "picture":
                item_type = "figure"
                if hasattr(element, "caption") and element.caption:
                    caption_text = element.caption.text

                img = element.get_image(doc)
                if img:
                    filename = f"picture_{item_id}.png"
                    save_path = os.path.join(out_real, filename)
                    save_real = os.path.realpath(save_path)

                    # Containment check before writing
                    rel = _safe_relative(out_real, save_real)
                    if rel is None:
                        # Path escapes output directory — skip this image
                        fig_type = "region_only"
                    else:
                        img.save(save_real, "PNG")
                        with open(save_real, "rb") as saved_image:
                            image_hash = hashlib.sha256(saved_image.read()).hexdigest()
                        img_desc = filename
                        file_path = save_real
                        width, height = img.size
                        img_format = "PNG"
                        fig_type = "embedded"
                else:
                    fig_type = "region_only"

            if has_seen_references and item_type not in ["heading", "table", "figure", "page_header", "page_footer"]:
                if _is_back_matter_metadata(text):
                    item_type = "metadata"
                    has_seen_references = False
                elif _is_unlabelled_body_heading(text):
                    item_type = "heading"
                    has_seen_references = False

            if has_seen_references and item_type not in ["heading", "table", "figure", "page_header", "page_footer"]:
                item_type = "reference"
                years = re.findall(r'\b(19\d{2}|20\d{2})\b', text)
                if len(years) >= 2:
                    reference_quality_degraded = True

            item_data: dict = {
                "id": item_id,
                "type": item_type,
                "text": text,
                "pageNumber": page_no,
            }
            if bbox_coords:
                item_data["bbox"] = bbox_coords
            if caption_text:
                item_data["caption"] = caption_text
            if table_html:
                item_data["html"] = table_html
            if table_data:
                item_data["tableData"] = table_data
            if img_desc:
                item_data["imageDescriptor"] = img_desc
                item_data["filePath"] = file_path
                item_data["fileName"] = img_desc
                item_data["width"] = width
                item_data["height"] = height
                item_data["imageHash"] = image_hash
                item_data["format"] = img_format
                item_data["figureType"] = fig_type
                item_data["confidence"] = confidence
            elif item_type == "figure" and fig_type == "region_only":
                item_data["figureType"] = "region_only"
                item_data["confidence"] = confidence

            items.append(item_data)

        duration = time.time() - start_time

        output = {
            "title": getattr(doc, "name", "Bản đọc thông minh") or "Bản đọc thông minh",
            "pageCount": len(doc.pages) if hasattr(doc, "pages") and doc.pages else 1,
            "items": items,
            "duration": duration,
            "ocrUsed": do_ocr,
            "imageScale": image_scale,
            "warnings": [],
            "referenceQualityDegraded": reference_quality_degraded,
            "success": True,
        }

        # UTF-8 output avoids expanding every Vietnamese character into a
        # six-byte ``\\uXXXX`` escape in large OCR books.
        print(json.dumps(output, ensure_ascii=False))

    except Exception as exc:
        # Keep the Python traceback on the backend's stderr so large-book OCR
        # failures are diagnosable without exposing local paths to the client.
        traceback.print_exc(file=sys.stderr)
        safe_detail = re.sub(r"\s+", " ", str(exc)).strip()[:600]
        exception_name = type(exc).__name__
        missing_models = exception_name == "LocalEntryNotFoundError"
        print(json.dumps({
            "success": False,
            "errorCode": "DOCLING_MODELS_UNAVAILABLE" if missing_models else f"PARSING_FAILED_{exception_name.upper()}",
            "errorDetail": (
                "Thiếu model Docling cục bộ và máy chủ không thể tải model cần thiết."
                if missing_models
                else safe_detail or "Failed to parse PDF document."
            ),
        }, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
