#!/usr/bin/env python3
"""
Build a single PDF containing ONLY the per-device documentation.

Pipeline:  markdown -> (clean + emoji substitution) -> pandoc HTML -> WeasyPrint PDF

Every tunable lives in CONFIG — no literals scattered through the code.
"""

import html
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

# ─────────────────────────────────────────────────────────────
# CONFIG — single source of truth
# ─────────────────────────────────────────────────────────────

# สคริปต์อยู่ใน docs/tools/ → docs/ คือโฟลเดอร์แม่
DOCS_DIR = Path(__file__).resolve().parent.parent

CONFIG = {
    "docs_dir": DOCS_DIR,
    "out_pdf": DOCS_DIR / "ENV-MONITOR-devices.pdf",
    "title": "ENV//MONITOR",
    "subtitle": "เอกสารเทคนิครายอุปกรณ์ — Raspberry Pi 5",
    "version": "1.0",
    # ลำดับของเอกสารใน PDF (ชื่อไฟล์ใน docs/devices/, ชื่อ, คำอธิบายสั้น, อินเทอร์เฟซ)
    # หมายเหตุ: mq2-ads1115.md ยังอยู่ใน repo แต่ไม่รวมใน PDF ตามที่ตัดสินใจไม่ใช้ MQ-2
    "devices": [
        ("pms7003.md", "PMS7003", "ฝุ่นละออง PM1.0 / PM2.5 / PM10", "UART 9600"),
        ("scd40.md", "SCD40", "CO₂ · อุณหภูมิ · ความชื้น", "I2C 0x62"),
        ("sgp30.md", "SGP30", "TVOC · eCO₂", "I2C 0x58"),
        ("bh1750.md", "BH1750", "ความสว่าง (lux)", "I2C 0x23"),
        ("microphone-usb.md", "USB Microphone", "ระดับเสียง (dB)", "USB Audio Class"),
        ("camera.md", "กล้อง", "ใบหน้า · EAR · การขยับ", "CSI-2 / USB"),
    ],
    # บทเพิ่มเติมที่ไม่ใช่ "อุปกรณ์" — วางต่อจากเอกสารรายอุปกรณ์ แต่ไม่ขึ้นในตารางหน้าปก
    "chapters": [
        ("research-basis.md", "ทบทวนวรรณกรรม", "งานวิจัยรองรับ · ช่องว่าง · กรอบแนวคิด · สมมติฐาน"),
        ("budget.md", "งบประมาณ", "ราคาชิ้นส่วน · ชุดที่แนะนำ · ลำดับการซื้อ"),
    ],
    # หน้าสรุปท้ายเล่ม — บีบให้พอดี 1 หน้า (ตั้ง compact_pt ให้เล็กกว่าเนื้อหาปกติ)
    "summary": {
        "file": "summary.md",
        "toc_label": "สรุปอุปกรณ์ทั้งหมด (1 หน้า)",
        "compact_pt": 6.3,
        "margin": "12mm 11mm 12mm 11mm",  # ขอบแคบกว่าหน้าปกติ เพื่อให้เนื้อหาลงครบ 1 หน้า
    },
    "fonts": {
        "body": "Loma, DejaVu Sans, sans-serif",
        "head": "Garuda, DejaVu Sans, sans-serif",
        # DejaVu Sans Mono ไม่มีอักษรไทย จึงต้องมี Loma ต่อท้ายให้ fallback ไปเรนเดอร์ไทย
        # ⚠️ ห้ามใส่ Tlwg Mono หรือ generic `monospace` ไว้ก่อน Loma — ฟอนต์ไทยแบบ
        #    fixed-width วางสระ/วรรณยุกต์ผิดตำแหน่ง ทำให้โค้ดบล็อกภาษาไทยอ่านไม่ออก
        "mono": "'DejaVu Sans Mono', Loma",
    },
    "colors": {
        "ink": "#0f2733",
        "muted": "#5b7382",
        "rule": "#d4dfe6",
        "accent": "#1b6ca8",
        "surface": "#f4f8fa",
        "danger": "#c0392b",
        "warn": "#b8860b",
        "ok": "#1a7a4c",
    },
    "page": {"size": "A4", "margin": "18mm 16mm 20mm 16mm"},
    "base_font_pt": 9.4,
}

# เครื่องหมาย emoji -> badge HTML (ฟอนต์ในเครื่องไม่มี glyph ของ emoji ส่วนใหญ่)
BADGES = {
    "⚠️": ("warn", "!"), "⚠": ("warn", "!"),
    "✅": ("ok", "✓"),
    "❌": ("danger", "✗"),
    "🔴": ("danger", "●"),
    "🟠": ("warn", "●"),
    "🟡": ("warn", "○"),
    "🟢": ("ok", "●"),
    "🔑": ("key", "KEY"),
    "💡": ("tip", "TIP"),
    "🔒": ("key", "PRIVACY"),
    "⚖️": ("key", "LEGAL"), "⚖": ("key", "LEGAL"),
    "📝": ("tip", "NOTE"),
    "🔧": ("tip", "FIX"),
    "🔍": ("tip", "CHECK"),
    "🥇": ("ok", "1"),
    "🥈": ("muted", "2"),
    "🥉": ("muted", "3"),
}
BADGE_RE = re.compile("|".join(re.escape(k) for k in sorted(BADGES, key=len, reverse=True)))
PLACEHOLDER = "BADGE{}"  # กันไม่ให้ pandoc escape HTML ที่แทรกเข้าไป


def clean_markdown(text: str) -> str:
    """ตัดลิงก์นำทางและแปลงลิงก์ข้ามเอกสารที่ไม่ได้อยู่ใน PDF นี้ให้เป็นข้อความธรรมดา."""
    # ลบบรรทัดนำทางหัว/ท้ายไฟล์
    text = re.sub(r"^\[← กลับสารบัญ\]\([^)]*\)[^\n]*\n", "", text, flags=re.M)
    text = re.sub(r"\n---\n+\[← กลับสารบัญ\]\([^)]*\)\s*$", "\n", text)
    # ลิงก์ไปเอกสารภาพรวม (01-05) ซึ่งไม่ได้รวมอยู่ใน PDF นี้ -> แปลงเป็นข้อความอ้างอิงไฟล์
    def ref(m):
        label, target = m.group(1).strip(), m.group(2)
        # ถ้าข้อความลิงก์เป็นชื่อไฟล์อยู่แล้ว ไม่ต้องใส่วงเล็บซ้ำ
        if label.startswith(target) or label.endswith(".md"):
            return f"`docs/{target}.md`"
        # ตัดคำนำหน้า "ดู"/"ดูที่" ที่มักมีอยู่แล้วในประโยค เพื่อไม่ให้ซ้อนกับ "ดู" ที่เติมเข้าไป
        label = re.sub(r"^ดู(ที่)?\s+", "", label)
        return f"{label} *(ดู `docs/{target}.md`)*"

    text = re.sub(r"\[([^\]]+)\]\(\.\./(0\d-[a-z-]+)\.md(?:#[^)]*)?\)", ref, text)
    # ลิงก์ระหว่างเอกสารอุปกรณ์ด้วยกัน -> anchor ภายใน PDF
    text = re.sub(
        r"\]\((?:\./)?([a-z0-9-]+)\.md(?:#[^)]*)?\)",
        lambda m: f"](#dev-{m.group(1)})",
        text,
    )
    return text


def to_badges(text: str) -> str:
    """แทน emoji ด้วย placeholder ก่อนส่งเข้า pandoc."""
    store = []

    def sub(m):
        cls, label = BADGES[m.group(0)]
        store.append(f'<span class="b b-{cls}">{html.escape(label)}</span>')
        return PLACEHOLDER.format(len(store) - 1)

    return BADGE_RE.sub(sub, text), store


def restore_badges(html_text: str, store: list) -> str:
    for i, badge in enumerate(store):
        html_text = html_text.replace(PLACEHOLDER.format(i), badge)
    return html_text


THAI_RE = re.compile(r"[฀-๿]")
BOX_RE = re.compile(r"[─-╿]")  # อักขระวาดกล่อง ─ │ ┌ ┐ └ ┘ ├ ┬


def lint_code_blocks(path: Path, md: str) -> None:
    """
    เตือนเมื่อโค้ดบล็อกมีทั้งอักษรไทยและอักขระวาดกล่อง

    ฟอนต์ไทยที่ใช้ (Loma) เป็นแบบ proportional เมื่อ fallback มาจาก DejaVu Sans Mono
    ความกว้างตัวอักษรจะไม่เท่ากัน ทำให้ ASCII art ที่ต้องพึ่งการจัดคอลัมน์เพี้ยน
    → ให้เปลี่ยนไปใช้ตารางแทน
    """
    for m in re.finditer(r"```[^\n]*\n(.*?)```", md, re.S):
        body = m.group(1)
        if THAI_RE.search(body) and BOX_RE.search(body):
            line = md[: m.start()].count("\n") + 1
            print(
                f"!! เตือน {path.name}:{line} — โค้ดบล็อกมีทั้งภาษาไทยและอักขระวาดกล่อง "
                f"การจัดคอลัมน์จะเพี้ยน แนะนำให้เปลี่ยนเป็นตาราง",
                file=sys.stderr,
            )


def md_to_html(md: str) -> str:
    md, store = to_badges(md)
    proc = subprocess.run(
        ["pandoc", "-f", "markdown+pipe_tables+backtick_code_blocks-smart", "-t", "html5"],
        input=md, capture_output=True, text=True, check=True,
    )
    return restore_badges(proc.stdout, store)


def build_css() -> str:
    c, f, p = CONFIG["colors"], CONFIG["fonts"], CONFIG["page"]
    return f"""
@page {{
  size: {p['size']}; margin: {p['margin']};
  @bottom-center {{
    content: counter(page) " / " counter(pages);
    font-family: {f['body']}; font-size: 7.5pt; color: {c['muted']};
  }}
  @top-right {{
    content: "ENV//MONITOR — เอกสารเทคนิครายอุปกรณ์";
    font-family: {f['body']}; font-size: 7pt; color: {c['muted']};
  }}
}}
@page cover {{ margin: 0; @bottom-center {{ content: none; }} @top-right {{ content: none; }} }}
@page toc  {{ @top-right {{ content: none; }} }}

* {{ box-sizing: border-box; }}
body {{
  font-family: {f['body']}; font-size: {CONFIG['base_font_pt']}pt;
  line-height: 1.62; color: {c['ink']}; margin: 0;
}}

/* ── ปก ───────────────────────────────────────── */
.cover {{ page: cover; height: 297mm; padding: 42mm 24mm 0; page-break-after: always; }}
.cover .rule {{ width: 46mm; height: 3.5pt; background: {c['accent']}; margin-bottom: 10mm; }}
.cover h1 {{ font-family: {f['head']}; font-size: 34pt; margin: 0; letter-spacing: -0.5pt; }}
.cover h2 {{ font-family: {f['head']}; font-size: 15pt; font-weight: normal;
             color: {c['muted']}; margin: 5mm 0 0; }}
.cover .meta {{ margin-top: 26mm; font-size: 9pt; color: {c['muted']}; line-height: 2; }}
.cover .meta b {{ color: {c['ink']}; font-weight: 600; }}
.cover .devbox {{ margin-top: 14mm; border-top: 0.7pt solid {c['rule']}; padding-top: 6mm; }}
.cover .devbox table {{ width: 100%; border-collapse: collapse; font-size: 8.6pt; }}
.cover .devbox td {{ padding: 2.1mm 0; border-bottom: 0.4pt solid {c['rule']}; vertical-align: top; }}
.cover .devbox td:first-child {{ font-weight: 700; width: 34mm; }}
.cover .devbox td:last-child {{ text-align: right; color: {c['muted']};
   font-family: {f['mono']}; font-size: 7.8pt; white-space: nowrap; }}

/* ── สารบัญ ───────────────────────────────────── */
.toc {{ page: toc; page-break-after: always; }}
.toc h2 {{ font-family: {f['head']}; font-size: 17pt; margin: 0 0 7mm;
           border-bottom: 1.6pt solid {c['accent']}; padding-bottom: 2.5mm; }}
.toc ol {{ list-style: none; padding: 0; margin: 0; }}
.toc li {{ margin-bottom: 2.4mm; }}
.toc a {{ text-decoration: none; color: {c['ink']}; }}
.toc .lv1 {{ font-weight: 700; font-size: 10.5pt; margin-top: 5mm; }}
.toc .lv2 {{ padding-left: 7mm; font-size: 8.8pt; color: {c['muted']}; }}
.toc a::after {{
  content: " " leader('.') " " target-counter(attr(href), page);
  color: {c['muted']}; font-size: 8pt;
}}

/* ── เนื้อหา ───────────────────────────────────── */
.dev {{ page-break-before: always; }}
h1 {{ font-family: {f['head']}; font-size: 19pt; margin: 0 0 1mm;
      border-bottom: 2pt solid {c['accent']}; padding-bottom: 2.5mm; }}
h2 {{ font-family: {f['head']}; font-size: 12.4pt; margin: 7mm 0 2.5mm;
      color: {c['accent']}; page-break-after: avoid; }}
h3 {{ font-family: {f['head']}; font-size: 10.2pt; margin: 5mm 0 1.8mm; page-break-after: avoid; }}
p, li {{ margin: 1.6mm 0; orphans: 2; widows: 2; }}
ul, ol {{ padding-left: 6.5mm; margin: 1.6mm 0; }}
hr {{ border: 0; border-top: 0.5pt solid {c['rule']}; margin: 5mm 0; }}
a {{ color: {c['accent']}; text-decoration: none; }}

code {{ font-family: {f['mono']}; font-size: 0.86em; background: {c['surface']};
        padding: 0.4mm 1.1mm; border-radius: 1.5pt; }}
pre {{ background: {c['surface']}; border-left: 2.2pt solid {c['accent']};
       padding: 2.6mm 3.2mm; font-size: 7.4pt; line-height: 1.44;
       white-space: pre-wrap; word-wrap: break-word; page-break-inside: avoid;
       margin: 2.6mm 0; }}
pre code {{ background: none; padding: 0; font-size: 1em; }}

blockquote {{ margin: 2.6mm 0; padding: 2.2mm 3.4mm; background: {c['surface']};
              border-left: 2.2pt solid {c['muted']}; page-break-inside: avoid; }}
blockquote p {{ margin: 0.9mm 0; }}

table {{ width: 100%; border-collapse: collapse; margin: 2.6mm 0;
         font-size: 8.1pt; page-break-inside: avoid; }}
thead {{ background: {c['surface']}; }}
th {{ text-align: left; font-weight: 700; padding: 1.7mm 2mm;
      border-bottom: 1.1pt solid {c['accent']}; }}
td {{ padding: 1.5mm 2mm; border-bottom: 0.4pt solid {c['rule']}; vertical-align: top; }}
tbody tr:nth-child(even) {{ background: #fafcfd; }}

/* ── badge แทน emoji ──────────────────────────── */
.b {{ display: inline-block; font-family: {f['mono']}; font-size: 6.6pt; font-weight: 700;
      line-height: 1.35; padding: 0.2mm 1.1mm; border-radius: 1.6pt;
      vertical-align: 1.5%; margin-right: 0.5mm; color: #fff; }}
.b-warn   {{ background: {c['warn']}; }}
.b-danger {{ background: {c['danger']}; }}
.b-ok     {{ background: {c['ok']}; }}
.b-key    {{ background: {c['accent']}; }}
.b-tip    {{ background: {c['muted']}; }}
.b-muted  {{ background: #93a7b3; }}

/* ── หน้าสรุป: บีบทุกอย่างให้พอดี 1 หน้า ────────── */
@page summary {{ margin: {CONFIG['summary']['margin']}; }}
.summary {{ page: summary; page-break-before: always;
            font-size: {CONFIG['summary']['compact_pt']}pt; line-height: 1.3; }}
.summary h1 {{ font-size: 14pt; margin-bottom: 1.5mm; padding-bottom: 1.3mm;
               border-bottom-width: 1.6pt; }}
.summary h2 {{ font-size: 8pt; margin: 2.5mm 0 0.9mm; }}
.summary p {{ margin: 0.9mm 0; }}
.summary table {{ font-size: {CONFIG['summary']['compact_pt']}pt; margin: 0.9mm 0; }}
.summary th {{ padding: 0.85mm 1.2mm; border-bottom-width: 0.9pt; }}
.summary td {{ padding: 0.7mm 1.2mm; }}
.summary code {{ padding: 0 0.6mm; }}
.summary .b {{ font-size: 5.4pt; padding: 0.1mm 0.8mm; }}
"""


def build_cover() -> str:
    c = CONFIG
    rows = "\n".join(
        f"<tr><td>{html.escape(name)}</td><td>{html.escape(what)}</td>"
        f"<td>{html.escape(iface)}</td></tr>"
        for _, name, what, iface in c["devices"]
    )
    return f"""
<section class="cover">
  <div class="rule"></div>
  <h1>{html.escape(c['title'])}</h1>
  <h2>{html.escape(c['subtitle'])}</h2>
  <div class="meta">
    <div><b>เวอร์ชัน</b> {c['version']}</div>
    <div><b>วันที่</b> {date.today().isoformat()}</div>
    <div><b>ขอบเขต</b> เอกสารรายอุปกรณ์เท่านั้น — สเปก, การต่อสาย, โปรโตคอล, การ calibrate, การแก้ปัญหา</div>
    <div><b>ที่มาของข้อมูล</b> datasheet ทางการของผู้ผลิตแต่ละราย</div>
  </div>
  <div class="devbox">
    <table><tbody>{rows}</tbody></table>
  </div>
</section>
"""


def build_toc(entries) -> str:
    items = []
    for anchor, name, what, subs in entries:
        label = f"{name} — {what}" if what else name
        items.append(f'<li class="lv1"><a href="#{anchor}">{html.escape(label)}</a></li>')
        items.extend(
            f'<li class="lv2"><a href="#{sid}">{html.escape(stitle)}</a></li>'
            for sid, stitle in subs
        )
    return f'<section class="toc"><h2>สารบัญ</h2><ol>{"".join(items)}</ol></section>'


def render_doc(path: Path, anchor: str, collect_subs: bool = True):
    """แปลง 1 ไฟล์ markdown -> (html, รายการหัวข้อย่อยสำหรับสารบัญ)."""
    raw = path.read_text(encoding="utf-8")
    lint_code_blocks(path, raw)
    body = md_to_html(clean_markdown(raw))
    subs, counter = [], [0]

    def tag_h2(m):
        counter[0] += 1
        sid = f"{anchor}-s{counter[0]}"
        # สารบัญไม่ควรมี badge ปน — ตัด <span class="b ..."> ทั้งก้อนออกก่อน แล้วค่อยลอก tag ที่เหลือ
        title = re.sub(r'<span class="b [^"]*">.*?</span>', "", m.group(1), flags=re.S)
        title = re.sub(r"<[^>]+>", "", title)
        title = re.sub(r"\s+", " ", title).strip()
        # กัน "3. — หัวข้อ" เมื่อ badge อยู่ต้นบรรทัดหลังเลขหัวข้อ
        title = re.sub(r"^(\d+\.)\s*[—–-]\s*", r"\1 ", title)
        if collect_subs:
            subs.append((sid, title))
        return f'<h2 id="{sid}">{m.group(1)}</h2>'

    body = re.sub(r"<h2[^>]*>(.*?)</h2>", tag_h2, body, flags=re.S)
    body = re.sub(r"<h1[^>]*>", f'<h1 id="{anchor}">', body, count=1)
    return body, subs


def main() -> int:
    cfg = CONFIG
    dev_dir = cfg["docs_dir"] / "devices"
    sections, toc_entries = [], []

    for fname, name, what, _iface in cfg["devices"]:
        path = dev_dir / fname
        if not path.exists():
            print(f"!! ไม่พบไฟล์: {path}", file=sys.stderr)
            return 1
        anchor = f"dev-{path.stem}"
        body, subs = render_doc(path, anchor)
        sections.append(f'<section class="dev">{body}</section>')
        toc_entries.append((anchor, name, what, subs))

    # บทเพิ่มเติม (เช่น งบประมาณ) — โครงสร้างเหมือนเอกสารอุปกรณ์ แต่ไม่อยู่ในตารางหน้าปก
    for fname, name, what in cfg["chapters"]:
        path = dev_dir / fname
        if not path.exists():
            print(f"!! ไม่พบไฟล์บท: {path}", file=sys.stderr)
            return 1
        anchor = f"dev-{path.stem}"
        body, subs = render_doc(path, anchor)
        sections.append(f'<section class="dev">{body}</section>')
        toc_entries.append((anchor, name, what, subs))

    # หน้าสรุปท้ายเล่ม — ไม่ใส่หัวข้อย่อยในสารบัญ เพราะเป็นหน้าเดียว
    s_cfg = cfg["summary"]
    s_path = dev_dir / s_cfg["file"]
    if not s_path.exists():
        print(f"!! ไม่พบไฟล์สรุป: {s_path}", file=sys.stderr)
        return 1
    s_body, _ = render_doc(s_path, "dev-summary", collect_subs=False)
    sections.append(f'<section class="summary">{s_body}</section>')
    toc_entries.append(("dev-summary", s_cfg["toc_label"], "", []))

    doc = (
        "<!DOCTYPE html><html lang='th'><head><meta charset='utf-8'>"
        f"<title>{html.escape(cfg['title'])} — {html.escape(cfg['subtitle'])}</title>"
        f"<style>{build_css()}</style></head><body>"
        + build_cover()
        + build_toc(toc_entries)
        + "".join(sections)
        + "</body></html>"
    )

    tmp_html = Path("/tmp/devices.html")
    tmp_html.write_text(doc, encoding="utf-8")

    from weasyprint import HTML

    cfg["out_pdf"].parent.mkdir(parents=True, exist_ok=True)
    HTML(filename=str(tmp_html)).write_pdf(str(cfg["out_pdf"]))
    size_kb = cfg["out_pdf"].stat().st_size / 1024
    print(f"OK -> {cfg['out_pdf']}  ({size_kb:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
