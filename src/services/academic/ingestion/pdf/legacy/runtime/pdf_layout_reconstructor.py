import re
from pdf_metadata_classifier import (
    is_narrow_standalone_boilerplate,
    is_broad_boilerplate_with_layout,
    matches_metadata_semantics,
    matches_metadata_evidence,
    is_main_content
)

def normalize_spaced_caps(text):
    trimmed = text.strip()
    if not trimmed:
        return ""
    
    normalized_spacing = " ".join(trimmed.split())
    lower = normalized_spacing.lower()
    
    # Strictly limit collapsing to recognized standalone semantic headings only
    mapping = {
        "a b s t r a c t": "Abstract",
        "t ó m t ắ t": "Tóm tắt",
        "t ó m t ă t": "Tóm tắt",
        "i n t r o d u c t i o n": "Introduction",
        "g i ớ i t h i ệ u": "Giới thiệu",
        "m e t h o d s": "Methods",
        "p h ư ơ n g p h á p": "Phương pháp",
        "r e s u l t s": "Results",
        "k ế t q u ả": "Kết quả",
        "d i s c u s s i o n": "Discussion",
        "t h ả o l u ậ n": "Thảo luận",
        "c o n c l u s i o n": "Conclusion",
        "k ế t l u ậ n": "Kết luận",
        "r e f e r e n c e s": "References",
        "t à i l i ệ u t h a m k h ả o": "Tài liệu tham khảo",
        "a r t i c l e i n f o": "Article Info",
        "t h ô n g t i n b à i b á o": "Thông tin bài báo"
    }
    
    if lower in mapping:
        return mapping[lower]
        
    collapsed = re.sub(r'\s+', '', lower)
    collapsed_mapping = {re.sub(r'\s+', '', k): v for k, v in mapping.items()}
    if collapsed in collapsed_mapping:
        return collapsed_mapping[collapsed]
        
    return text

def is_likely_caption(text):
    lower = text.strip().lower()
    if lower.startswith(('table', 'bảng', 'fig', 'figure', 'hình')):
        if re.match(r'^(table|bảng|fig|figure|hình)\.?\s*\d+', lower):
            return True
    return False

def matches_academic_heading_semantics(text):
    lower = text.strip().lower()
    headings = [
        r'^abstract$', r'^tóm\s+tắt$',
        r'^introduction$', r'^giới\s+thiệu$',
        r'^background$', r'^tổng\s+quan$',
        r'^methods$', r'^materials\s+and\s+methods$', r'^phương\s+pháp$',
        r'^results$', r'^kết\s+quả$',
        r'^discussion$', r'^thảo\s+luận$',
        r'^conclusion$', r'^kết\s+luận$',
        r'^references$', r'^tài\s+liệu\s+tham\s+khảo$',
        r'^acknowledgements$', r'^lời\s+cảm\s+ơn$',
        r'^funding$', r'^tài\s+trợ$',
        r'^competing\s+interests$', r'^xung\s+đột\s+lợi\s+ích$',
        r'^data\s+availability$', r'^dữ\s+liệu\b',
        r'^appendix$', r'^phụ\s+lục$'
    ]
    for pat in headings:
        if re.search(pat, lower):
            return True
    return False

def is_table_like_text(text):
    trimmed = text.strip()
    if not trimmed:
        return False
    
    # Identify probable table cell alignment / formatting
    tokens = [t.strip() for t in re.split(r'\s{2,}', trimmed) if t.strip()]
    if len(tokens) >= 3:
        numeric_count = 0
        for t in tokens:
            if re.match(r'^\d+(\.\d+)?%?$', t) or t in ['%', '±', '-', '/'] or re.match(r'^[nN]\s*\(\d+\)$', t):
                numeric_count += 1
        if numeric_count >= 1 or len(trimmed) < 100:
            return True
            
    if re.match(r'^(\d+(\.\d+)?%?\s+){2,}\d+(\.\d+)?%?$', trimmed):
        return True
        
    return False

def determine_body_baseline(lines, height):
    sizes = []
    for line in lines:
        y0, y1 = line["y0"], line["y1"]
        if y0 < height * 0.12 or y1 > height * 0.88:
            continue
        if line["size"] < 5.0 or line["size"] > 24.0:
            continue
        sizes.append(line["size"])
        
    if not sizes:
        return 10.0
        
    sizes.sort()
    return sizes[len(sizes) // 2]

def sort_reading_order(lines, width):
    if not lines:
        return []
    
    # Sort lines vertically and group overlapping bands into left/right columns
    lines_sorted = sorted(lines, key=lambda l: (l["y0"], l["x0"]))
    mid = width / 2.0
    
    bands = []
    for line in lines_sorted:
        placed = False
        for band in bands:
            band_y0 = min(l["y0"] for l in band)
            band_y1 = max(l["y1"] for l in band)
            if not (line["y1"] < band_y0 + 2.0 or line["y0"] > band_y1 - 2.0):
                band.append(line)
                placed = True
                break
        if not placed:
            bands.append([line])
            
    has_two_columns = False
    left_count = sum(1 for l in lines if l["x1"] < mid - 10)
    right_count = sum(1 for l in lines if l["x0"] > mid + 10)
    if left_count > 5 and right_count > 5:
        has_two_columns = True
        
    sorted_lines = []
    if has_two_columns:
        left_lines = []
        right_lines = []
        for band in bands:
            band_left = [l for l in band if l["x1"] < mid + 10]
            band_right = [l for l in band if l["x0"] >= mid - 10]
            if band_left and band_right and max(l["x1"] for l in band_left) < min(l["x0"] for l in band_right):
                left_lines.extend(sorted(band_left, key=lambda l: l["y0"]))
                right_lines.extend(sorted(band_right, key=lambda l: l["y0"]))
            else:
                if left_lines or right_lines:
                    sorted_lines.extend(sorted(left_lines, key=lambda l: (l["y0"], l["x0"])))
                    sorted_lines.extend(sorted(right_lines, key=lambda l: (l["y0"], l["x0"])))
                    left_lines = []
                    right_lines = []
                sorted_lines.extend(sorted(band, key=lambda l: l["x0"]))
        if left_lines or right_lines:
            sorted_lines.extend(sorted(left_lines, key=lambda l: (l["y0"], l["x0"])))
            sorted_lines.extend(sorted(right_lines, key=lambda l: (l["y0"], l["x0"])))
    else:
        sorted_lines = sorted(lines, key=lambda l: (l["y0"], l["x0"]))
        
    return sorted_lines

def flush_block(lines, block_type, page_num):
    text_parts = []
    for l in lines:
        t = l["text"].strip()
        if not t:
            continue
        if text_parts:
            prev = text_parts[-1]
            # Hyphenation reconstruction
            if prev.endswith('-') and len(prev) > 1 and prev[-2].isalpha() and t[0].isalpha():
                text_parts[-1] = prev[:-1] + t
            else:
                text_parts.append(t)
        else:
            text_parts.append(t)
            
    joined_text = " ".join(text_parts)
    if block_type == "heading":
        joined_text = normalize_spaced_caps(joined_text)
        
    x0 = min(l["x0"] for l in lines)
    y0 = min(l["y0"] for l in lines)
    x1 = max(l["x1"] for l in lines)
    y1 = max(l["y1"] for l in lines)
    
    return {
        "blockType": block_type,
        "text": joined_text,
        "x0": x0, "y0": y0, "x1": x1, "y1": y1,
        "pageNumber": page_num + 1
    }

def reconstruct_layout(lines, width, height, page_num, doc_title, repeated_headers, repeated_footers, is_likely_heading_fn, is_caption_fn, is_list_item_fn, is_body_paragraph_fn, normalize_header_footer_fn, is_standalone_page_number_fn):
    sorted_lines = sort_reading_order(lines, width)
    body_font_size = determine_body_baseline(sorted_lines, height)
    
    in_front_matter_flow = (page_num == 0)
    has_seen_references = False
    reconstructed_blocks = []
    
    current_block = []
    current_type = None
    
    max_x1 = max(l["x1"] for l in sorted_lines) if sorted_lines else width
    
    # Pre-classify direct trigger blocks for the page
    page_triggers = []
    for l in sorted_lines:
        is_trig = (
            is_narrow_standalone_boilerplate(l["text"]) or
            is_broad_boilerplate_with_layout(l["text"], l["y0"], l["y1"], height, page_num) or
            matches_metadata_semantics(l["text"])
        )
        page_triggers.append(is_trig)
        
    for idx, line in enumerate(sorted_lines):
        text = line["text"]
        trimmed = text.strip()
        if not trimmed:
            continue
            
        y0, y1 = line["y0"], line["y1"]
        
        # Standalone margin markers
        if (y0 < height * 0.12 or y1 > height * 0.88) and is_standalone_page_number_fn(text):
            continue
            
        # Repeated headers/footers
        norm = normalize_header_footer_fn(text)
        if y0 < height * 0.12 and norm in repeated_headers:
            continue
        if y1 > height * 0.88 and norm in repeated_footers:
            continue
            
        text_normalized = normalize_spaced_caps(trimmed)
        
        # Terminate metadata front-matter flow
        is_main = is_main_content(text_normalized, is_likely_heading_fn, is_caption_fn, is_list_item_fn, is_body_paragraph_fn)
        if page_num == 0 and in_front_matter_flow and (is_main or (doc_title and doc_title.lower() in text.lower() and doc_title != "Tài liệu học thuật")):
            in_front_matter_flow = False
            
        # Heading classification
        is_heading = False
        is_academic = matches_academic_heading_semantics(text_normalized)
        is_numbered = re.match(r'^([A-Z]|\d+)(\.\d+)*\.?\s+[A-ZÀ-Ỹ]', text_normalized)
        is_bold_large = line["is_bold"] or line["size"] > body_font_size + 0.5
        is_short = len(text_normalized) < 120 and not text_normalized.endswith(('.', '?', '!'))
        
        if (is_academic or (is_numbered and is_bold_large)) and is_short and not is_table_like_text(text_normalized):
            is_heading = True
            
        # Reference section tracking
        if is_heading and text_normalized.lower() in ["references", "tài liệu tham khảo"]:
            has_seen_references = True
            
        # Segment semantic type
        line_type = "paragraph"
        if is_heading:
            line_type = "heading"
        elif is_table_like_text(text):
            line_type = "table"
        elif is_list_item_fn(trimmed):
            line_type = "list_item"
            
        # In references section, non-headings should be references
        if has_seen_references and line_type != "heading":
            line_type = "reference"
            
        # Metadata classification (trigger + flow)
        is_metadata = False
        is_direct_metadata = page_triggers[idx]
        is_flow_metadata = False
        if page_num == 0 and in_front_matter_flow:
            if not is_main and matches_metadata_evidence(text):
                for j, other in enumerate(sorted_lines):
                    if j != idx and page_triggers[j]:
                        gap = min(abs(y0 - other["y0"]), abs(y1 - other["y1"]))
                        if gap < 40.0:
                            is_flow_metadata = True
                            break
                            
        if is_direct_metadata or is_flow_metadata:
            is_metadata = True
            line_type = "metadata"
            
        starts_new = False
        if current_block:
            prev_line = current_block[-1]
            gap = y0 - prev_line["y1"]
            
            if gap > body_font_size * 1.5 or gap > 12.0:
                starts_new = True
            elif current_type != line_type:
                starts_new = True
            elif line_type == "heading":
                starts_new = True
            elif prev_line["x1"] < max_x1 - 35:
                if not (text_normalized and text_normalized[0].islower() and not is_heading):
                    starts_new = True
            elif prev_line["block_no"] != line["block_no"] and gap > 8.0:
                starts_new = True
                
        if starts_new and current_block:
            reconstructed_blocks.append(flush_block(current_block, current_type, page_num))
            current_block = [line]
            current_type = line_type
        else:
            if not current_block:
                current_type = line_type
            current_block.append(line)
            
    if current_block:
        reconstructed_blocks.append(flush_block(current_block, current_type, page_num))
        
    return reconstructed_blocks
