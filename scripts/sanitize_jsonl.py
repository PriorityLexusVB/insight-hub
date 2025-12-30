import json, sys

def scrub(s: str) -> str:
    # Replace any surrogate code points (invalid in strict JSON) with U+FFFD
    return "".join("\uFFFD" if 0xD800 <= ord(ch) <= 0xDFFF else ch for ch in s)

def scrub_obj(x):
    if isinstance(x, str):
        return scrub(x)
    if isinstance(x, list):
        return [scrub_obj(v) for v in x]
    if isinstance(x, dict):
        return {k: scrub_obj(v) for k, v in x.items()}
    return x

if len(sys.argv) != 3:
    print("Usage: python3 scripts/sanitize_jsonl.py <in.jsonl> <out.jsonl>", file=sys.stderr)
    sys.exit(1)

inp, outp = sys.argv[1], sys.argv[2]
bad = 0
with open(inp, "r", encoding="utf-8", errors="replace") as r, open(outp, "w", encoding="utf-8") as w:
    for i, line in enumerate(r, 1):
        line = line.rstrip("\n")
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            bad += 1
            continue
        obj = scrub_obj(obj)
        w.write(json.dumps(obj, ensure_ascii=False) + "\n")

print(f"sanitized_ok=1 bad_lines_skipped={bad} out={outp}")
