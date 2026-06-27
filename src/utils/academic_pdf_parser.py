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

# Heuristic helpers
def is_likely_heading(text):
    text = text.strip()
    if not text or len(text) > 120:
        return False
    
    # Common academic section names (case-insensitive)
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
        
    # Check numbered heading patterns
    if re.match(r'^\d+(\.\d+)*\s+[A-Z]', text):
        return True
    if re.match(r'^[I|V|X|L|C|D|M]+\.\s+[A-Z]', text):
        return True
    if re.match(r'^[A-Z]\.\s+[A-Z]', text):
        return True
    if re.match(r'^(section|mục|chương|chapter|bài|phần)\s+\d+', text, re.IGNORECASE):
        return True
        
    # All caps lines
    if text.isupper() and any(c.isalpha() for c in text) and len(text) > 3:
        return True
        
    return False

def is_list_item(text):
    text = text.strip()
    if re.match(r'^[-•\*+]\s+', text):
        return True
    if re.match(r'^\(?[a-zA-Z0-9]{1,4}\)\s+', text):  # matches (a) or a) or (1) or 1) up to 4 chars
        return True
    if re.match(r'^\[\d+\]\s+', text):
        return True
    if re.match(r'^\d+\.\s+', text) and not re.match(r'^\d+\.\d+', text):
        return True
    if re.match(r'^[a-zA-Z]\.\s+', text):  # matches a. or b.
        return True
    return False

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
    # If it has more than 15 words and ends with punctuation, it is likely a body paragraph
    has_end_punc = trimmed[-1] in {'.', '?', '!'}
    words = trimmed.split()
    if len(words) > 15 and has_end_punc:
        return True
    return False

def is_sidebar_metadata(text):
    return starts_with_metadata_prefix(text)
        
def looks_like_new_reference(line):
    line = line.strip()
    if not line:
        return False
    # Matches [1] or 1.
    if re.match(r'^\[\d+\]', line) or re.match(r'^\d+\.\s+', line):
        return True
    # Matches Author, A. or Author, Name
    if re.match(r'^[A-Z][a-zA-Z\s\-\.\,\&]+,\s+[A-Z]\.', line):
        return True
    if re.match(r'^[A-Z][a-zA-Z\s\-\.\,\&]+,\s+[A-Z][a-z]+', line):
        return True
    return False

def split_reference_text(text):
    import sys
    # Pattern 1: Insert newline before an author name followed by a year in parentheses (must be preceded by period or parenthesis)
    text = re.sub(r'([\.\)])\s+([A-Z][a-zA-Z\s\-]+,\s+[A-Z]\..{0,150}?\([12][0-9]{3}\))', r'\1\n\2', text)
    text = re.sub(r'([\.\)])\s+([A-Z][a-zA-Z\s\-]+,\s+[A-Z][a-z]+.{0,150}?\([12][0-9]{3}\))', r'\1\n\2', text)
    
    # Pattern 1b: Split before an author-year pattern if preceded by a DOI (case-insensitive, allows space/dots/slashes)
    text = re.sub(r'(\bdoi\b\s*[:\.\s]+\s*\S+(?:\s+\d[\d\.\/\-]*)*)\s+([A-Z][a-zA-Z\s\-]+,\s+[A-Z]\..{0,150}?\([12][0-9]{3}\))', r'\1\n\2', text, flags=re.IGNORECASE)
    text = re.sub(r'(\bdoi\b\s*[:\.\s]+\s*\S+(?:\s+\d[\d\.\/\-]*)*)\s+([A-Z][a-zA-Z\s\-]+,\s+[A-Z][a-z]+.{0,150}?\([12][0-9]{3}\))', r'\1\n\2', text, flags=re.IGNORECASE)
    
    # Pattern 2: Insert newline after a DOI if followed by a capitalized word
    text = re.sub(r'(doi:\s*\S+|doi\.org/\S+)\s+(?=[A-Z])', r'\1\n', text)
    
    # Pattern 3: Insert newline before list style references
    text = re.sub(r'\s+(?=\[\d+\])', '\n', text)
    text = re.sub(r'\s+(?=\d+\.\s+[A-Z])', '\n', text)

    lines = [line.strip() for line in text.split('\n')]
    lines = [line for line in lines if line]
    if not lines:
        return []
        
    entries = []
    current_entry = []
    
    for line in lines:
        starts_new = False
        if re.match(r'^\[\d+\]', line) or re.match(r'^\d+\.\s+', line):
            starts_new = True
        elif re.match(r'^[A-Z][a-zA-Z\s\-\.\,\&]+,\s+[A-Z]\.', line):
            starts_new = True
        elif re.match(r'^[A-Z][a-zA-Z\s\-\.\,\&]+,\s+[A-Z][a-z]+', line):
            starts_new = True
        elif current_entry and re.search(r'(doi\.org/\S+|doi:\s*\S+)$', current_entry[-1].lower()) and re.match(r'^[A-Z]', line):
            starts_new = True
        
        if starts_new and current_entry:
            entries.append(' '.join(current_entry))
            current_entry = [line]
        else:
            current_entry.append(line)
            
    if current_entry:
        entries.append(' '.join(current_entry))
        
    return [normalize_text(entry) for entry in entries if entry.strip()]

def normalize_text(text):
    if not text:
        return ""
    translations = {
        "ﬁ": "fi",
        "ﬂ": "fl",
        "ﬀ": "ff",
        "ﬃ": "ffi",
        "ﬄ": "ffl",
        "\ufb00": "ff",
        "\ufb01": "fi",
        "\ufb02": "fl",
        "\ufb03": "ffi",
        "\ufb04": "ffl"
    }
    for k, v in translations.items():
        text = text.replace(k, v)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def reflow_text(text):
    lines = [line.strip() for line in text.split('\n')]
    lines = [line for line in lines if line]
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
    
    final_text = result[0]
    return normalize_text(final_text)

def split_inline_enumerations(text):
    # Matches parenthesized letter/digit e.g. (a) or (1), preceded by space/punctuation/start
    matches1 = list(re.finditer(r'(?:^|\s|[\.,;\-\(\)])\(([a-zA-Z0-9])\)\s', text))
    # Matches right-parenthesized letter/digit e.g. a) or 1)
    matches2 = list(re.finditer(r'(?:^|\s|[\.,;\-\(\)])([a-zA-Z0-9])\)\s', text))
    # Matches dotted digit e.g. 1. or 2. (we only allow digits to avoid matching initials)
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
            # Safeguard: sequence must start with standard index indicators
            if first_val not in ["a", "b", "1", "2", "i", "ii"]:
                log_info(f"[LIST_DECISION] Did not split citation because markers were not sequential list markers: {[m['marker'] for m in longest_subseq]}")
                continue
                
            log_info(f"[LIST_DECISION] Split list because sequential markers {[m['marker'] for m in longest_subseq]} were detected.")
                
            parts = []
            first_marker = longest_subseq[0]
            pre_text = text[:first_marker["start"]].strip()
            if pre_text:
                parts.append({
                    "type": "paragraph",
                    "text": pre_text
                })
                
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
                    
                parts.append({
                    "type": "list_item",
                    "text": item_text
                })
                
            return parts
            
    if re.search(r'\([A-Z][a-zA-Z\s\-]+,\s+[12][0-9]{3}\)', text) or re.search(r'\([a-z\.\s,;0-9]*\b[12][0-9]{3}\b', text):
        log_info(f"[LIST_DECISION] Did not split citation because markers were not sequential list markers: '{text[:80]}...'")
    return None

def split_long_paragraph(text, max_len=1400, target_sentences=7):
    # Safe sentence splitter preventing splits inside DOIs, decimals, initials, or abbreviations
    pattern = re.compile(
        r'(?<!\b[A-Z]\.)'
        r'(?<!\b[A-Z][a-z]\.)'
        r'(?<!\bet al\.)'
        r'(?<!\be\.g\.)'
        r'(?<!\bi\.e\.)'
        r'(?<!\bvs\.)'
        r'(?<!\bfig\.)(?<!\bFig\.)'
        r'(?<!\bfigs\.)(?<!\bFigs\.)'
        r'(?<!\btab\.)(?<!\bTab\.)'
        r'(?<!\btabs\.)(?<!\bTabs\.)'
        r'(?<!\bvol\.)(?<!\bVol\.)'
        r'(?<!\bpp\.)'
        r'(?<!\bno\.)(?<!\bNo\.)'
        r'(?<!\bdr\.)(?<!\bDr\.)'
        r'(?<!\bprof\.)(?<!\bProf\.)'
        r'(?<!\beds\.)(?<!\bed\.)'
        r'(?<=\.|\?|\!)\s+(?=[A-Z])'
    )
    sentences = pattern.split(text)
    if len(sentences) <= 1:
        return [text]
        
    paragraphs = []
    current_para = []
    current_len = 0
    current_sentences_count = 0
    
    transition_words = {
        "However,", "Therefore,", "Furthermore,", "In addition,", "As a consequence,",
        "For instance,", "Thus,", "Hence,", "Moreover,", "From this perspective,",
        "According to"
    }
    
    for sen in sentences:
        sen_strip = sen.strip()
        if not sen_strip:
            continue
            
        should_split = False
        if current_para:
            if current_len > 1200:
                should_split = True
            elif current_len + len(sen_strip) > 1500:
                should_split = True
                
        if should_split:
            paragraphs.append(" ".join(current_para))
            current_para = [sen_strip]
            current_len = len(sen_strip)
            current_sentences_count = 1
        else:
            current_para.append(sen_strip)
            current_len += len(sen_strip) + 1
            current_sentences_count += 1
            
    if current_para:
        paragraphs.append(" ".join(current_para))
        
    return paragraphs

def split_block_into_subblocks(block, page_dict):
    x0, y0, x1, y1, text, block_no, block_type = block
    if block_type != 0:
        return [block]
        
    # Query line-level coordinates, sizes and bold statuses from page dict
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
            geom_lines.append({
                "x0": lx0,
                "y0": ly0,
                "x1": lx1,
                "y1": ly1,
                "text": line_text,
                "size": avg_size,
                "is_bold": is_bold
            })
            
    paragraphs_text = []
    
    if geom_lines:
        gaps = []
        line_heights = []
        for i in range(1, len(geom_lines)):
            gaps.append(geom_lines[i]["y0"] - geom_lines[i-1]["y1"])
        for line in geom_lines:
            line_heights.append(line["y1"] - line["y0"])
            
        median_lh = sorted(line_heights)[len(line_heights)//2] if line_heights else 10.0
        median_gap = sorted(gaps)[len(gaps)//2] if gaps else 3.0
        max_line_x1 = max(line["x1"] for line in geom_lines) if geom_lines else x1
        
        current_para = []
        transition_words = {
            "However,", "Therefore,", "Furthermore,", "In addition,", "As a consequence,",
            "For instance,", "Thus,", "Hence,", "Moreover,", "From this perspective,",
            "According to"
        }
        
        for i, line in enumerate(geom_lines):
            trimmed = line["text"].strip()
            if not trimmed:
                if current_para:
                    paragraphs_lines_raw = "\n".join(l["text"] for l in current_para)
                    p_reflowed = reflow_text(paragraphs_lines_raw)
                    if p_reflowed:
                        paragraphs_text.append(p_reflowed)
                    current_para = []
                continue
                
            starts_new = False
            if current_para:
                prev = current_para[-1]
                gap = line["y0"] - prev["y1"]
                
                score = 0
                reasons = []
                strong_reasons = []
                
                # Gap checks
                if gap > median_gap + 5.0:
                    score += 6
                    reasons.append("large_gap")
                    strong_reasons.append("large_gap")
                elif gap > median_gap + 2.5:
                    score += 3
                    reasons.append("moderate_gap")
                    # Since we are inside a single block, there is no block boundary.
                    # Hence moderate_gap is treated as weak evidence (no strong_reasons).
                    
                # Indentation shift
                if line["x0"] > prev["x0"] + 8:
                    score += 4
                    reasons.append("indentation")
                    strong_reasons.append("indentation")
                    
                # Heading boundary
                if is_likely_heading(trimmed):
                    score += 10
                    reasons.append("heading_boundary")
                    strong_reasons.append("heading_boundary")
                    
                # List marker
                if is_list_item(trimmed):
                    score += 6
                    reasons.append("list_marker")
                    strong_reasons.append("list_marker")
                    
                # Reference boundary
                if "references" in trimmed.lower() or "tài liệu tham khảo" in trimmed.lower():
                    score += 10
                    reasons.append("reference_boundary")
                    strong_reasons.append("reference_boundary")
                
                # Long paragraph guard
                current_para_len = sum(len(l["text"]) for l in current_para)
                if current_para_len > 1200:
                    score += 6
                    reasons.append("long_paragraph_guard")
                    strong_reasons.append("long_paragraph_guard")
                    
                # Weak reasons
                # prev_short_line
                prev_short = prev["x1"] < max_line_x1 - 20
                if prev_short:
                    score += 2
                    reasons.append("prev_short_line")
                    
                # transition_phrase
                starts_with_transition = False
                for tw in transition_words:
                    if trimmed.startswith(tw):
                        starts_with_transition = True
                        break
                if starts_with_transition:
                    score += 2
                    reasons.append("transition_phrase")
                    
                # capitalization
                if trimmed and trimmed[0].isupper():
                    score += 1
                    reasons.append("capitalization")
                    
                # Inhibitors
                if prev["text"].strip().endswith('-'):
                    score -= 5
                    reasons.append("prev_ends_hyphen")
                if trimmed and trimmed[0].islower():
                    score -= 5
                    reasons.append("starts_lowercase")
                    
                # Decision rule
                starts_new = (score >= 6 and len(strong_reasons) > 0)
                
                prev_snippet = prev["text"].strip()[:40]
                curr_snippet = trimmed[:40]
                if starts_new:
                    log_info(f"[SPLIT_DECISION] Split because reasons were {reasons} (score={score}, strong={strong_reasons}). Prev: '{prev_snippet}' | Curr: '{curr_snippet}'")
                else:
                    log_info(f"[SPLIT_DECISION] Kept same paragraph because reasons were only {reasons} (score={score}, no strong evidence). Prev: '{prev_snippet}' | Curr: '{curr_snippet}'")
                        
            if starts_new and current_para:
                paragraphs_lines_raw = "\n".join(l["text"] for l in current_para)
                p_reflowed = reflow_text(paragraphs_lines_raw)
                if p_reflowed:
                    paragraphs_text.append(p_reflowed)
                current_para = [line]
            else:
                current_para.append(line)
                
        if current_para:
            paragraphs_lines_raw = "\n".join(l["text"] for l in current_para)
            p_reflowed = reflow_text(paragraphs_lines_raw)
            if p_reflowed:
                paragraphs_text.append(p_reflowed)
    else:
        # Fallback text-only segmentation
        lines = [line.strip() for line in text.split('\n')]
        current_para = []
        
        transition_words = {
            "However,", "Therefore,", "Furthermore,", "In addition,", "As a consequence,",
            "For instance,", "Thus,", "Hence,", "Moreover,", "From this perspective,",
            "According to"
        }
        
        for line in lines:
            trimmed = line.strip()
            if not trimmed:
                if current_para:
                    p_text = reflow_text("\n".join(current_para))
                    if p_text:
                        paragraphs_text.append(p_text)
                    current_para = []
                continue
                
            starts_new = False
            if current_para:
                prev = current_para[-1].strip()
                
                score = 0
                reasons = []
                strong_reasons = []
                
                if is_likely_heading(trimmed):
                    score += 10
                    reasons.append("heading_boundary")
                    strong_reasons.append("heading_boundary")
                    
                if is_list_item(trimmed):
                    score += 6
                    reasons.append("list_marker")
                    strong_reasons.append("list_marker")

                if "references" in trimmed.lower() or "tài liệu tham khảo" in trimmed.lower():
                    score += 10
                    reasons.append("reference_boundary")
                    strong_reasons.append("reference_boundary")
                    
                current_para_len = sum(len(l) for l in current_para)
                if current_para_len > 1200:
                    score += 6
                    reasons.append("long_paragraph_guard")
                    strong_reasons.append("long_paragraph_guard")
                    
                starts_with_transition = False
                for tw in transition_words:
                    if trimmed.startswith(tw):
                        starts_with_transition = True
                        break
                if starts_with_transition:
                    score += 2
                    reasons.append("transition_phrase")
                    
                if trimmed and trimmed[0].isupper():
                    score += 1
                    reasons.append("capitalization")
                    
                if prev.endswith('-'):
                    score -= 5
                    reasons.append("prev_ends_hyphen")
                if trimmed and trimmed[0].islower():
                    score -= 5
                    reasons.append("starts_lowercase")
                    
                starts_new = (score >= 6 and len(strong_reasons) > 0)
                    
            if starts_new and current_para:
                p_text = reflow_text("\n".join(current_para))
                if p_text:
                    paragraphs_text.append(p_text)
                current_para = [line]
            else:
                current_para.append(line)
                
        if current_para:
            p_text = reflow_text("\n".join(current_para))
            if p_text:
                paragraphs_text.append(p_text)
                
    final_blocks_text = []
    
    for p_text in paragraphs_text:
        inline_parts = split_inline_enumerations(p_text)
        if inline_parts:
            for part in inline_parts:
                if part["type"] == "paragraph":
                    guard_parts = split_long_paragraph(part["text"])
                    for gp in guard_parts:
                        final_blocks_text.append({
                            "text": gp,
                            "type": "paragraph"
                        })
                else:
                    final_blocks_text.append({
                        "text": part["text"],
                        "type": "list_item"
                    })
        else:
            guard_parts = split_long_paragraph(p_text)
            for gp in guard_parts:
                final_blocks_text.append({
                    "text": gp,
                    "type": "paragraph"
                })
                
    subblocks = []
    total_len = sum(len(part["text"]) for part in final_blocks_text)
    if total_len == 0:
        total_len = 1
        
    current_y = y0
    for part in final_blocks_text:
        part_text = part["text"]
        part_len = len(part_text)
        y_span = (y1 - y0) * part_len / total_len
        part_y0 = current_y
        part_y1 = current_y + y_span
        current_y = part_y1
        
        subblocks.append((x0, part_y0, x1, part_y1, part_text, block_no, block_type))
        
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
            bands.append({
                "type": "columns",
                "y_start": last_y,
                "y_end": sep_y0,
                "blocks": []
            })
        bands.append({
            "type": "separator",
            "y_start": sep_y0,
            "y_end": sep_y1,
            "block": sep
        })
        last_y = sep_y1
        
    bands.append({
        "type": "columns",
        "y_start": last_y,
        "y_end": float('inf'),
        "blocks": []
    })
    
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
                
            # Split col_blocks into horizontal sub-bands based on vertical gaps
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
                
            # Process each horizontal sub-band by column sorting
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
        print(json.dumps({
            "success": False,
            "errorCode": "INVALID_ARGUMENTS",
            "errorDetail": "PDF file path required"
        }))
        sys.exit(1)

    pdf_path = sys.argv[1]
    if not os.path.exists(pdf_path):
        log_error(f"PDF file does not exist: {pdf_path}")
        print(json.dumps({
            "success": False,
            "errorCode": "FILE_NOT_FOUND",
            "errorDetail": "PDF file not found"
        }))
        sys.exit(1)

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        log_error(f"Failed to open PDF with PyMuPDF: {str(e)}")
        print(json.dumps({
            "success": False,
            "errorCode": "PDF_OPEN_FAILED",
            "errorDetail": str(e)
        }))
        sys.exit(1)

    try:
        sections = []
        section_index = 0
        in_references = False
        in_abstract = False
        in_metadata_flow = False
        
        has_structured_references = False
        has_detected_sections = False
        
        total_word_count = 0
        total_char_count = 0

        log_info(f"Starting extraction for PDF with {len(doc)} pages.")

        for page_num in range(len(doc)):
            in_metadata_flow = False
            page = doc[page_num]
            rect = page.rect
            width = rect.width
            height = rect.height
            
            # 1. Extract layout blocks
            raw_blocks = page.get_text("blocks")
            
            # Reconstruct page dictionary once per page to query lines and sizes
            page_dict = page.get_text("dict")
            
            # Split blocks into subblocks if they contain list items / paragraph splits
            split_raw_blocks = []
            for b in raw_blocks:
                split_raw_blocks.extend(split_block_into_subblocks(b, page_dict))
            
            # 2. Filter headers and footers based on coordinates
            # Bottom 8% margin is filtered on all pages.
            # Top 8% margin is filtered on pages > 0 (to avoid discarding title on page 1).
            filtered_blocks = []
            for b in split_raw_blocks:
                x0, y0, x1, y1, text, block_no, block_type = b
                
                # Skip non-text blocks
                if block_type != 0:
                    continue
                    
                # Header filter
                if page_num > 0 and y0 < height * 0.08:
                    continue
                # Footer filter
                if y1 > height * 0.92:
                    continue
                    
                filtered_blocks.append(b)

            # 3. Sort page blocks for two-column support
            sorted_blocks = sort_page_blocks(filtered_blocks, width)

            # 4. Classify and process each block
            for b in sorted_blocks:
                x0, y0, x1, y1, text, block_no, block_type = b
                text_raw = text.strip()
                if not text_raw:
                    continue
                
                # Heuristic cleanups
                text_cleaned = reflow_text(text)
                if not text_cleaned:
                    continue
                    
                # Generic metadata flow state machine (Correction 3)
                stype = "paragraph"
                if starts_with_metadata_prefix(text_cleaned):
                    in_metadata_flow = True
                    stype = "metadata"
                elif in_metadata_flow:
                    if is_likely_heading(text_cleaned):
                        in_metadata_flow = False
                    elif is_list_item(text_cleaned) or is_caption(text_cleaned):
                        in_metadata_flow = False
                    elif is_body_paragraph(text_cleaned):
                        in_metadata_flow = False
                    else:
                        stype = "metadata"
                    
                word_count = len(text_cleaned.split())
                char_count = len(text_cleaned)
                
                total_word_count += word_count
                total_char_count += char_count

                # Determine type
                style_data = None
                
                # Check for figure/table DOI link
                doi_fig_table = detect_doi_fig_table(text_cleaned) if stype != "metadata" else None
                if stype == "metadata":
                    pass
                elif doi_fig_table:
                    stype = doi_fig_table["type"]
                    style_data = {
                        "doiUrl": doi_fig_table["doiUrl"],
                        "extractionStatus": "placeholder_only",
                        "bbox": [x0, y0, x1, y1]
                    }
                else:
                    # If we are in references, check if this looks like a new heading that ends references
                    # If we are in references, check if this looks like a new heading that ends references
                    if in_references:
                        lower_clean = text_cleaned.lower().rstrip('.')
                        is_main_heading = False
                        main_section_titles = {
                            'introduction', 'methods', 'methodology', 'results', 'discussion',
                            'conclusion', 'conclusions', 'abstract', 'introduction and method',
                            'tóm tắt', 'giới thiệu', 'phương pháp', 'kết quả', 'thảo luận', 'kết luận'
                        }
                        if lower_clean in main_section_titles:
                            is_main_heading = True
                        elif re.match(r'^\d+(\.\d+)*\s+[A-Z]', text_cleaned):
                            is_main_heading = True
                        elif re.match(r'^[I|V|X|L|C|D|M]+\.\s+[A-Z]', text_cleaned):
                            is_main_heading = True
                            
                        if is_main_heading:
                            in_references = False
                            stype = "heading"
                            has_detected_sections = True

                    # Check references section trigger
                    if not in_references:
                        # Check if this looks like a references heading
                        lower_clean = text_cleaned.lower().rstrip('.')
                        if is_likely_heading(text_cleaned) and ('references' in lower_clean or 'tài liệu tham khảo' in lower_clean):
                            in_references = True
                            stype = "heading"
                            has_detected_sections = True
                    
                    if in_references:
                        if stype != "heading":
                            ref_items = split_reference_text(text_cleaned)
                            if ref_items:
                                for idx, item in enumerate(ref_items):
                                    if idx == 0 and sections and sections[-1]["sectionType"] == "reference_item" and not looks_like_new_reference(item):
                                        sections[-1]["text"] += " " + item
                                        sections[-1]["pageEnd"] = page_num + 1
                                    else:
                                        sec_payload = {
                                            "sectionIndex": section_index,
                                            "sectionType": "reference_item",
                                            "text": item,
                                            "pageStart": page_num + 1,
                                            "pageEnd": page_num + 1
                                        }
                                        sections.append(sec_payload)
                                        section_index += 1
                                has_structured_references = True
                            continue
                    else:
                        # Check abstract markers
                        if page_num == 0:
                            lower_clean = text_cleaned.lower().rstrip('.')
                            if is_likely_heading(text_cleaned) and ('abstract' in lower_clean or 'tóm tắt' in lower_clean):
                                in_abstract = True
                                stype = "heading"
                                has_detected_sections = True
                            elif in_abstract:
                                # Abstract content blocks usually appear in the first page
                                # If we hit an Introduction heading, abstract is done
                                if is_likely_heading(text_cleaned) and ('introduction' in lower_clean or 'giới thiệu' in lower_clean):
                                    in_abstract = False
                                    stype = "heading"
                                    has_detected_sections = True
                                else:
                                    stype = "abstract"
                            else:
                                # Page 1 title classification
                                # Heuristic: First few full-width blocks on page 1 with larger font / first position
                                if section_index <= 2 and (x0 < width * 0.3) and (x1 > width * 0.7) and len(text_cleaned) < 250:
                                    stype = "title"
                        
                        # Check headings, lists, captions if not already special type
                        if stype == "paragraph":
                            if is_likely_heading(text_cleaned):
                                stype = "heading"
                                has_detected_sections = True
                            elif is_caption(text_cleaned):
                                lower_clean = text_cleaned.lower()
                                if lower_clean.startswith(('table', 'bảng')):
                                    stype = "table"
                                else:
                                    stype = "figure"
                                style_data = {
                                    "extractionStatus": "placeholder_only",
                                    "bbox": [x0, y0, x1, y1]
                                }
                            elif is_list_item(text_cleaned):
                                stype = "list_item"

                # Check merge with previous section if continuing a sentence/paragraph (restrict current to non-list paragraphs)
                merged = False
                if (sections and 
                    stype in ["paragraph", "abstract", "metadata"] and 
                    sections[-1]["sectionType"] in ["paragraph", "list_item", "abstract", "title", "metadata"] and
                    text_cleaned and text_cleaned[0].islower()):
                    
                    sections[-1]["text"] += " " + text_cleaned
                    sections[-1]["pageEnd"] = page_num + 1
                    merged = True
                
                if not merged:
                    sec_payload = {
                        "sectionIndex": section_index,
                        "sectionType": stype,
                        "text": text_cleaned,
                        "pageStart": page_num + 1,
                        "pageEnd": page_num + 1
                    }
                    if style_data:
                        sec_payload["style"] = style_data

                    sections.append(sec_payload)
                    section_index += 1

        doc.close()

        # REFERENCES ordering guard and quality gate checks
        is_reordered = False
        has_merged_references = False
        has_huge_paragraphs = False
        
        for sec in sections:
            word_len = len(sec["text"].split())
            char_len = len(sec["text"])
            if sec["sectionType"] == "paragraph" and (word_len > 1500 or char_len > 8000):
                has_huge_paragraphs = True
            if sec["sectionType"] == "reference_item" and char_len > 1200:
                has_merged_references = True

        # Check references order vs main end-matter blocks (Conclusion, Contributions, etc.)
        ref_indices = []
        for idx, sec in enumerate(sections):
            stype = sec["sectionType"]
            text = sec["text"].lower()
            is_ref_heading = (stype == "heading" and ('references' in text or 'tài liệu tham khảo' in text))
            is_ref_item = (stype == "reference_item")
            if is_ref_heading or is_ref_item:
                ref_indices.append(idx)
                
        if ref_indices:
            first_ref_idx = ref_indices[0]
            has_main_section_after_ref = False
            for idx in range(first_ref_idx + 1, len(sections)):
                if idx not in ref_indices:
                    stype = sections[idx]["sectionType"]
                    if stype in ["heading", "paragraph", "list_item", "abstract"]:
                        has_main_section_after_ref = True
                        break
            
            if has_main_section_after_ref:
                is_reordered = True
                ref_sections = [sections[idx] for idx in ref_indices]
                non_ref_sections = [sec for idx, sec in enumerate(sections) if idx not in ref_indices]
                
                reordered_sections = non_ref_sections + ref_sections
                for idx, sec in enumerate(reordered_sections):
                    sec["sectionIndex"] = idx
                sections = reordered_sections

        # Determine overall quality
        quality = "medium"
        if has_detected_sections and has_structured_references:
            quality = "high"
        elif not has_detected_sections and not has_structured_references:
            quality = "low"

        ocr_needed = False
        warnings = []
        if total_char_count < 100:
            ocr_needed = True
            warnings.append("Tài liệu có vẻ là PDF quét hoặc hình ảnh, cần xử lý OCR để tạo bản đọc thông minh.")
            quality = "low"

        if is_reordered or has_merged_references or has_huge_paragraphs or ocr_needed:
            quality = "low"
            warning_msg = "Bản đọc thông minh có thể chưa giữ đúng thứ tự/bố cục gốc. Hãy xem tab Bản gốc để đối chiếu."
            if warning_msg not in warnings:
                warnings.append(warning_msg)
        else:
            warnings.append("Bản đọc thông minh có thể chưa giữ đúng bố cục gốc. Hãy xem tab Bản gốc để đối chiếu.")

        output = {
            "success": True,
            "engine": "pymupdf",
            "quality": quality,
            "structureVersion": "pymupdf-v1",
            "hasStructuredReferences": has_structured_references or bool(ref_indices),
            "hasDetectedSections": has_detected_sections,
            "wordCount": total_word_count,
            "characterCount": total_char_count,
            "ocrNeeded": ocr_needed,
            "warnings": warnings,
            "sections": sections
        }

        # Output pure JSON to stdout
        print(json.dumps(output))

    except Exception as e:
        log_error(f"Unexpected exception during PDF extraction: {str(e)}")
        log_error(traceback.format_exc())
        print(json.dumps({
            "success": False,
            "errorCode": "UNEXPECTED_ERROR",
            "errorDetail": str(e)
        }))
        sys.exit(1)

if __name__ == "__main__":
    main()
