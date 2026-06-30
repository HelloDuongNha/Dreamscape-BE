#!/usr/bin/env python3
import sys
import os
import json
import re
import traceback

def log_error(msg):
    print(f"ERROR: {msg}", file=sys.stderr)

def log_info(msg):
    print(f"INFO: {msg}", file=sys.stderr)

# Try importing fitz
try:
    import fitz # PyMuPDF
except ImportError:
    log_error("PyMuPDF (fitz) is not installed in the current Python environment.")
    print(json.dumps({
        "success": False,
        "errorCode": "DEPENDENCY_MISSING",
        "errorDetail": "PyMuPDF not installed"
    }))
    sys.exit(1)

def is_likely_heading(text):
    text = text.strip()
    if not text or len(text) > 120:
        return False
    lower = text.lower().rstrip('.')
    academic_titles = {
        'introduction', 'abstract', 'methods', 'methodology', 'results', 'discussion',
        'conclusion', 'conclusions', 'references', 'literature review', 'background',
        'related work', 'discussion and conclusion', 'acknowledgements', 'appendix',
        'tóm tắt', 'giới thiệu', 'phương pháp', 'kết quả', 'thảo luận', 'kết luận', 'tài liệu tham khảo',
        'statements', 'author contributions', 'conflict of interest', 'funding', 'acknowledgments',
        'data availability statement', 'ethics statement', 'supplementary material', "publisher's note",
        'copyright'
    }
    if lower in academic_titles:
        return True
    if re.match(r'^\d+(\.\d+)*\s+[A-Z]', text):
        return True
    if re.match(r'^[I|V|X|L|C|D|M]+\.\s+[A-Z]', text):
        return True
    if re.match(r'^[A-Z]\.\s+[A-Z]', text):
        return True
    if re.match(r'^(section|mục|chương|chapter|bài|phần)\s+\d+', text, re.IGNORECASE):
        return True
    if text.isupper() and any(c.isalpha() for c in text) and len(text) > 3:
        return True
    return False

def is_list_item(text):
    text = text.strip()
    if re.match(r'^[-•\*+]\s+', text):
        return True
    if re.match(r'^\(?[a-zA-Z0-9]{1,4}\)\s+', text):
        return True
    if re.match(r'^\[\d+\]\s+', text):
        return True
    if re.match(r'^\d+\.\s+', text) and not re.match(r'^\d+\.\d+', text):
        return True
    if re.match(r'^[a-zA-Z]\.\s+', text):
        return True
    return False

def extract_list_marker(text):
    text = text.strip()
    # Case 1: Bullet points
    m = re.match(r'^([-•\*+])\s+(.*)$', text)
    if m:
        return m.group(1), m.group(2)
    # Case 2: Parentheses marker (a) or a)
    m = re.match(r'^(\(?[a-zA-Z0-9]{1,4}\))\s+(.*)$', text)
    if m:
        return m.group(1), m.group(2)
    # Case 3: Bracketed list [1]
    m = re.match(r'^(\[\d+\])\s+(.*)$', text)
    if m:
        return m.group(1), m.group(2)
    # Case 4: Numbered dot 1. or a.
    m = re.match(r'^(\d+\.|[a-zA-Z]\.)\s+(.*)$', text)
    if m:
        return m.group(1), m.group(2)
    return "-", text

def is_caption(text):
    text = text.strip()
    lower = text.lower()
    return lower.startswith(('figure', 'fig.', 'table', 'hình', 'bảng'))

def starts_with_metadata_prefix(text):
    trimmed = text.strip()
    if not trimmed:
        return False
    lower = trimmed.lower()
    prefixes = [
        "edited by:", "reviewed by:", "specialty section:", "received:", 
        "accepted:", "published:", "citation:", "correspondence:", 
        "copyright:", "conflict of interest statement:", "conflict of interest:",
        "this article was submitted to:", "correspondence email:", "email:",
        "published online", "co-first authors"
    ]
    for p in prefixes:
        if lower.startswith(p):
            return True
    if lower.startswith("copyright ©") or "conflict of interest" in lower:
        return True
    return False

def is_body_paragraph(text):
    trimmed = text.strip()
    if not trimmed:
        return False
    if not trimmed[0].isupper():
        return False
    if '@' in trimmed:
        return False
    if starts_with_metadata_prefix(trimmed):
        return False
    has_end_punc = trimmed[-1] in {'.', '?', '!'}
    words = trimmed.split()
    if len(words) > 15 and has_end_punc:
        return True
    return False

def normalize_text(text):
    if not text:
        return ""
    translations = {
        "ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl",
        "\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl", "\ufb03": "ffi", "\ufb04": "ffl"
    }
    for k, v in translations.items():
        text = text.replace(k, v)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def reflow_text(text):
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    if not lines:
        return ""
    result = []
    for line in lines:
        if not result:
            result.append(line)
        else:
            prev = result[-1]
            if prev.endswith('-') and len(prev) > 1 and prev[-2].isalpha() and line[0].isalpha():
                prefix_match = re.search(r'([a-zA-Z]+)-$', prev)
                if prefix_match:
                    prefix = prefix_match.group(1).lower()
                    compound_prefixes = {
                        'co', 'pre', 'post', 'non', 'self', 'anti', 'multi', 'semi', 'sub',
                        'cross', 'inter', 'intra', 'pro', 'pseudo', 'ex', 'ultra', 'micro',
                        'macro', 'bio', 'geo', 'eco', 'cyber', 'neuro', 'psycho', 'socio',
                        'well', 'ill', 'good', 'bad', 'high', 'low', 'long', 'short', 'full',
                        'part', 'half', 'first', 'last', 'second', 'third', 'free', 'new', 'old'
                    }
                    if prefix in compound_prefixes:
                        result[-1] = prev + line
                    else:
                        result[-1] = prev[:-1] + line
                else:
                    result[-1] = prev[:-1] + line
            else:
                result[-1] = prev + " " + line
    return normalize_text(result[0])

def split_inline_enumerations(text):
    matches1 = list(re.finditer(r'(?:^|\s|[\.,;\-\(\)])\(([a-zA-Z0-9])\)\s', text))
    matches2 = list(re.finditer(r'(?:^|\s|[\.,;\-\(\)])([a-zA-Z0-9])\)\s', text))
    matches3 = list(re.finditer(r'(?:^|\s|[\.,;\-\(\)])([1-9])\.\s', text))
    for matches in [matches1, matches2, matches3]:
        if len(matches) < 2:
            continue
        seq = []
        for m in matches:
            val = m.group(1)
            marker_str = m.group(0).strip()
            try:
                start_pos = m.start() + m.group(0).index(marker_str)
            except ValueError:
                start_pos = m.start()
            seq.append({
                "val": val,
                "start": start_pos,
                "end": m.end(),
                "marker": marker_str
            })
        longest_subseq = []
        current_subseq = []
        for i in range(len(seq)):
            item = seq[i]
            if not current_subseq:
                current_subseq.append(item)
            else:
                prev = current_subseq[-1]
                is_seq = False
                p_val, c_val = prev["val"].lower(), item["val"].lower()
                if p_val.isdigit() and c_val.isdigit():
                    if int(c_val) == int(p_val) + 1:
                        is_seq = True
                elif p_val.isalpha() and c_val.isalpha() and len(p_val) == 1 and len(c_val) == 1:
                    if ord(c_val) == ord(p_val) + 1:
                        is_seq = True
                if is_seq:
                    current_subseq.append(item)
                else:
                    if len(current_subseq) > len(longest_subseq):
                        longest_subseq = current_subseq
                    current_subseq = [item]
        if len(current_subseq) > len(longest_subseq):
            longest_subseq = current_subseq
        if len(longest_subseq) >= 2:
            first_val = longest_subseq[0]["val"].lower()
            if first_val not in ["a", "b", "1", "2", "i", "ii"]:
                continue
            parts = []
            first_marker = longest_subseq[0]
            pre_text = text[:first_marker["start"]].strip()
            if pre_text:
                parts.append({"type": "paragraph", "text": pre_text})
            for idx in range(len(longest_subseq)):
                curr = longest_subseq[idx]
                start_idx = curr["start"]
                if idx < len(longest_subseq) - 1:
                    end_idx = longest_subseq[idx + 1]["start"]
                else:
                    end_idx = len(text)
                item_text = text[start_idx:end_idx].strip()
                if item_text.endswith(';') or item_text.endswith(','):
                    item_text = item_text[:-1].strip()
                parts.append({"type": "list_item", "text": item_text})
            return parts
    return None

def split_long_paragraph(text, max_len=1400):
    pattern = re.compile(
        r'(?<!\b[A-Z]\.)(?<!\b[A-Z][a-z]\.)(?<!\bet al\.)(?<!\be\.g\.)(?<!\bi\.e\.)(?<!\bvs\.)'
        r'(?<!\bfig\.)(?<!\bFig\.)(?<!\bfigs\.)(?<!\bFigs\.)(?<!\btab\.)(?<!\bTab\.)'
        r'(?<!\btabs\.)(?<!\bTabs\.)(?<!\bvol\.)(?<!\bVol\.)(?<!\bpp\.)(?<!\bno\.)(?<!\bNo\.)'
        r'(?<!\bdr\.)(?<!\bDr\.)(?<!\bprof\.)(?<!\bProf\.)(?<!\beds\.)(?<!\bed\.)(?<=\.|\?|\!)\s+(?=[A-Z])'
    )
    sentences = pattern.split(text)
    if len(sentences) <= 1:
        return [text]
    paragraphs = []
    current_para = []
    current_len = 0
    for sen in sentences:
        sen_strip = sen.strip()
        if not sen_strip:
            continue
        if current_para and (current_len > 1200 or current_len + len(sen_strip) > 1500):
            paragraphs.append(" ".join(current_para))
            current_para = [sen_strip]
            current_len = len(sen_strip)
        else:
            current_para.append(sen_strip)
            current_len += len(sen_strip) + 1
    if current_para:
        paragraphs.append(" ".join(current_para))
    return paragraphs

def split_block_into_subblocks(block, page_dict):
    x0, y0, x1, y1, text, block_no, block_type = block
    if block_type != 0:
        return [block]
    block_dict = None
    if block_no < len(page_dict["blocks"]):
        b = page_dict["blocks"][block_no]
        bx0, by0, bx1, by1 = b["bbox"]
        if abs(bx0 - x0) < 1.0 and abs(by0 - y0) < 1.0:
            block_dict = b
    if not block_dict:
        for b in page_dict["blocks"]:
            bx0, by0, bx1, by1 = b["bbox"]
            if abs(bx0 - x0) < 2.0 and abs(by0 - y0) < 2.0 and abs(bx1 - x1) < 2.0 and abs(by1 - y1) < 2.0:
                block_dict = b
                break
    geom_lines = []
    if block_dict and "lines" in block_dict:
        for line_dict in block_dict["lines"]:
            line_text = "".join(span["text"] for span in line_dict["spans"])
            avg_size = sum(span["size"] for span in line_dict["spans"]) / len(line_dict["spans"]) if line_dict["spans"] else 10.0
            is_bold = any((span["flags"] & 16) or "bold" in span["font"].lower() for span in line_dict["spans"]) if line_dict["spans"] else False
            lx0, ly0, lx1, ly1 = line_dict["bbox"]
            geom_lines.append({"x0": lx0, "y0": ly0, "x1": lx1, "y1": ly1, "text": line_text, "size": avg_size, "is_bold": is_bold})
    paragraphs_text = []
    if geom_lines:
        gaps = [geom_lines[i]["y0"] - geom_lines[i-1]["y1"] for i in range(1, len(geom_lines))]
        median_gap = sorted(gaps)[len(gaps)//2] if gaps else 3.0
        max_line_x1 = max(line["x1"] for line in geom_lines) if geom_lines else x1
        current_para = []
        for i, line in enumerate(geom_lines):
            trimmed = line["text"].strip()
            if not trimmed:
                if current_para:
                    paragraphs_text.append(reflow_text("\n".join(l["text"] for l in current_para)))
                    current_para = []
                continue
            starts_new = False
            if current_para:
                prev = current_para[-1]
                gap = line["y0"] - prev["y1"]
                score = 0
                strong_reasons = []
                if gap > median_gap + 5.0:
                    score += 6
                    strong_reasons.append("large_gap")
                if line["x0"] > prev["x0"] + 8:
                    score += 4
                    strong_reasons.append("indentation")
                if is_likely_heading(trimmed):
                    score += 10
                    strong_reasons.append("heading_boundary")
                if is_list_item(trimmed):
                    score += 6
                    strong_reasons.append("list_marker")
                if "references" in trimmed.lower() or "tài liệu tham khảo" in trimmed.lower():
                    score += 10
                    strong_reasons.append("reference_boundary")
                current_para_len = sum(len(l["text"]) for l in current_para)
                if current_para_len > 1200:
                    score += 6
                    strong_reasons.append("long_paragraph_guard")
                if prev["x1"] < max_line_x1 - 20:
                    score += 2
                if trimmed and trimmed[0].isupper():
                    score += 1
                if prev["text"].strip().endswith('-'):
                    score -= 5
                if trimmed and trimmed[0].islower():
                    score -= 5
                starts_new = (score >= 6 and len(strong_reasons) > 0)
            if starts_new and current_para:
                paragraphs_text.append(reflow_text("\n".join(l["text"] for l in current_para)))
                current_para = [line]
            else:
                current_para.append(line)
        if current_para:
            paragraphs_text.append(reflow_text("\n".join(l["text"] for l in current_para)))
    else:
        # Fallback text segmentation
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        current_para = []
        for line in lines:
            trimmed = line.strip()
            starts_new = False
            if current_para:
                prev = current_para[-1].strip()
                score = 0
                strong_reasons = []
                if is_likely_heading(trimmed):
                    score += 10
                    strong_reasons.append("heading_boundary")
                if is_list_item(trimmed):
                    score += 6
                    strong_reasons.append("list_marker")
                if "references" in trimmed.lower() or "tài liệu tham khảo" in trimmed.lower():
                    score += 10
                    strong_reasons.append("reference_boundary")
                current_para_len = sum(len(l) for l in current_para)
                if current_para_len > 1200:
                    score += 6
                    strong_reasons.append("long_paragraph_guard")
                if trimmed and trimmed[0].isupper():
                    score += 1
                if prev.endswith('-'):
                    score -= 5
                if trimmed and trimmed[0].islower():
                    score -= 5
                starts_new = (score >= 6 and len(strong_reasons) > 0)
            if starts_new and current_para:
                paragraphs_text.append(reflow_text("\n".join(current_para)))
                current_para = [line]
            else:
                current_para.append(line)
        if current_para:
            paragraphs_text.append(reflow_text("\n".join(current_para)))

    final_blocks_text = []
    for p_text in paragraphs_text:
        if not p_text:
            continue
        inline_parts = split_inline_enumerations(p_text)
        if inline_parts:
            for part in inline_parts:
                if part["type"] == "paragraph":
                    for gp in split_long_paragraph(part["text"]):
                        final_blocks_text.append({"text": gp, "type": "paragraph"})
                else:
                    final_blocks_text.append({"text": part["text"], "type": "list_item"})
        else:
            for gp in split_long_paragraph(p_text):
                final_blocks_text.append({"text": gp, "type": "paragraph"})

    subblocks = []
    total_len = sum(len(part["text"]) for part in final_blocks_text) or 1
    current_y = y0
    for part in final_blocks_text:
        part_text = part["text"]
        part_len = len(part_text)
        y_span = (y1 - y0) * part_len / total_len
        part_y0 = current_y
        part_y1 = current_y + y_span
        current_y = part_y1
        subblocks.append((x0, part_y0, x1, part_y1, part_text, block_no, block_type, part["type"]))
    return subblocks

def detect_doi_fig_table(text):
    doi_match = re.search(r'(10\.\d{4,9}/[-._;()/:A-Z0-9]+)', text, re.IGNORECASE)
    if doi_match:
        doi = doi_match.group(1)
        lower_text = text.lower()
        if re.search(r'\b(g\d{3}|t\d{3}|fig\d*|table\d*)\b', lower_text) or '.g0' in lower_text or '.t0' in lower_text:
            is_table = 't0' in lower_text or 'table' in lower_text
            return {
                "is_match": True,
                "type": "table" if is_table else "figure",
                "doiUrl": f"https://doi.org/{doi}",
                "caption": text
            }
    return None

def sort_page_blocks(blocks, page_width):
    if not blocks:
        return []
    separators = []
    other_blocks = []
    for b in blocks:
        x0, y0, x1, y1 = b[0], b[1], b[2], b[3]
        width = x1 - x0
        is_separator = (x0 < page_width * 0.4 and x1 > page_width * 0.6) or (width > page_width * 0.75)
        if is_separator:
            separators.append(b)
        else:
            other_blocks.append(b)
    separators = sorted(separators, key=lambda x: x[1])
    bands = []
    last_y = 0.0
    for sep in separators:
        sep_y0 = sep[1]
        sep_y1 = sep[3]
        if sep_y0 > last_y:
            bands.append({"type": "columns", "y_start": last_y, "y_end": sep_y0, "blocks": []})
        bands.append({"type": "separator", "y_start": sep_y0, "y_end": sep_y1, "block": sep})
        last_y = sep_y1
    bands.append({"type": "columns", "y_start": last_y, "y_end": float('inf'), "blocks": []})
    for b in other_blocks:
        y_center = (b[1] + b[3]) / 2
        assigned = False
        for band in bands:
            if band["type"] == "columns" and band["y_start"] <= y_center <= band["y_end"]:
                band["blocks"].append(b)
                assigned = True
                break
        if not assigned:
            closest_band = None
            min_dist = float('inf')
            for band in bands:
                if band["type"] == "columns":
                    dist = min(abs(y_center - band["y_start"]), abs(y_center - band["y_end"]))
                    if dist < min_dist:
                        min_dist = dist
                        closest_band = band
            if closest_band:
                closest_band["blocks"].append(b)
    final_blocks = []
    for band in bands:
        if band["type"] == "separator":
            final_blocks.append(band["block"])
        elif band["type"] == "columns":
            col_blocks = band["blocks"]
            if not col_blocks:
                continue
            sorted_by_y = sorted(col_blocks, key=lambda b: b[1])
            sub_bands = []
            current_sub_band = []
            current_y_end = -1.0
            for b in sorted_by_y:
                by0, by1 = b[1], b[3]
                if not current_sub_band:
                    current_sub_band.append(b)
                    current_y_end = by1
                elif by0 <= current_y_end + 12:
                    current_sub_band.append(b)
                    current_y_end = max(current_y_end, by1)
                else:
                    sub_bands.append(current_sub_band)
                    current_sub_band = [b]
                    current_y_end = by1
            if current_sub_band:
                sub_bands.append(current_sub_band)
            for sub_band in sub_bands:
                left_col = []
                right_col = []
                mid_x = page_width / 2
                for b in sub_band:
                    bx0, bx1 = b[0], b[2]
                    bc = (bx0 + bx1) / 2
                    if bc < mid_x:
                        left_col.append(b)
                    else:
                        right_col.append(b)
                left_col = sorted(left_col, key=lambda x: x[1])
                right_col = sorted(right_col, key=lambda x: x[1])
                final_blocks.extend(left_col)
                final_blocks.extend(right_col)
    return final_blocks

def main():
    if len(sys.argv) < 2:
        log_error("Missing PDF file path argument.")
        print(json.dumps({"success": False, "errorCode": "INVALID_ARGUMENTS"}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    if not os.path.exists(pdf_path):
        log_error(f"PDF file does not exist: {pdf_path}")
        print(json.dumps({"success": False, "errorCode": "FILE_NOT_FOUND"}))
        sys.exit(1)

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        log_error(f"Failed to open PDF with PyMuPDF: {str(e)}")
        print(json.dumps({"success": False, "errorCode": "PDF_OPEN_FAILED", "errorDetail": str(e)}))
        sys.exit(1)

    try:
        # Determine Title
        doc_title = "Tài liệu học thuật"
        meta_title = doc.metadata.get('title')
        if meta_title and len(meta_title.strip()) > 3:
            doc_title = meta_title.strip()

        raw_blocks_flow = []
        total_word_count = 0
        total_char_count = 0
        has_detected_sections = False
        has_structured_references = False
        ref_indices = []

        log_info(f"Starting parsing for PDF: {pdf_path}")

        for page_num in range(len(doc)):
            page = doc[page_num]
            rect = page.rect
            width, height = rect.width, rect.height
            raw_blocks = page.get_text("blocks")
            page_dict = page.get_text("dict")
            
            split_raw_blocks = []
            for b in raw_blocks:
                split_raw_blocks.extend(split_block_into_subblocks(b, page_dict))

            filtered_blocks = []
            for b in split_raw_blocks:
                x0, y0, x1, y1, text, block_no, block_type, inner_type = b
                if block_type != 0 or not text.strip():
                    continue
                if page_num > 0 and y0 < height * 0.08:
                    continue
                if y1 > height * 0.92:
                    continue
                filtered_blocks.append(b)

            sorted_blocks = sort_page_blocks(filtered_blocks, width)

            # Emit page break separator
            raw_blocks_flow.append({
                "blockType": "page_break",
                "text": f"Page {page_num + 1}",
                "marker": None,
                "html": f"<div class=\"page-break\">Page {page_num + 1}</div>",
                "pageNumber": page_num + 1
            })

            for b in sorted_blocks:
                x0, y0, x1, y1, text, block_no, block_type, inner_type = b
                text_cleaned = reflow_text(text)
                if not text_cleaned:
                    continue

                total_word_count += len(text_cleaned.split())
                total_char_count += len(text_cleaned)

                stype = "paragraph"
                marker_val = None
                html_val = None

                if starts_with_metadata_prefix(text_cleaned):
                    stype = "metadata"
                elif inner_type == "list_item" or is_list_item(text_cleaned):
                    stype = "list_item"
                    marker_val, clean_body = extract_list_marker(text_cleaned)
                    text_cleaned = clean_body
                elif is_likely_heading(text_cleaned):
                    stype = "heading"
                    has_detected_sections = True
                elif is_caption(text_cleaned):
                    stype = "table" if text_cleaned.lower().startswith(('table', 'bảng')) else "figure"
                
                # Check DOI fig/table
                doi_fig_table = detect_doi_fig_table(text_cleaned)
                if doi_fig_table:
                    stype = doi_fig_table["type"]
                    html_val = f"<div class=\"{stype}-placeholder\">{text_cleaned}</div>"

                raw_blocks_flow.append({
                    "blockType": stype,
                    "text": text_cleaned,
                    "marker": marker_val,
                    "html": html_val,
                    "pageNumber": page_num + 1
                })

        doc.close()

        # Re-group raw_blocks_flow into clean sections
        sections = []
        current_section = None
        global_order = 0
        section_order = 0

        # Heuristic search for abstract or title heading
        for b in raw_blocks_flow:
            is_sec_boundary = False
            boundary_type = "paragraph_section"

            if b["blockType"] == "heading":
                is_sec_boundary = True
                lower_text = b["text"].lower()
                if "references" in lower_text or "tài liệu tham khảo" in lower_text:
                    boundary_type = "references"
                    has_structured_references = True
                elif "abstract" in lower_text or "tóm tắt" in lower_text:
                    boundary_type = "abstract"
                else:
                    boundary_type = "heading"

            elif b["blockType"] == "metadata" and (not current_section or current_section["sectionType"] != "metadata"):
                is_sec_boundary = True
                boundary_type = "metadata"

            # Check if title block exists
            if not current_section and b["blockType"] != "page_break":
                is_sec_boundary = True
                boundary_type = "title" if section_order == 0 else "paragraph_section"

            if is_sec_boundary:
                if current_section:
                    sections.append(current_section)
                current_section = {
                    "heading": b["text"] if boundary_type in ["heading", "abstract", "references"] else "",
                    "sectionType": boundary_type,
                    "order": section_order,
                    "blocks": []
                }
                section_order += 1

            if current_section:
                # Add block to section
                block_order = len(current_section["blocks"])
                # Build default html block if not set
                html_markup = b["html"]
                if not html_markup:
                    if b["blockType"] == "heading":
                        html_markup = f"<h2>{b['text']}</h2>"
                    elif b["blockType"] == "list_item":
                        html_markup = f"<li>{b['text']}</li>"
                    elif b["blockType"] == "page_break":
                        html_markup = f"<div class=\"page-break\">{b['text']}</div>"
                    else:
                        html_markup = f"<p>{b['text']}</p>"

                current_section["blocks"].append({
                    "blockType": b["blockType"],
                    "text": b["text"],
                    "marker": b["marker"],
                    "html": html_markup,
                    "pageNumber": b["pageNumber"],
                    "order": block_order
                })

        if current_section:
            sections.append(current_section)

        # Build clean output JSON
        quality = "high" if has_detected_sections and has_structured_references else "medium"
        warnings = ["Bản đọc thông minh được tối ưu hóa từ cấu trúc PDF gốc."]

        output = {
            "title": doc_title,
            "sections": sections,
            "warnings": warnings,
            "success": True
        }
        print(json.dumps(output))

    except Exception as e:
        log_error(f"Error parsing PDF: {str(e)}")
        log_error(traceback.format_exc())
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
