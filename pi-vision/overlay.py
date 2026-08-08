"""
วาดผลลงบนเฟรม — แยกจากตรรกะทั้งหมด

โมดูลนี้อ่านอย่างเดียว ไม่แก้ state ใด ๆ ถ้าปิดการแสดงผลก็ข้ามทั้งไฟล์นี้ไปได้เลย

ข้อความบนหน้าจอเป็นภาษาอังกฤษ เพราะ cv2.putText วาดภาษาไทยไม่ได้
(ต้องใช้ PIL + ฟอนต์ไทย ซึ่งช้ากว่ามากและไม่คุ้มสำหรับหน้าจอ debug)
"""

from __future__ import annotations

import cv2
import numpy as np

import landmarks as lm

# ── สี BGR ───────────────────────────────────────────────────
COLORS = {
    "ok": (120, 220, 120),
    "warn": (60, 200, 255),
    "danger": (70, 70, 240),
    "muted": (190, 190, 190),
    "faint": (120, 120, 120),
    "ink": (255, 255, 255),
    "panel": (35, 30, 28),
    "eye": (240, 200, 90),
}

FONT = cv2.FONT_HERSHEY_SIMPLEX
LINE = cv2.LINE_AA

# ── ขนาด/ระยะของการวาด ──────────────────────────────────────
LAYOUT = {
    "box_thickness": 2,
    "label_scale": 0.44,
    "label_thickness": 1,
    "label_pad": 4,
    "hud_scale": 0.44,
    "hud_line_height": 17,
    "hud_margin": 10,
    "hud_pad": 8,
    "panel_alpha": 0.55,
    "mesh_radius": 1,
    "bar_height": 5,
}


def _text(img, text, org, color, scale=None, thickness=None):
    cv2.putText(
        img,
        text,
        org,
        FONT,
        scale if scale is not None else LAYOUT["label_scale"],
        color,
        thickness if thickness is not None else LAYOUT["label_thickness"],
        LINE,
    )


def _panel(img, x1, y1, x2, y2):
    """กล่องพื้นหลังโปร่งแสง ให้ตัวหนังสืออ่านออกทุกฉากหลัง"""
    h, w = img.shape[:2]
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)
    if x2 <= x1 or y2 <= y1:
        return
    roi = img[y1:y2, x1:x2]
    overlay = roi.copy()
    overlay[:] = COLORS["panel"]
    cv2.addWeighted(overlay, LAYOUT["panel_alpha"], roi, 1 - LAYOUT["panel_alpha"], 0, roi)


def draw_face(img, reading, display_cfg, blink_cfg, points=None):
    """วาดกรอบใบหน้า + ป้ายสถานะของคนหนึ่งคน

    display_cfg["show_person_id"] = False (โหมดห้องรวม) จะไม่พิมพ์เลข id ลงบนภาพ
    ถ้าพิมพ์ ใครที่ยืนดูจอก็ตามได้ว่ากรอบไหนคือใคร ซึ่งขัดกับที่โหมดนี้สัญญาไว้
    """
    show_id = display_cfg.get("show_person_id", True)
    tag = f"#{reading.person_id} " if show_id else ""
    h, w = img.shape[:2]
    x1, y1, x2, y2 = reading.box
    p1 = (int(x1 * w), int(y1 * h))
    p2 = (int(x2 * w), int(y2 * h))

    if not reading.usable:
        color = COLORS["faint"]
    elif reading.calibrating:
        color = COLORS["muted"]
    elif reading.drowsy:
        color = COLORS["danger"]
    elif reading.direction:
        color = COLORS["warn"]
    else:
        color = COLORS["ok"]

    # ใบหน้าที่เล็กเกินไปวาดกรอบบางกว่า เพื่อให้เห็นชัดว่าไม่ได้ถูกวิเคราะห์
    cv2.rectangle(img, p1, p2, color, 1 if not reading.usable else LAYOUT["box_thickness"])

    if not reading.usable:
        _text(img, f"{tag}too far", (p1[0], max(p1[1] - 4, 10)), color)
        return

    if reading.calibrating:
        # แถบความคืบหน้าของการ calibrate ท่านิ่ง
        bar_w = int((p2[0] - p1[0]) * reading.calibration_progress)
        cv2.rectangle(
            img, (p1[0], p2[1] + 3), (p1[0] + bar_w, p2[1] + 3 + LAYOUT["bar_height"]), color, -1
        )
        label = f"{tag}calibrating… look straight"
    else:
        bits = [f"#{reading.person_id}"] if show_id else []
        if display_cfg.get("show_eyes", True):
            bits.append(f"eye {reading.blink_score:.2f}")
        if reading.direction:
            bits.append(reading.direction.upper())
        if reading.drowsy:
            bits.append(f"DROWSY {reading.eyes_closed_seconds:.1f}s")
        bits.append(f"mv {reading.movement_in_window}")
        label = "  ".join(bits)

    pad = LAYOUT["label_pad"]
    (tw, th), _ = cv2.getTextSize(label, FONT, LAYOUT["label_scale"], LAYOUT["label_thickness"])
    ly = max(p1[1], th + pad * 2)
    _panel(img, p1[0], ly - th - pad * 2, p1[0] + tw + pad * 2, ly)
    _text(img, label, (p1[0] + pad, ly - pad), color)

    if points is None:
        return

    if display_cfg["draw_mesh"]:
        for lp in points:
            cv2.circle(
                img, (int(lp.x * w), int(lp.y * h)), LAYOUT["mesh_radius"], COLORS["muted"], -1
            )
    elif display_cfg["draw_eyes"]:
        eye_color = COLORS["danger"] if reading.ear < blink_cfg["ear_threshold"] else COLORS["eye"]
        for ring in (lm.LEFT_EYE_RING, lm.RIGHT_EYE_RING):
            pts = np.array([(int(points[i].x * w), int(points[i].y * h)) for i in ring], np.int32)
            cv2.polylines(img, [pts], True, eye_color, 1, LINE)


def draw_menu(img, title, items, footer=None):
    """เมนูกึ่งกลางจอ วาดทับเฟรมปัจจุบัน — ใช้เลือกกล้อง ฯลฯ

    items  = list ของ (ข้อความ, ชื่อสี) เหมือน draw_hud
    footer = คำใบ้ปุ่มบรรทัดล่างสุด (สีจาง)
    """
    h, w = img.shape[:2]
    scale, lh, pad = LAYOUT["hud_scale"], LAYOUT["hud_line_height"], LAYOUT["hud_pad"] * 2

    lines = [(title, "ink"), *items]
    if footer:
        lines.append((footer, "muted"))

    text_w = max(
        cv2.getTextSize(t, FONT, scale, LAYOUT["label_thickness"])[0][0] for t, _ in lines
    )
    box_w = text_w + pad * 2
    box_h = lh * len(lines) + pad * 2
    x1 = (w - box_w) // 2
    y1 = (h - box_h) // 2

    # วาดแผงสองครั้งให้ทึบขึ้น — เมนูควรเด่นกว่า HUD ปกติ
    _panel(img, x1, y1, x1 + box_w, y1 + box_h)
    _panel(img, x1, y1, x1 + box_w, y1 + box_h)

    for i, (text, color_key) in enumerate(lines):
        y = y1 + pad + lh * (i + 1) - 5
        # หัวข้อ (บรรทัดแรก) หนากว่าเพื่อแยกจากรายการ
        _text(
            img,
            text,
            (x1 + pad, y),
            COLORS.get(color_key, COLORS["ink"]),
            scale=scale,
            thickness=2 if i == 0 else None,
        )


def draw_hud(img, lines):
    """แผงข้อมูลมุมซ้ายบน — รับเป็น list ของ (ข้อความ, ชื่อสี)"""
    if not lines:
        return
    m, pad, lh = LAYOUT["hud_margin"], LAYOUT["hud_pad"], LAYOUT["hud_line_height"]
    width = max(
        cv2.getTextSize(t, FONT, LAYOUT["hud_scale"], LAYOUT["label_thickness"])[0][0]
        for t, _ in lines
    )
    _panel(img, m, m, m + width + pad * 2, m + lh * len(lines) + pad * 2)
    for i, (text, color_key) in enumerate(lines):
        _text(
            img,
            text,
            (m + pad, m + pad + lh * (i + 1) - 5),
            COLORS.get(color_key, COLORS["ink"]),
            scale=LAYOUT["hud_scale"],
        )
