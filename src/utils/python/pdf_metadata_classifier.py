import re

# Compiled patterns
NARROW_BOILERPLATE_PATTERNS = [
    re.compile(p) for p in [
        r'^contents\s+lists\s+available\s+at\s+sciencedirect\b',
        r'^journal\s+homepage:\s*www\.',
        r'^journal\s+homepage:\s*elsevier',
        r'^www\.elsevier\.com/locate/\w+',
        r'^available\s+online\s+at\s+www\.',
        r'^sciencedirect$',
        r'^elsevier$'
    ]
]

BROAD_BOILERPLATE_PATTERNS = [
    re.compile(p) for p in [
        r'\bpublished\s+by\b',
        r'\bxuất\s+bản\s+bởi\b',
        r'\bnhà\s+xuất\s+bản\b',
        r'copyright\s+©',
        r'©\s*copyright',
        r'\bbản\s+quyền\b',
        r'\ball\s+rights\s+reserved\b',
        r'\bmọi\s+quyền\s+được\s+bảo\s+lưu\b',
        r'\bopen\s+access\s+article\s+under\b',
        r'\bcreative\s+commons\b',
        r'\bbài\s+viết\s+truy\s+cập\s+mở\b',
        r'\breprints\s+and\s+permissions\b',
        r'\bquyền\s+sử\s+dụng\b',
        r'\bxin\s+phép\s+sử\s+dụng\b'
    ]
]

METADATA_SEMANTIC_PATTERNS = [
    re.compile(p) for p in [
        r'\bcorrespond(ence|ing\s+author)\b',
        r'\btác\s+giả\s+liên\s+hệ\b',
        r'\bliên\s+hệ\b',
        r'\be-?mail\s+address\b',
        r'\bđịa\s+chỉ\s+thư\s+điện\s+tử\b',
        r'\breceived\s+\d+\s+[a-z]+\s+\d{4}',
        r'\brevised\s+\d+\s+[a-z]+\s+\d{4}',
        r'\baccepted\s+\d+\s+[a-z]+\s+\d{4}',
        r'\bngày\s+nhận\s+bài\b',
        r'\bngày\s+sửa\s+bài\b',
        r'\bngày\s+chấp\s+nhận\b',
        r'\bavailable\s+online\b',
        r'\bpublished\s+online\b',
        r'\bxuất\s+bản\s+trực\s+tuyến\b',
        r'\bissn\s+\d{4}-\d{3}[\dxX]\b',  # Corrected invalid escaping sequence
        r'\bjournal\s+homepage\b',
        r'\btrang\s+chủ\s+tạp\s+chí\b',
        r'\barticle\s+info\b',
        r'\bthông\s+tin\s+bài\s+báo\b'
    ]
]

METADATA_EVIDENCE_PATTERNS = [
    re.compile(p) for p in [
        r'\bcorrespond(ence|ing|ent)\b',
        r'\be-?mail\b',
        r'\baddress\b',
        r'@',
        r'\bcontact\b',
        r'\bliên\s+hệ\b',
        r'\bthư\s+điện\s+tử\b',
        r'\breceived\b',
        r'\brevised\b',
        r'\baccepted\b',
        r'\bpublished\b',
        r'\bngày\s+nhận\b',
        r'\bngày\s+sửa\b',
        r'\bngày\s+chấp\s+nhận\b',
        r'\bxuất\s+bản\b',
        r'\b\d{4}\b',
        r'\bissn\b',
        r'\bisbn\b',
        r'\bdoi\b',
        r'copyright',
        r'©',
        r'bản\s+quyền',
        r'license',
        r'giấy\s+phép',
        r'creative\s+commons',
        r'publisher',
        r'nhà\s+xuất\s+bản',
        r'https?://',
        r'www\.'
    ]
]

MAIN_CONTENT_PATTERNS = [
    re.compile(p) for p in [
        r'^abstract$', r'^tóm\s+tắt$',
        r'^keywords\b', r'^từ\s+khóa\b',
        r'^introduction$', r'^giới\s+thiệu$',
        r'^references$', r'^tài\s+liệu\s+tham\s+khảo$'
    ]
]

# Classifier Helpers
def is_narrow_standalone_boilerplate(text):
    trimmed = text.strip()
    if not trimmed or len(trimmed) > 180:
        return False
    lower = trimmed.lower()
    for pat in NARROW_BOILERPLATE_PATTERNS:
        if pat.search(lower):
            return True
    return False

def is_broad_boilerplate_with_layout(text, y0, y1, height, page_num):
    trimmed = text.strip()
    if not trimmed or len(trimmed) > 180:
        return False
    
    in_top_margin = y0 < height * 0.12
    in_bottom_margin = y1 > height * 0.88
    in_first_page_metadata_band = (page_num == 0 and y0 < height * 0.22)
    
    if not (in_top_margin or in_bottom_margin or in_first_page_metadata_band):
        return False

    lower = trimmed.lower()
    for pat in BROAD_BOILERPLATE_PATTERNS:
        if pat.search(lower):
            return True
    return False

def matches_metadata_semantics(text):
    trimmed = text.strip()
    if not trimmed or len(trimmed) > 180:
        return False
    lower = trimmed.lower()
    
    if '@' in lower and ('email' in lower or 'e-mail' in lower or 'contact' in lower or 'liên hệ' in lower):
        return True

    for pat in METADATA_SEMANTIC_PATTERNS:
        if pat.search(lower):
            return True
    return False

def matches_metadata_evidence(text):
    trimmed = text.strip()
    if not trimmed or len(trimmed) > 180:
        return False
    lower = trimmed.lower()
    for pat in METADATA_EVIDENCE_PATTERNS:
        if pat.search(lower):
            return True
    return False

def is_main_content(text, is_likely_heading_fn, is_caption_fn, is_list_item_fn, is_body_paragraph_fn):
    trimmed = text.strip()
    if not trimmed:
        return False
    lower = trimmed.lower()
    
    if is_likely_heading_fn(trimmed):
        return True
    if is_caption_fn(trimmed):
        return True
    if is_list_item_fn(trimmed):
        return True
    
    # Credible body paragraph
    if is_body_paragraph_fn(trimmed) and len(trimmed) > 120:
        return True
        
    for pat in MAIN_CONTENT_PATTERNS:
        if pat.search(lower):
            return True
            
    return False
