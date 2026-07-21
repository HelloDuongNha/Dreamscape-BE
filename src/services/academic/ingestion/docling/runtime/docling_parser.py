#!/usr/bin/env python3
import sys
import os
import json
import time
import re
import html as html_mod
import importlib.util

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import OcrMacOptions, PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption


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
        pipeline_options = PdfPipelineOptions()
        pipeline_options.do_ocr = do_ocr
        # Apple Vision gives substantially better Vietnamese diacritics than
        # the generic OCR fallback on the local macOS runtime. Keep this
        # conditional so Linux/Windows deployments continue using Docling's
        # automatic OCR engine instead of importing a macOS-only dependency.
        if (
            do_ocr
            and sys.platform == "darwin"
            and importlib.util.find_spec("ocrmac") is not None
        ):
            pipeline_options.ocr_options = OcrMacOptions(
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
                        img_desc = filename
                        file_path = save_real
                        width, height = img.size
                        img_format = "PNG"
                        fig_type = "embedded"
                else:
                    fig_type = "region_only"

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

    except Exception:
        print(json.dumps({
            "success": False,
            "errorCode": "PARSING_FAILED",
            "errorDetail": "Failed to parse PDF document.",
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
