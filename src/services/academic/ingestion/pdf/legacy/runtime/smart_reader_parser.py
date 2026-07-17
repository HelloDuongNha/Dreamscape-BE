#!/usr/bin/env python3
import sys
import os
import json
import re
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdf_metadata_classifier import (
    is_narrow_standalone_boilerplate,
    is_broad_boilerplate_with_layout,
    matches_metadata_semantics,
    matches_metadata_evidence,
    is_main_content as is_main_content_impl
)
from pdf_layout_reconstructor import reconstruct_layout

def is_main_content(text):
    return is_main_content_impl(text, is_likely_heading, is_caption, is_list_item, is_body_paragraph)

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

def normalize_header_footer(text):
    if not text:
        return ""
    text = text.lower().strip()
    # Normalize running header/footer page patterns like "page 1", "trang 2", "p. 3", "page 4 of 10" safely
    # by replacing the numeric sequence with a token "#".
    text = re.sub(r'\b(page|trang|p|pp)\.?\s*\d+(\s*(of|/)\s*\d+)?\b', r'\1 #', text)
    # Also normalize trailing or leading standalone page numbers
    text = re.sub(r'^\d+$', '#', text)
    text = re.sub(r'\s*\d+\s*$', ' #', text)
    text = re.sub(r'^\s*\d+\s*', '# ', text)
    
    # Strip punctuation, keeping alphanumeric characters and "#"
    text = re.sub(r'[^\w\s#]', '', text)
    return " ".join(text.split())

def is_standalone_page_number(text):
    trimmed = text.strip()
    if not trimmed:
        return False
    lower = trimmed.lower()
    # Matches patterns like "1", "Page 1", "Page 1 of 12", "1 / 12", "p. 1", "page 12"
    if re.match(r'^(page|trang|p|pp)?\.?\s*\d+(\s*(of|/)\s*\d+)?$', lower):
        return True
    if re.match(r'^(page|trang|p|pp)?\.?\s*[ivxlc]+$', lower):
        return True
    if re.match(r'^\d+$', trimmed):
        return True
    return False

# Extracted helpers are imported from pdf_metadata_classifier.py

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

def extract_page_lines(page):
    page_dict = page.get_text("dict")
    lines = []
    block_no = 0
    for b in page_dict.get("blocks", []):
        if b.get("type") != 0 or "lines" not in b:
            continue
        for line_dict in b["lines"]:
            span_texts = []
            avg_size = 0.0
            is_bold = False
            spans = line_dict.get("spans", [])
            if spans:
                span_texts = [span["text"] for span in spans]
                avg_size = sum(span["size"] for span in spans) / len(spans)
                is_bold = any((span["flags"] & 16) or "bold" in span["font"].lower() for span in spans)
            line_text = "".join(span_texts)
            lx0, ly0, lx1, ly1 = line_dict["bbox"]
            lines.append({
                "x0": lx0, "y0": ly0,
                "x1": lx1, "y1": ly1,
                "text": line_text,
                "size": avg_size,
                "is_bold": is_bold,
                "block_no": block_no
            })
        block_no += 1
    return lines

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

        log_info(f"Starting parsing for PDF: {pdf_path}")

        # Deduplication Pre-pass: Collect top and bottom candidate blocks across all pages
        top_candidates = {}
        bottom_candidates = {}

        for page_num in range(len(doc)):
            page = doc[page_num]
            rect = page.rect
            height = rect.height
            
            lines = extract_page_lines(page)
            for line in lines:
                text = line["text"]
                if not text.strip():
                    continue
                
                norm = normalize_header_footer(text)
                if not norm:
                    continue
                
                # Check top region (top 12%)
                if line["y0"] < height * 0.12:
                    if norm not in top_candidates:
                        top_candidates[norm] = set()
                    top_candidates[norm].add(page_num)
                
                # Check bottom region (bottom 12%)
                if line["y1"] > height * 0.88:
                    if norm not in bottom_candidates:
                        bottom_candidates[norm] = set()
                    bottom_candidates[norm].add(page_num)

        repeated_headers = {norm for norm, pages in top_candidates.items() if len(pages) >= 2}
        repeated_footers = {norm for norm, pages in bottom_candidates.items() if len(pages) >= 2}

        # Main Ingestion Pass
        for page_num in range(len(doc)):
            page = doc[page_num]
            rect = page.rect
            width, height = rect.width, rect.height
            
            lines = extract_page_lines(page)
            
            # Delegate layout reconstruction to pdf_layout_reconstructor
            reconstructed_blocks = reconstruct_layout(
                lines, width, height, page_num, doc_title,
                repeated_headers, repeated_footers,
                is_likely_heading, is_caption, is_list_item, is_body_paragraph,
                normalize_header_footer, is_standalone_page_number
            )

            for b in reconstructed_blocks:
                stype = b["blockType"]
                text_cleaned = b["text"].strip()
                if not text_cleaned:
                    continue

                total_word_count += len(text_cleaned.split())
                total_char_count += len(text_cleaned)

                marker_val = None
                html_val = None

                if stype == "list_item":
                    marker_val, clean_body = extract_list_marker(text_cleaned)
                    text_cleaned = clean_body
                elif stype == "heading":
                    has_detected_sections = True
                
                # Check DOI fig/table
                doi_fig_table = detect_doi_fig_table(text_cleaned)
                if doi_fig_table:
                    stype = doi_fig_table["type"]
                    html_val = f"<div class=\"{stype}-placeholder\">{text_cleaned}</div>"

                # Check inline lists within body paragraphs to preserve list marker behavior
                if stype == "paragraph":
                    inline_parts = split_inline_enumerations(text_cleaned)
                    if inline_parts:
                        for part in inline_parts:
                            ptype = part["type"]
                            ptext = part["text"].strip()
                            pmarker = None
                            if ptype == "list_item":
                                pmarker, ptext = extract_list_marker(ptext)
                            raw_blocks_flow.append({
                                "blockType": ptype,
                                "text": ptext,
                                "marker": pmarker,
                                "html": None,
                                "pageNumber": page_num + 1
                            })
                        continue

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
        section_order = 0

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
            if not current_section:
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
