#!/usr/bin/env python3
"""
pi-vision — ตรวจจับใบหน้า วัดการหันหน้าและการกะพริบตา แสดงผลบนหน้าจอ

โหมดนี้ยัง **ไม่ส่งข้อมูลออกนอกเครื่อง** — ตั้งใจให้รันดูผลและปรับ threshold ก่อน
เมื่อค่าดูสมเหตุสมผลแล้ว ค่อยเอา WindowSummary.to_focus_row() ไปต่อกับ Supabase

มีสามโหมด — ถ้าไม่ระบุ โปรแกรมจะถามให้เลือกตอนเปิด
    ห้องรวม       นับคนและวัดสมาธิรวมของห้อง ไม่แยกรายบุคคล ไม่เก็บลายเซ็นใบหน้า
    รายบุคคล      ติดตามแยกทีละคนด้วย id และจำ id ได้เมื่อออกไปแล้วกลับมา
    เฉพาะคนในรูป   รู้จักแค่คนที่มีรูปใน faces/ · คนที่ไม่มีรูปไม่ถูกบันทึกเลย

การใช้งาน
    python3 main.py                 # ถามโหมดและกล้อง แล้วเปิดหน้าต่างแสดงผล
    python3 main.py --mode room     # ข้ามคำถาม ใช้โหมดห้องรวมเลย
    python3 main.py --mode known    # รู้จักเฉพาะคนที่มีรูปใน faces/
    python3 main.py --no-window     # ไม่มีจอ (SSH) พิมพ์สรุปลง console อย่างเดียว
    python3 main.py --source usb    # บังคับใช้ USB webcam (ข้ามคำถามเรื่องกล้อง)
    python3 main.py --mesh          # วาด landmark ครบ 468 จุด

ปุ่มลัดขณะรัน
    q / Esc   ออก
    c         calibrate ท่านิ่งใหม่ทุกคนจากท่าที่ทำอยู่ตอนนี้
              (ทับท่านิ่งที่อ่านมาจากรูปด้วย และจะไม่กลับไปใช้ค่าจากรูปอีกจนกว่าจะได้ id ใหม่)
    m         สลับการวาด mesh
    f         ลืมทุก id และลายเซ็นทันที (ความเป็นส่วนตัว)
    e         สลับการโชว์คะแนนอารมณ์ดิบทั้งสี่ค่า (ใช้ปรับ EMOTION_THRESHOLD)
    v         เปิดเมนูเลือกกล้อง แล้วกดเลข 1–9 เพื่อสลับกล้อง
    n         ถ่ายรูปลงทะเบียนคนใหม่จากกล้องสด — พิมพ์ชื่อ แล้วเคาะ space ถ่าย (Esc = จบ)
              (เฉพาะโหมดที่ใช้รูปใน faces/ · ขณะเปิดอยู่ ทุกปุ่มเป็นตัวอักษรของชื่อ)
    space     พิมพ์สรุปหน้าต่างปัจจุบันทันทีโดยไม่ต้องรอครบเวลา

หมายเหตุ: id ที่ขึ้นเป็น `#5?` คือ id ชั่วคราว — ระบบยังตัดสินไม่ได้ว่าเป็นคนใหม่
หรือคนเดิมที่เคยหายไป จึงยังไม่บันทึกลงตาราง focus จนกว่าจะยืนยันได้
"""

from __future__ import annotations

import argparse
import math
import sys
import threading
import time
import urllib.request
from pathlib import Path

import cv2

import analyzer as az
import body as bd
import detect          # ไม่ย่อเป็น dt — ชนกับตัวแปร dt (เวลาต่อเฟรม) ในลูปหลัก
import faces as fc
import landmarks as lm
import modes
import overlay as ov
import phone as ph
import roi
import uploader as up_mod
from camera import Camera, CameraError, list_cameras
from config import CONFIG
from tracker import Detection, PersonTracker

# ── ค่าคงที่ของตัวโปรแกรมเอง (ไม่ใช่ค่าที่ผู้ใช้ต้องปรับ) ──────
EXIT_KEYS = {ord("q"), 27}          # q และ Esc
KEY_RECALIBRATE = ord("c")
KEY_TOGGLE_MESH = ord("m")
KEY_FLUSH = ord(" ")
KEY_FORGET = ord("f")               # ลืมทุก id และลายเซ็นทันที (ความเป็นส่วนตัว)
KEY_CAMERA_MENU = ord("v")          # เปิด/ปิดเมนูเลือกกล้อง (v = video source)
KEY_RESOLUTION = ord("r")           # เปิด/ปิดเมนูเลือกความละเอียด (r = resolution)
KEY_EMOTION = ord("e")              # โชว์คะแนนอารมณ์ดิบ เพื่อดูว่า threshold เหมาะไหม
KEY_ENROLL = ord("n")               # ถ่ายรูปลงทะเบียนคนใหม่จากกล้องสด (n = new face)
WAIT_KEY_MS = 1
FPS_SMOOTHING = 0.9                 # ยิ่งใกล้ 1 ยิ่งนิ่ง
DOWNLOAD_CHUNK = 1 << 16


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="ตรวจจับใบหน้าและวัดสมาธิด้วย MediaPipe")
    # choices=ALL ไม่ใช่ ORDER — โหมดที่ไม่อยู่ในเมนู (room) ต้องยังสั่งด้วย --mode ได้
    p.add_argument("--mode", choices=modes.ALL, help="ทับค่า VISION_MODE และข้ามคำถามตอนเปิด")
    p.add_argument("--source", choices=("auto", "csi", "usb"), help="ทับค่า CAMERA_SOURCE")
    p.add_argument("--no-window", action="store_true", help="ไม่เปิดหน้าต่าง (สำหรับ SSH)")
    p.add_argument("--mesh", action="store_true", help="วาด landmark ครบ 468 จุด")
    return p.parse_args()


def resolve_mode(cli_mode: str | None, env_mode: str, stream=None) -> modes.Mode:
    """
    ลำดับความสำคัญ: flag > VISION_MODE ใน .env > ถามผู้ใช้
    ไม่มี TTY (cron · systemd · ท่อ) จะไม่ค้างรอ input — ใช้ค่าเริ่มต้นแล้วบอกให้รู้

    ⚠️ ทางที่ **ไม่มีใครเลือก** ใช้ `HEADLESS_DEFAULT` ไม่ใช่ `DEFAULT` (ดู modes.py)
    เมนูข้อ 1 เป็นโหมดที่จำหน้าและติดชื่อจริง การให้เครื่องที่บูตเองโดยไม่มีคนอยู่
    เริ่มทำแบบนั้นเงียบ ๆ ไม่ใช่ค่าเริ่มต้นที่ควรได้มาโดยไม่มีใครตัดสินใจ
    """
    if cli_mode:
        return modes.get(cli_mode)
    if env_mode:
        return modes.get(env_mode)          # ชื่อผิดใน .env ให้ระเบิดออกมาเลย ดีกว่าเดา

    stream = stream or sys.stdin
    if not (hasattr(stream, "isatty") and stream.isatty()):
        chosen = modes.get(modes.HEADLESS_DEFAULT)
        print(f"[pi-vision] ไม่มีหน้าจอให้ถาม — ใช้โหมด{chosen.label}"
              f" · ระบุ --mode หรือ VISION_MODE เพื่อเลือกเอง")
        return chosen

    for line in modes.menu_lines():
        print(line)
    while True:
        try:
            raw = input(f"  เลือก [{modes.ORDER.index(modes.DEFAULT) + 1}]: ")
        except EOFError:
            # stdin ปิดกลางคัน = ไม่มีใครตอบ ไม่ใช่ "กด Enter" — ใช้ทางที่ไม่มีคนเลือก
            return modes.get(modes.HEADLESS_DEFAULT)
        chosen = modes.parse_choice(raw)
        if chosen is not None:
            return chosen
        print("  พิมพ์เลขข้อหรือชื่อโหมด")


def choose_camera(cam_cfg: dict, scan=None, stream=None) -> dict:
    """
    ถามว่าจะใช้กล้องตัวไหน **ก่อน**เปิดโปรแกรม — คืน cam_cfg ชุดใหม่ (ไม่แก้ของเดิม)

    ลำดับเดียวกับการเลือกโหมด: flag `--source` > `CAMERA_ASK=false` > ถาม
    ไม่มี TTY (systemd · cron · ท่อ) จะไม่ค้างรอ input แต่ใช้ค่าใน .env แล้วเดินต่อ

    เจอกล้องตัวเดียวก็ไม่ถาม — คำถามที่มีคำตอบเดียวไม่ใช่ตัวเลือก แค่ทำให้เริ่มช้าลง
    หาไม่เจอเลยก็ไม่ถาม ปล่อยให้ Camera.open() รายงานปัญหาจริงซึ่งบอกสาเหตุได้ดีกว่า

    `scan` แยกออกมาเป็นพารามิเตอร์เพื่อให้ทดสอบได้โดยไม่ต้องมีกล้องจริง
    """
    scan = scan or list_cameras
    stream = stream if stream is not None else sys.stdin
    if not (hasattr(stream, "isatty") and stream.isatty()):
        return cam_cfg
    if str(cam_cfg.get("usb_name") or "").strip():
        # ปักชื่อกล้องไว้ใน .env แล้ว = ตอบคำถามนี้ไปแล้ว · Camera.open() จะไปหาชื่อนั้น
        # และฟ้องเองถ้าหาไม่เจอ ซึ่งเป็นข้อความที่บอกสาเหตุได้ดีกว่าเมนูตรงนี้
        return cam_cfg

    print("[pi-vision] กำลังสำรวจกล้อง…")
    try:
        cams = scan(cam_cfg)
    except Exception as exc:               # การสำรวจล้มไม่ควรทำให้เปิดโปรแกรมไม่ได้
        print(f"[pi-vision] สำรวจกล้องไม่ได้ ({exc}) — ใช้ค่าใน .env")
        return cam_cfg

    if not cams:
        print("[pi-vision] ไม่พบกล้อง — จะลองเปิดตามค่าใน .env")
        return cam_cfg
    if len(cams) == 1:
        print(f"[pi-vision] พบกล้องตัวเดียว: {cams[0]['label']}")
        return _with_camera(cam_cfg, cams[0])

    print("")
    print("  เลือกกล้อง")
    for i, cam in enumerate(cams, start=1):
        mark = " (ใช้อยู่)" if cam.get("current") else ""
        print(f"    {i}) {cam['label']}{mark}")
    print("")
    while True:
        try:
            raw = input("  เลือก [1]: ").strip()
        except EOFError:
            return _with_camera(cam_cfg, cams[0])
        if not raw:
            return _with_camera(cam_cfg, cams[0])
        if raw.isdigit() and 1 <= int(raw) <= len(cams):
            return _with_camera(cam_cfg, cams[int(raw) - 1])
        print(f"  พิมพ์เลข 1-{len(cams)}")


def _with_camera(cam_cfg: dict, choice: dict) -> dict:
    """ใส่กล้องที่เลือกลง cam_cfg — usb_index เก็บเป็นสตริงเหมือนที่มาจาก .env"""
    picked = dict(cam_cfg)
    picked["source"] = choice["source"]
    if choice["source"] == "usb" and choice.get("index") is not None:
        picked["usb_index"] = str(choice["index"])
    return picked


def ensure_model(model_cfg: dict) -> Path:
    """ดาวน์โหลดโมเดล MediaPipe ครั้งแรก ถ้ายังไม่มีในเครื่อง

    รับ dict ที่มี path/url/auto_download — ใช้ได้กับทุกโมเดล ไม่ใช่เฉพาะ face_landmarker
    (หมวด `body` ใช้คีย์ชุดเดียวกันจึงส่งเข้ามาตรง ๆ ได้)
    """
    path = Path(model_cfg["path"])
    if path.exists():
        return path
    if not model_cfg["auto_download"]:
        raise SystemExit(
            f"ไม่พบโมเดลที่ {path}\n"
            f"ดาวน์โหลดเองจาก: {model_cfg['url']}\n"
            "หรือตั้ง MODEL_AUTO_DOWNLOAD=true"
        )

    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".part")
    print(f"[pi-vision] กำลังดาวน์โหลดโมเดล → {path}")
    try:
        with urllib.request.urlopen(model_cfg["url"]) as resp, open(tmp, "wb") as out:
            while chunk := resp.read(DOWNLOAD_CHUNK):
                out.write(chunk)
        tmp.replace(path)  # เขียนเสร็จค่อยเปลี่ยนชื่อ — กันไฟล์เสียถ้าเน็ตหลุดกลางคัน
    except Exception as exc:
        tmp.unlink(missing_ok=True)
        raise SystemExit(f"ดาวน์โหลดโมเดลไม่สำเร็จ: {exc}") from exc
    print(f"[pi-vision] ดาวน์โหลดเสร็จ ({path.stat().st_size / 1024:.0f} KB)")
    return path


def build_landmarker(model_cfg: dict):
    """สร้าง FaceLandmarker (MediaPipe Tasks API — รุ่นใหม่ ไม่ใช่ solutions.face_mesh ที่เลิกใช้แล้ว)"""
    try:
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision
    except ImportError as exc:
        raise SystemExit(
            "ไม่พบ mediapipe — ติดตั้งด้วย: pip install mediapipe opencv-python"
        ) from exc

    model_path = ensure_model(model_cfg)
    options = vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(model_path)),
        running_mode=vision.RunningMode.VIDEO,
        num_faces=model_cfg["max_faces"],
        min_face_detection_confidence=model_cfg["min_detection_confidence"],
        min_face_presence_confidence=model_cfg["min_presence_confidence"],
        min_tracking_confidence=model_cfg["min_tracking_confidence"],
        output_face_blendshapes=model_cfg["blendshapes"],
        output_facial_transformation_matrixes=model_cfg["transform_matrix"],
    )
    return vision.FaceLandmarker.create_from_options(options)


def _cell(box, grid: int = 16) -> tuple[int, int]:
    """
    ช่องหยาบ ๆ ที่กรอบนี้ตกอยู่ — กุญแจสำหรับจำว่า "ซูมตรงนี้ไปเมื่อไร"

    คนที่ไกลเกินกว่าจะเคยถูกอ่าน landmark ยังไม่มี track และไม่มี id ให้ผูก
    แต่เป็นกลุ่มที่ต้องการคิวซูมมากที่สุดพอดี จึงผูกกับ**ตำแหน่งบนภาพ**แทน

    หยาบพอที่คนยืนนิ่งจะตกช่องเดิมข้ามเฟรม (ไม่งั้นจะดูเหมือนคนใหม่ทุกเฟรมแล้วแย่ง
    คิวคนอื่นตลอด) และละเอียดพอที่คนสองคนที่ยืนห่างกันจะไม่ใช้ช่องเดียวกัน
    """
    return (int((box[0] + box[2]) / 2 * grid), int((box[1] + box[3]) / 2 * grid))


def build_detector(detect_cfg: dict):
    """สร้าง FaceDetector รุ่น full-range — โหมดติดตามกิจกรรมเท่านั้น"""
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    options = vision.FaceDetectorOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(ensure_model(detect_cfg))),
        running_mode=vision.RunningMode.VIDEO,
        min_detection_confidence=detect_cfg["min_confidence"],
        min_suppression_threshold=detect_cfg["min_suppression"],
    )
    return vision.FaceDetector.create_from_options(options)


def build_zoom_reader(model_cfg: dict):
    """
    FaceLandmarker อีกตัวสำหรับอ่าน **ภาพครอป** — โหมด IMAGE ไม่ใช่ VIDEO

    ต้องเป็น IMAGE เพราะภาพที่ป้อนเข้าไปกระโดดไปมาระหว่างคนแต่ละคนในเฟรมเดียวกัน
    ตัวติดตามภายในของโหมด VIDEO จะสับสนทันที (เหตุผลเดียวกับ build_photo_reader)

    แยกจากตัวหลักที่อ่านภาพเต็ม เพราะตัวหลักอยู่โหมด VIDEO และต้องได้เฟรมเรียงตามเวลา
    """
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    options = vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(ensure_model(model_cfg))),
        running_mode=vision.RunningMode.IMAGE,
        num_faces=1,                      # ครอปมาแล้วหนึ่งกรอบ = หนึ่งใบหน้า
        min_face_detection_confidence=model_cfg["min_detection_confidence"],
        output_face_blendshapes=model_cfg["blendshapes"],
        output_facial_transformation_matrixes=model_cfg["transform_matrix"],
    )
    return vision.FaceLandmarker.create_from_options(options)


def zoom_read(reader, frame, box, roi_cfg: dict, previous=None):
    """
    ครอปใบหน้าออกมา ขยาย แล้วอ่าน landmark — คืน `(landmarks, blendshapes, matrix, rect, grow)`

    `grow` คืออัตราที่ภาพครอปถูกขยายก่อนป้อนโมเดล — analyzer เอาไปใช้ตัดสินว่า
    landmark ชุดนี้น่าเชื่อแค่ไหน (ดู quality gate)

    คืน `(None, None, None, rect, grow)` เมื่อครอปแล้วยังหาใบหน้าไม่เจอ ซึ่งเกิดได้ปกติ
    กับกรอบผีจากตัวตรวจ · ผู้เรียกทิ้งกรอบนั้นไปแล้วลองใหม่เฟรมหน้าได้เลย

    landmark ที่คืนออกไปเป็นพิกัดของ**เฟรมเต็ม**แล้ว (ดู roi.remap) ส่วนที่เหลือของ
    ระบบจึงไม่ต้องรู้เลยว่ามีการครอปเกิดขึ้น
    """
    import mediapipe as mp

    h, w = frame.shape[:2]
    rect = roi.blend_rect(previous, roi.crop_rect(box, w, h, roi_cfg["margin"]),
                          roi_cfg["smoothing"])
    x1, y1, x2, y2 = rect
    patch = frame[y1:y2, x1:x2]
    if patch.size == 0:
        return None, None, None, rect, 1.0

    # ขยายให้ใหญ่พอที่โมเดลจะเห็นรายละเอียด — ทั้งสองแกนคูณด้วยค่าเดียวกัน
    # เพื่อไม่ให้อัตราส่วนเสีย (เหตุผลเต็มอยู่ในหัวไฟล์ roi.py)
    short = min(patch.shape[0], patch.shape[1])
    grow = min(max(roi_cfg["min_px"] / max(short, 1), 1.0),
               roi_cfg["max_px"] / max(short, 1))
    if grow > 1.0:
        patch = cv2.resize(patch, None, fx=grow, fy=grow, interpolation=cv2.INTER_LINEAR)

    rgb = cv2.cvtColor(patch, cv2.COLOR_BGR2RGB)
    result = reader.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    if not result or not result.face_landmarks:
        return None, None, None, rect, grow

    points = roi.remap(result.face_landmarks[0], rect, w, h)
    shapes = _nth(getattr(result, "face_blendshapes", None) or [], 0)
    matrix = _nth(getattr(result, "facial_transformation_matrixes", None) or [], 0)
    return points, shapes, matrix, rect, grow


def build_body_landmarker(body_cfg: dict):
    """สร้าง PoseLandmarker (landmark ร่างกาย 33 จุด) — โหมดติดตามกิจกรรมเท่านั้น

    แยกจาก FaceLandmarker คนละตัวคนละโมเดล · โหมดอื่นไม่เรียกฟังก์ชันนี้เลย
    จึงไม่มีใครจ่ายค่า 5.8 MB กับเวลา inference ของท่าทางถ้าไม่ได้ใช้
    """
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(ensure_model(body_cfg))),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=body_cfg["max_people"],
        min_pose_detection_confidence=body_cfg["min_detection_confidence"],
        min_pose_presence_confidence=body_cfg["min_presence_confidence"],
        min_tracking_confidence=body_cfg["min_tracking_confidence"],
    )
    return vision.PoseLandmarker.create_from_options(options)


def build_phone_detector(phone_cfg: dict):
    """สร้าง ObjectDetector ที่ตรวจ**เฉพาะโทรศัพท์** — โหมดติดตามกิจกรรมเท่านั้น

    `category_allowlist` ตัดอีก 89 คลาสของ COCO ทิ้งตั้งแต่ในตัวโมเดล ไม่ใช่มากรอง
    ทีหลัง — เราไม่ได้อยากรู้ว่ามีเก้าอี้กี่ตัวในห้อง และการปล่อยให้มันคืนมาทั้งหมด
    คือการเก็บรายการสิ่งของในห้องของคนอื่นไว้ในหน่วยความจำโดยไม่มีใครใช้
    """
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    options = vision.ObjectDetectorOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(ensure_model(phone_cfg))),
        running_mode=vision.RunningMode.VIDEO,
        category_allowlist=[ph.PHONE_LABEL],
        score_threshold=phone_cfg["min_score"],
        max_results=phone_cfg["max_results"],
    )
    return vision.ObjectDetector.create_from_options(options)


def read_phone(track, held, phone_cfg: dict, now: float):
    """สถานะ "ใช้โทรศัพท์อยู่ไหม" ของคนนี้ — คืน `(using, confident)`

    ตัวจับเวลาถือค้างอยู่ใน `track.state` เหมือน gesture/posture จึงรอดการหลุดสั้น ๆ
    ของ track ไปด้วยกัน และหายไปพร้อมกันเมื่อคนนั้นออกจากเฟรมจริง
    """
    hold = track.state.get("phone_hold")
    if hold is None:
        hold = ph.PhoneHold(phone_cfg)
        track.state["phone_hold"] = hold
    return hold.update(held, now)


def attach_bodies(tracks, poses) -> dict[int, int]:
    """
    จับคู่ร่างที่ตรวจเจอ กับ track ใบหน้าที่มีอยู่ — คืน `{person_id: ลำดับของร่าง}`

    คืน**ลำดับ** ไม่ใช่ตัว landmark เพราะผู้เรียกต้องหยิบสองลิสต์ที่เรียงตรงกัน
    (พิกัดบนภาพ และพิกัดหน่วยเมตรสามแกน) ลำดับเป็นกุญแจที่ใช้ได้กับทั้งคู่

    landmark 0 ของ pose คือจมูก จึงบอกได้ว่าหัวของร่างนี้อยู่ตรงไหนโดยไม่ต้องคำนวณ
    อะไรเพิ่ม · จับคู่กับ track ที่จมูกตกอยู่ในกรอบใบหน้าพอดี ถ้าไม่มีกรอบไหนครอบเลย
    ให้ track ที่ศูนย์กลางใกล้ที่สุด **แต่ต้องใกล้กว่าครึ่งหนึ่งของขนาดกรอบ**
    ไม่งั้นคนที่ยืนคนละมุมห้องจะถูกจับคู่กันเพราะเป็นตัวเลือกเดียวที่เหลือ

    หนึ่ง track ได้ร่างเดียว และหนึ่งร่างไปได้ track เดียว — เรียงตามระยะแล้วหยิบทีละคู่
    """
    pairs = []
    for pi, points in enumerate(poses):
        head = bd.head_center(points)
        if head is None:
            continue
        for track in tracks:
            x1, y1, x2, y2 = track.box
            inside = x1 <= head[0] <= x2 and y1 <= head[1] <= y2
            gap = math.hypot(head[0] - track.cx, head[1] - track.cy)
            if inside or gap < max(x2 - x1, y2 - y1) * 0.5:
                # ร่างที่จมูกอยู่ในกรอบพอดีชนะร่างที่แค่อยู่ใกล้เสมอ
                pairs.append((0.0 if inside else gap, pi, track.person_id))
    pairs.sort()

    used_poses: set[int] = set()
    out: dict[int, int] = {}
    for _cost, pi, pid in pairs:
        if pi in used_poses or pid in out:
            continue
        used_poses.add(pi)
        out[pid] = pi
    return out


def read_gesture(points, track, body_cfg: dict, now: float, world=None, aspect: float = 1.0):
    """
    ท่าแขนกับท่ายืน/นั่ง/นอนของคนนี้ — คืน `(gesture, posture, posture_sure)`

    ตัวจับเวลาถือค้างอยู่ใน `track.state` เหมือน state อื่น ๆ ของ analyzer จึงรอด
    การหลุดสั้น ๆ ไปด้วยกัน และหายไปพร้อมกันเมื่อ track หายจริง

    ท่าทางร่างกายใช้ตัวถือค้าง**คนละตัว**กับท่าแขน เพราะสองอย่างนี้เปลี่ยนคนละจังหวะ
    (ยกมือครึ่งวินาที · นั่งครึ่งชั่วโมง) และใช้เวลาถือค้างคนละค่า
    """
    hold = track.state.get("gesture_hold")
    if hold is None:
        hold = bd.GestureHold(body_cfg)
        track.state["gesture_hold"] = hold
    posture_hold = track.state.get("posture_hold")
    if posture_hold is None:
        posture_hold = bd.PostureHold(body_cfg)
        track.state["posture_hold"] = posture_hold

    raw = bd.gesture(points, body_cfg)
    wrist_x = unit = None
    if raw == bd.HAND_UP:
        unit = bd.scale(points)
        # ข้อมือข้างที่ยกอยู่ — ข้างที่สูงกว่า (y น้อยกว่า) คือข้างที่ยก
        left, right = points[bd.L_WRIST], points[bd.R_WRIST]
        wrist_x = left.x if left.y < right.y else right.x
    gesture = hold.update(raw, now, wrist_x, unit or 1.0)

    # ส่งท่าล่าสุดกลับเข้าไปเป็น `previous` — ใช้เมื่อเฟรมนี้ไม่มีหลักฐานใหม่เลย
    # `world` คือ landmark หน่วยเมตรสามแกน ซึ่งเป็นสิ่งที่ทำให้วัดมุมต้นขาได้จริง
    pose_raw, sure = bd.posture(points, body_cfg, posture_hold.current, world=world)

    # ── ยกระดับการเดาให้เป็นการวัด เมื่อมองไม่เห็นขา ──────────────
    # เฟรมที่วัดขาได้จริง = โอกาสจดความสูงศีรษะของท่านั้นไว้ · เฟรมที่วัดไม่ได้ =
    # เอาความสูงตอนนี้ไปเทียบกับที่จดไว้ แทนที่จะเดาว่า "ขาหายแปลว่านั่ง"
    # ท่า**นอน**ไม่เข้าเส้นทางนี้เลย เพราะ posture() ตอบท่านอนแบบมั่นใจเสมอ
    if body_cfg.get("head_posture", False):
        head = track.state.get("head_posture")
        if head is None:
            head = bd.HeadPosture(body_cfg)
            track.state["head_posture"] = head
        level = bd.head_level(points, aspect, body_cfg["min_visibility"])
        if sure:
            head.learn(pose_raw, level)
        else:
            guessed = head.guess(level)
            if guessed is not None:
                pose_raw, sure = guessed

    posture, posture_sure = posture_hold.update(pose_raw, sure, now)
    return gesture, posture, posture_sure


def build_photo_reader(model_cfg: dict, cam_cfg: dict | None = None, roi_cfg: dict | None = None):
    """
    ตัวอ่านใบหน้าจาก **ไฟล์รูป** — FaceLandmarker อีกตัวในโหมด IMAGE

    ต้องแยกจากตัวหลักเพราะตัวหลักอยู่โหมด VIDEO ซึ่งคาดว่าเฟรมจะเรียงตามเวลา
    ป้อนรูปนิ่งเข้าไปคั่นกลางจะทำให้ตัวติดตามภายในของมันสับสน

    คืนฟังก์ชัน `detect(path) -> landmarks | None` ให้ faces.py เอาไปใช้
    ตัว landmarker ถูกสร้างครั้งเดียวและปิดเมื่อเลิกใช้

    ──────────────────────────────────────────────────────────────────────────
    ⚠️ **รูปถูกตัดให้เป็นอัตราส่วนเดียวกับกล้องก่อนเสมอ** (`cam_cfg` ที่ส่งเข้ามา)

    ลายเซ็นมีมิติ `face_h / face_w` อยู่ด้วย ซึ่งคิดจากพิกัด normalized — แกน x
    หารด้วยความกว้างภาพ แกน y หารด้วยความสูงภาพ · อัตราส่วนของ**ไฟล์รูป**จึงเข้าไป
    อยู่ในลายเซ็นโดยตรง

    วัดจริงกับรูปในโฟลเดอร์: คนคนเดียวกันถ่ายเป็นแนวตั้ง 3:4 กับแนวนอน 4:3 ให้ลายเซ็น
    ห่างกัน 0.071 ซึ่ง**เกินเกณฑ์ 0.045** — ระบบจะตัดสินว่าเป็นคนละคน ทั้งที่เป็นรูป
    ใบเดียวกันที่ตัดต่างกัน · ส่วนการตัดชิดหน้ากับตัดครึ่งตัวที่อัตราส่วนเดียวกัน
    ห่างกันแค่ 0.014 ซึ่งไม่มีผลอะไร

    แปลว่า **สิ่งที่สำคัญคืออัตราส่วนของรูป ไม่ใช่ว่าตัดชิดหน้าแค่ไหน** และรูปจากมือถือ
    (แนวตั้ง) เทียบกับภาพจากกล้อง (4:3) ไม่ได้เลยถ้าไม่แก้ตรงนี้ · จึงตัดให้ตรงกันเสียก่อน
    ผู้ใช้จะได้วางรูปแบบไหนก็ได้โดยไม่ต้องรู้เรื่องนี้
    ──────────────────────────────────────────────────────────────────────────
    """
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision
    import mediapipe as mp

    options = vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(ensure_model(model_cfg))),
        running_mode=vision.RunningMode.IMAGE,
        num_faces=1,                      # รูปลงทะเบียนควรมีใบหน้าเดียว
        min_face_detection_confidence=model_cfg["min_detection_confidence"],
    )
    reader = vision.FaceLandmarker.create_from_options(options)

    want_aspect = None
    if cam_cfg:
        want_aspect = cam_cfg["width"] / max(cam_cfg["height"], 1)
    margin = (roi_cfg or {}).get("margin", 0.6)

    def _read(image):
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        result = reader.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
        if not result or not result.face_landmarks:
            return None
        return result.face_landmarks[0]

    def detect(path):
        image = cv2.imread(str(path))
        if image is None:
            return None
        points = _read(image)
        if points is None or want_aspect is None:
            return points

        # อ่านรอบแรกเพื่อ**หาว่าหน้าอยู่ตรงไหน** แล้วตัดใหม่ให้ได้อัตราส่วนของกล้อง
        # และอ่านอีกรอบ · ลายเซ็นที่ได้จึงเทียบกับภาพสดจากกล้องได้ตรง ๆ
        h, w = image.shape[:2]
        x1, y1, x2, y2 = roi.crop_rect(lm.bounding_box(points), w, h, margin,
                                       aspect=want_aspect)
        patch = image[y1:y2, x1:x2]
        if patch.size == 0:
            return points
        # ตัดแล้วหาหน้าไม่เจอ (เกิดได้เมื่อหน้าอยู่ชิดขอบรูปมาก) — ใช้ของรอบแรกไปก่อน
        # ดีกว่าทิ้งรูปนั้นทั้งใบ แม้ลายเซ็นจะเทียบได้ไม่ตรงเท่า
        return _read(patch) or points

    return detect, reader


def _who(reading, known_only: bool = False) -> str:
    """
    ชื่อคนถ้าเทียบกับรูปได้ ไม่งั้นเป็นหมายเลข track

    `?` ต่อท้าย = เดาจากคนที่ใกล้ที่สุด แต่ยังไม่ผ่านเกณฑ์ความมั่นใจ (ตรงกับที่ `#5?`
    ใช้อยู่แล้วสำหรับ id ที่ยังไม่แน่) — ชื่อที่ไม่มี `?` คือชื่อที่ผ่านเกณฑ์

    โหมดที่รู้จักเฉพาะคนในรูปไม่ขึ้นหมายเลขให้ใคร — ตัวตนในโหมดนั้นมาจากโฟลเดอร์
    อย่างเดียว การขึ้น `#3` ชวนให้อ่านว่าเลขนั้นคือตัวตนที่ระบบจำเขาได้ ทั้งที่เป็นแค่
    ลำดับในเฟรมนี้ และคนคนนั้นไม่ได้ถูกบันทึกไว้ที่ไหนเลย

    แต่ก็ **ไม่ใช่คำว่า "unknown"** เพราะ `name` ที่ยังว่างแปลว่า "ยังไม่รู้" ไม่ใช่
    "ตรวจแล้วไม่มีในโฟลเดอร์" — ลายเซ็นยังนิ่งไม่พอ · ใบหน้ายังเล็กเกินไป · แกลเลอรี
    ยังว่าง ล้วนให้ค่าว่างเหมือนกันหมด และทุกกรณีถูกลองใหม่ทุกเฟรมจนกว่าจะมั่นใจ
    การประกาศว่า "ไม่รู้จักคนนี้" ตอนที่ระบบยังทำงานไม่เสร็จจึงเป็นคำตอบที่ผิด
    """
    if reading.name:
        return reading.name if reading.name_confident else f"{reading.name}?"
    return "identifying" if known_only else f"#{reading.person_id}"


def photo_neutral_supported(pose_cfg: dict, model_cfg: dict) -> bool:
    """
    วิธีวัดการหันหน้าที่ใช้อยู่ รับท่านิ่งจากรูปได้ไหม

    ค่าจากรูปเป็นสัดส่วนแบบ geometric ส่วนวิธี matrix ให้องศา — คนละหน่วยกัน
    เอามาหักกันจะได้ตัวเลขที่ดูสมเหตุสมผลแต่ผิดล้วน ๆ · วิธี auto จะเลือก matrix
    เองถ้าโมเดลส่ง transformation matrix มาด้วย จึงต้องเช็คค่านั้นประกอบ
    """
    if not pose_cfg.get("neutral_from_photos", True):
        return False
    method = pose_cfg["method"]
    if method == az.POSE_MATRIX:
        return False
    return not (method == az.POSE_AUTO and model_cfg["transform_matrix"])


def photo_neutrals(gallery, pose_cfg: dict, announce: bool = True) -> dict:
    """
    ท่านิ่งของแต่ละคนที่อ่านได้จากรูป — `{ชื่อ: (yaw, pitch)}`

    ตัดคนที่รูปของเขา**ไม่ได้หันตรง**ออก และบอกให้รู้เป็นราย ๆ เพราะเป็นสิ่งที่
    ผู้ใช้แก้ได้ด้วยการเปลี่ยนรูป · ถ้าเงียบไว้ คนคนนั้นจะกลับไปนั่ง calibrate เอง
    โดยไม่มีอะไรบอกว่าทำไมเขาคนเดียวที่ต้องรอ

    เกณฑ์มาจากหมวด pose (`yaw_threshold` · `pitch_threshold`) ส่วนการตัดสินอยู่ใน
    `faces.usable_neutrals` เพราะการตรวจแกน pitch ต้องดูคนทั้งแกลเลอรีประกอบ
    """
    limit = pose_cfg["photo_neutral_max_ratio"]
    good, rejected = fc.usable_neutrals(
        gallery.people,
        yaw_limit=pose_cfg["yaw_threshold"] * limit,
        pitch_limit=pose_cfg["pitch_threshold"] * limit,
        pitch_quorum=int(pose_cfg["photo_neutral_min_people"]),
    )
    if announce:
        for name, reason in sorted(rejected.items()):
            print(f"[pi-vision] ! ใช้รูปของ {name} เป็นจุดอ้างอิงท่านิ่งไม่ได้: {reason}"
                  " — คนนี้จะ calibrate เองตอนเห็นหน้า · เปลี่ยนเป็นรูปหน้าตรงแล้ววางทับได้เลย")
        if good:
            print(f"[pi-vision] อ่านท่านิ่งจากรูปได้ {len(good)} คน: {', '.join(good)}"
                  " — คนกลุ่มนี้ไม่ต้องรอ calibrate")
    return good


def print_calibration(gallery) -> None:
    """
    บอกว่าเกณฑ์ความเหมือนตอนนี้เป็นเท่าไรและมาจากไหน

    เกณฑ์ที่ระบบตั้งเองต้องมองเห็นได้ ไม่งั้นเวลามันจำผิดจะไม่มีทางรู้ว่าควรไปแก้ที่
    ชุดรูปหรือที่ค่าใน .env — และคำเตือนเรื่องคู่ที่แยกไม่ออกต้องขึ้นแยกบรรทัด
    เพราะเป็นเรื่องที่ผู้ใช้ต้องลงมือแก้ (เพิ่ม/เปลี่ยนรูป) ไม่ใช่แค่ข้อมูลประกอบ
    """
    print(f"[pi-vision] {gallery.calibration.message}")
    warning = gallery.calibration.warning
    if warning:
        print(f"[pi-vision] {warning}")


def _mood(reading) -> str:
    """
    อารมณ์แบบสั้นสำหรับ HUD — โชว์ neutral ด้วย ไม่ใช่เว้นว่าง

    เดิมซ่อน neutral ไว้เพื่อลดความรก ผลคือคนที่นั่งหน้านิ่ง (ซึ่งเป็นเวลาส่วนใหญ่)
    ไม่เห็นอะไรเลย และแยกไม่ออกว่าฟีเจอร์ปิดอยู่ พัง หรือแค่ยังไม่มีอารมณ์ให้อ่าน
    """
    if not reading.emotion:
        return ""
    return f"{reading.emotion:<9} "


def _mood_scores(reading) -> str:
    """คะแนนดิบทั้งสี่ค่าเรียงจากมากไปน้อย — ให้เห็นตัวเลขจริงก่อนไปปรับ threshold"""
    if not reading.emotion_scores:
        return ""
    ranked = sorted(reading.emotion_scores.items(), key=lambda kv: kv[1], reverse=True)
    return "  ".join(f"{k[:5]} {v:.2f}" for k, v in ranked)


def _nth(seq, i):
    """หยิบสมาชิกที่ i แบบปลอดภัย — ผลลัพธ์บางส่วนอาจเป็น None หรือสั้นกว่าที่คาด"""
    try:
        return seq[i]
    except (TypeError, IndexError):
        return None


def print_summary(summary: az.WindowSummary, threshold_per_min: float, mode: modes.Mode) -> None:
    dirs = " ".join(f"{k}:{v}" for k, v in summary.direction.items())
    stamp = time.strftime("%H:%M:%S", time.localtime(summary.ended_at))

    if not mode.per_person_hud:
        # โหมดห้องรวม: เทียบเกณฑ์กับอัตราต่อคน ไม่ใช่ผลรวมของห้อง
        # ไม่งั้นห้องที่คนเยอะจะเกินเกณฑ์เสมอทั้งที่แต่ละคนตั้งใจเรียนปกติ
        per_person = summary.movement_per_person_per_minute()
        flag = "  << เกินเกณฑ์" if per_person > threshold_per_min else ""
        attention = (
            f"{summary.attention_ratio * 100:.0f}%"
            if summary.attention_ratio is not None
            else "-"
        )
        print(
            f"[{stamp}] คนในห้อง={summary.occupancy} (สูงสุด {summary.face_count}) "
            f"วัดได้ {summary.people_measured} คน · หันหน้า {per_person:.1f}/คน/นาที "
            f"· มองตรง {attention} | {dirs}{flag}"
        )
        return

    per_min = summary.movement_per_minute()
    flag = "  << เกินเกณฑ์" if per_min > threshold_per_min else ""
    ear = f"{summary.avg_ear:.3f}" if summary.avg_ear is not None else "-"
    # ชื่อกับอารมณ์อยู่ในบรรทัดนี้ด้วย เพราะโหมด --no-window ไม่มี HUD ให้ดู
    # ถ้าไม่พิมพ์ ค่าสองตัวนี้จะไม่มีทางถูกเห็นเลยตอนรันผ่าน SSH ทั้งที่ถูกส่งขึ้นฐานข้อมูล
    who = f" name={summary.name}" if summary.name else ""
    mood = f" emotion={summary.emotion}" if summary.emotion else ""
    # `?` = ท่าที่เดาจากหลักฐานอ้อม ตรงกับที่ HUD ใช้อยู่ (ดู body.posture)
    pose = (
        f" posture={summary.posture}{'' if summary.posture_confident else '?'}"
        if summary.posture
        else ""
    )
    # ขึ้นเฉพาะตอนใช้อยู่ ด้วยเหตุผลเดียวกับบน HUD — บรรทัดนี้ยาวอยู่แล้ว
    # และ "phone=False" ทุกบรรทัดตลอดวันไม่ได้บอกอะไรที่ไม่รู้อยู่แล้ว
    on_phone = f" phone{'' if summary.phone_confident else '?'}" if summary.phone else ""
    print(
        f"[{stamp}] person={summary.person}{who}{mood}{pose}{on_phone} faces={summary.face_count} "
        f"(usable {summary.usable_faces}) movement={summary.movement} ({per_min:.1f}/min) "
        f"blinks={summary.blinks} avgEAR={ear} | {dirs}{flag}"
    )


def handle_key(
    key, an, tracker, tracks, display_cfg, cfg, readings, faces, now, threshold, mode
) -> bool:
    """จัดการปุ่มลัดหนึ่งครั้ง — คืน False เมื่อผู้ใช้สั่งออกจากโปรแกรม

    แยกออกมาเป็นฟังก์ชันเพราะทั้งโหมดห้องรวมและโหมดรายบุคคลใช้ปุ่มชุดเดียวกัน
    ถ้าปล่อยไว้ในลูปจะต้องเขียนซ้ำสองที่แล้วมีวันที่ทั้งสองที่ไม่ตรงกัน
    """
    if key in EXIT_KEYS:
        return False
    if key == KEY_RECALIBRATE:
        an.recalibrate(tracks)
        print("[pi-vision] calibrate ท่านิ่งใหม่จากภาพสด (ไม่ใช้ค่าจากรูปแล้ว) — มองตรงเข้ากล้อง")
    elif key == KEY_TOGGLE_MESH:
        display_cfg["draw_mesh"] = not display_cfg["draw_mesh"]
    elif key == KEY_EMOTION:
        display_cfg["show_emotion_scores"] = not display_cfg.get("show_emotion_scores")
        state = "เปิด" if display_cfg["show_emotion_scores"] else "ปิด"
        print(f"[pi-vision] คะแนนอารมณ์ดิบ: {state}")
    elif key == KEY_FORGET:
        tracker.forget_all()
        print("[pi-vision] ลืมทุก id และลายเซ็นโครงหน้าแล้ว")
    elif key == KEY_FLUSH:
        usable = sum(1 for r in readings if r.usable)
        measured = sum(1 for r in readings if r.usable and not r.calibrating)
        forced = az.WindowSummary(
            started_at=now - cfg["window"]["seconds"],
            ended_at=now,
            # โหมดห้องรวมต้องไม่มี id หลุดออกไป แม้แต่ในสรุปที่กดเอง
            person=(readings[0].person_id if readings and mode.report_person else None),
            movement=sum(r.movement_in_window for r in readings),
            direction=az.empty_direction_counts(),
            face_count=len(faces),
            avg_ear=(
                (sum(r.ear for r in readings) / len(readings))
                if readings and mode.eyes
                else None
            ),
            blinks=sum(r.blinks for r in readings) if mode.eyes else 0,
            usable_faces=usable,
            occupancy=an.occupancy(),
            attention_ratio=an.attention_ratio(),
            people_measured=measured,
        )
        print_summary(forced, threshold, mode)
    return True


class CameraMenu:
    """เมนูเลือกกล้องที่วาดทับหน้าต่างแสดงผล — กด v เปิด/ปิด, เลข 1–9 สลับกล้อง

    เก็บ state ไว้ที่เดียวเพราะทั้งโหมดห้องรวมและรายบุคคลใช้เมนูเดียวกัน
    ถ้าปล่อยให้แต่ละโหมดจัดการเองจะต้องเขียนซ้ำแล้วมีวันหลุดไม่ตรงกัน
    """

    # '1'→0 ... '9'→8 : เลขบนแป้นแมปเป็น index ในรายการกล้อง
    DIGITS = {ord(str(n)): n - 1 for n in range(1, 10)}

    def __init__(self):
        self.open = False
        self.cameras: list[dict] = []
        self.message = ""
        self._scan = None          # thread ที่กำลังสำรวจกล้องอยู่ (None = ไม่มี)
        self._scan_out = None      # ที่พักผลลัพธ์จาก thread

    def _active(self, camera):
        if camera.backend is None:
            return None
        return (camera.backend.name, camera.cfg.get("usb_index"))

    @property
    def scanning(self) -> bool:
        return self._scan is not None and self._scan.is_alive()

    def _start_scan(self, camera) -> None:
        """สำรวจกล้องใน thread แยก — บน Windows การ probe ด้วย OpenCV เปิดอุปกรณ์ทีละตัว
        ซึ่งช้ามาก ถ้าทำบน thread หลักลูปแสดงผลจะค้าง เมนูจึงขึ้น "scanning…" ไปก่อน
        """
        self.cameras = []
        self.message = ""
        self._scan_out = None
        active = self._active(camera)
        cfg = dict(camera.cfg)  # snapshot กัน thread อ่าน cfg ตอน switch() กำลังแก้

        def work():
            self._scan_out = list_cameras(cfg, active)

        self._scan = threading.Thread(target=work, daemon=True)
        self._scan.start()

    def _poll_scan(self) -> None:
        """ดึงผลจาก thread เมื่อสำรวจเสร็จ — เรียกทุกเฟรมตอนเมนูเปิด"""
        if self._scan is not None and not self._scan.is_alive():
            self.cameras = self._scan_out or []
            self.message = "" if self.cameras else "no cameras found"
            self._scan = None

    def handle(self, key, camera) -> bool:
        """คืน True ถ้าเมนู "กิน" ปุ่มนี้ไปแล้ว (main จะได้ไม่ส่งต่อให้ handle_key)"""
        if not self.open:
            if key == KEY_CAMERA_MENU:
                self.open = True
                self._start_scan(camera)
                return True
            return False

        self._poll_scan()
        # เมนูเปิดอยู่ — ทุกปุ่มถือเป็นของเมนู ไม่ส่งต่อให้ปุ่มลัดอื่น
        if key in EXIT_KEYS or key == KEY_CAMERA_MENU:
            self.open = False
        elif key in self.DIGITS and not self.scanning:
            i = self.DIGITS[key]
            if i < len(self.cameras):
                self._select(self.cameras[i], camera)
        return True

    def _select(self, choice, camera) -> None:
        try:
            camera.switch(choice["source"],
                          choice["index"] if choice["source"] == "usb" else None)
            print(f"[pi-vision] สลับไปกล้อง: {choice['label']}")
            self.open = False
        except CameraError as exc:
            self.message = "cannot open that camera"
            print(f"[pi-vision] {exc}", file=sys.stderr)

    def draw(self, frame) -> None:
        if not self.open:
            return
        self._poll_scan()
        if self.scanning:
            ov.draw_menu(frame, "choose camera",
                         [("scanning cameras…", "muted")], "v / Esc to close")
            return
        items = [
            (f"{i + 1}. {c['label']}" + ("   (current)" if c.get("current") else ""),
             "ok" if c.get("current") else "ink")
            for i, c in enumerate(self.cameras)
        ]
        if not self.cameras:
            items.append(("(no cameras found)", "muted"))
        footer = self.message or "press 1-9 to switch  ·  v / Esc to close"
        ov.draw_menu(frame, "choose camera", items, footer)


class ResolutionMenu:
    """เมนูเปลี่ยนความละเอียดขณะรัน — กด r เปิด/ปิด, เลข 1–9 เลือกโหมด

    แยกจาก CameraMenu เพราะเป็นคนละคำถาม (จะใช้กล้อง**ตัวไหน** กับ จะใช้**โหมดไหน**
    ของกล้องตัวนั้น) และรายการต้องเปลี่ยนตามกล้องที่กำลังเปิดอยู่

    ไม่ต้องใช้ thread เหมือน CameraMenu เพราะการถามรายการโหมดใช้เวลา ~0.16 วินาที
    (ถามไดรเวอร์เฉย ๆ ไม่เปิดสตรีม) ต่างจากการสำรวจกล้องซึ่งเคยกินเป็นนาที
    """

    DIGITS = CameraMenu.DIGITS

    # โหมดที่ช้ากว่านี้ไม่ต้องเอามาโชว์ — กล้องมักมีโหมดความละเอียดสูงมากที่วิ่งได้
    # 2 fps ซึ่งใช้กับงานนี้ไม่ได้เลย และถ้าปล่อยไว้มันจะกินช่องเลข 1–9 จนโหมดที่
    # ใช้ได้จริงหลุดออกจากรายการ (C922 มีโหมดแบบนั้นสี่ตัวเรียงอยู่หัวลิสต์พอดี)
    MIN_FPS = 10.0

    def __init__(self):
        self.open = False
        self.sizes: list[tuple[int, int, float]] = []
        self.message = ""

    def _refresh(self, camera) -> None:
        # ถามใหม่ทุกครั้งที่เปิดเมนู — ถูกกว่าการจำไว้แล้วลืม invalidate ตอนสลับกล้อง
        usable = [m for m in camera.sizes() if m[2] >= self.MIN_FPS]
        self.sizes = usable[:len(self.DIGITS)]
        self.message = "" if self.sizes else "this camera cannot list its modes"

    def handle(self, key, camera) -> bool:
        """คืน True ถ้าเมนู "กิน" ปุ่มนี้ไปแล้ว"""
        if not self.open:
            if key == KEY_RESOLUTION:
                self.open = True
                self._refresh(camera)
                return True
            return False

        if key in EXIT_KEYS or key == KEY_RESOLUTION:
            self.open = False
        elif key in self.DIGITS:
            i = self.DIGITS[key]
            if i < len(self.sizes):
                self._select(self.sizes[i], camera)
        return True

    def _select(self, size, camera) -> None:
        w, h, _fps = size
        try:
            got = camera.resize(w, h)
            print(f"[pi-vision] เปลี่ยนความละเอียดเป็น {got[0]}×{got[1]}")
            self.open = False
        except CameraError as exc:
            self.message = "cannot use that mode"
            print(f"[pi-vision] {exc}", file=sys.stderr)

    def draw(self, frame, camera) -> None:
        if not self.open:
            return
        # เทียบกับ camera.actual ไม่ใช่ขนาดของ frame — frame ผ่านการหมุนมาแล้ว
        # ถ้าตั้ง CAMERA_ROTATE=90 ด้านกว้างกับด้านสูงจะสลับกัน แล้วไม่มีแถวไหนตรงเลย
        now = camera.actual
        items = []
        for i, (w, h, fps) in enumerate(self.sizes):
            current = "   (current)" if (w, h) == now else ""
            items.append((f"{i + 1}. {w}x{h}   {w / h:.2f}   up to {fps:.0f}fps{current}",
                          "ok" if current else "ink"))
        if not self.sizes:
            items.append(("(no modes reported)", "muted"))
        footer = self.message or "press 1-9 to switch  ·  r / Esc to close"
        ov.draw_menu(frame, "choose resolution", items, footer)


class EnrollMenu:
    """
    ถ่ายรูปลงทะเบียนจากกล้องสด — กด n · พิมพ์ชื่อ · เคาะ space ถ่าย · Esc จบ

    ทำไมต้องมี: การเพิ่มคนใหม่เคยต้องหารูปจากที่อื่นมาวางใน faces/ ซึ่งบนเครื่องที่
    รันจริง (Pi ที่ต่อแค่กล้องกับจอ) แปลว่าต้องต่อคีย์บอร์ด ต่อ USB หรือ ssh เข้าไป
    ทั้งที่กล้องตัวที่จะใช้จำหน้าคนนั้นเสียบอยู่ตรงหน้าแล้ว · และรูปจากกล้องตัวนั้นเอง
    เป็นรูปลงทะเบียนที่ดีที่สุดอยู่แล้ว เพราะมุมกล้อง แสง และเลนส์ตรงกับตอนใช้งานจริง
    (faces/README.txt แนะนำข้อนี้ไว้ตั้งแต่ต้น)

    ⚠️ **บันทึกเป็นภาพครอปรอบใบหน้าที่ใหญ่ที่สุดในเฟรม ไม่ใช่เฟรมทั้งใบ**
    ตัวอ่านรูปลงทะเบียนตั้ง num_faces=1 (ดู build_photo_reader) ถ้ามีคนอื่นติดอยู่ใน
    เฟรมด้วย มันจะเลือกหน้าเองหนึ่งหน้าโดยไม่บอกใคร — ชื่อที่เพิ่งพิมพ์ก็ไปผูกกับหน้า
    ของคนอื่นเงียบ ๆ · การครอปเองที่นี่ทำให้ "คนที่ยืนใกล้กล้องที่สุด" เป็นกฎที่ผู้ใช้
    มองเห็นได้จากมุมเล็งบนจอ แทนที่จะเป็นการเดาของโมเดล

    กรอบครอปมีอัตราส่วนเท่าเฟรมเสมอ (roi.crop_rect) ลายเซ็นที่ถอดจากรูปนี้จึงเทียบ
    กับภาพสดของกล้องตัวเดียวกันได้ตรง ๆ — เหตุผลเต็มอยู่ที่หัวไฟล์ roi.py
    """

    # ตัวอักษรที่พิมพ์ลงชื่อได้ — ชื่อนี้กลายเป็น**ชื่อโฟลเดอร์** จึงกันอักขระที่ทำให้
    # ได้ path แปลก ๆ ออกทั้งหมด · cv2.waitKey คืนได้แค่ ASCII อยู่แล้ว จึงพิมพ์ไทยไม่ได้
    ALLOWED = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
    BACKSPACE = {8, 127}          # 8 บนวินโดวส์/GTK · 127 บน backend อื่นบางตัว
    NAME_MAX = 24
    # ส่วนเผื่อรอบใบหน้าตอนครอป เรียงจากที่อยากได้ไปหาที่แคบที่สุดที่ยอมรับได้
    # เลือกตัวแรกที่**ไม่มีหน้าคนอื่นติดมาด้วย** (ดู _isolated_crop)
    #
    # วัดกับรูปในโฟลเดอร์ 6 คน: ครอปแคบไม่ได้ทำให้หาใบหน้าไม่เจอเลย — ที่ margin 0.10
    # ยังเจอ 6/6 เท่ากับที่ 0.60 · สิ่งที่ทำให้หาไม่เจอคือ**ใบหน้าเล็กเกินไปตั้งแต่ในเฟรม**
    # ซึ่ง min_size กันไว้อีกชั้นแล้ว · การไล่ลงมาจึงไม่ได้แลกความเสี่ยงกับอะไร
    MARGINS = (0.6, 0.5, 0.4, 0.3, 0.2, 0.15)

    def __init__(self, directory, min_size: float, enabled: bool = True):
        self.directory = Path(directory)
        # ใบหน้าต้องกินพื้นที่อย่างน้อยเท่านี้ของความกว้างเฟรมถึงจะถ่ายได้ — ใช้เกณฑ์
        # เดียวกับที่แกลเลอรีใช้ตัดสินว่าใบหน้าใหญ่พอจะเชื่อลายเซ็นไหม (FACES_MIN_SIZE)
        # ⚠️ ต้องเป็นค่าดิบจาก config ไม่ใช่ค่าที่โหมดซูมลดให้ (modes.ZOOMED_MIN_SIZE)
        # เกณฑ์ที่ลดแล้วมีไว้สำหรับภาพครอปที่ถูกขยายก่อนอ่าน ส่วนรูปที่บันทึกลงดิสก์
        # ไม่มีใครขยายให้ — ครอปหน้ากว้าง 26 px มาเก็บไว้คือเก็บรูปที่หาหน้าไม่เจอ
        self.min_size = min_size
        self.enabled = enabled
        self.open = False
        self.name = ""
        self.message = ""
        self.shots = 0                # ถ่ายไปกี่ใบตั้งแต่เปิดเมนูรอบนี้
        self.saved = False            # มีรูปใหม่ลงดิสก์ไหม — main เอาไปสั่งอ่านแกลเลอรีใหม่
        self._counted_name = None     # แคชผลนับไฟล์ กัน iterdir ทุกเฟรม
        self._counted = 0

    # ── การเลือกเป้า ─────────────────────────────────────
    @staticmethod
    def target(readings):
        """คนที่จะถูกถ่าย = ใบหน้าที่ใหญ่ที่สุดในเฟรม (= อยู่ใกล้กล้องที่สุด)

        เลือกด้วยขนาด ไม่ใช่ด้วย id หรือชื่อ เพราะคนที่กำลังลงทะเบียนคือคนที่ระบบ
        **ยังไม่รู้จัก** ตามนิยาม · กฎ "เดินเข้ามาใกล้ที่สุด" ผู้ใช้ทำตามได้ทันที
        และเห็นผลของมันบนจอก่อนกดถ่าย
        """
        best = None
        for r in readings or ():
            if best is None or (r.box[2] - r.box[0]) > (best.box[2] - best.box[0]):
                best = r
        return best

    def _isolated_crop(self, box, others, w: int, h: int):
        """
        กรอบครอปที่กว้างที่สุดที่ยัง**ไม่มีใบหน้าคนอื่นติดมาด้วย** · None = ไม่มีเลย

        ⚠️ นี่คือหัวใจของการถ่ายในห้องที่มีหลายคน ซึ่งวัดแล้วว่าพังจริงถ้าไม่มี:
        วางคนสองคนไว้ในเฟรมเดียว เล็งที่คนซ้ายซึ่งใหญ่กว่า แล้วบันทึกด้วยส่วนเผื่อ 0.6
        ภาพที่ได้ยังมีหน้าคนขวาติดมา · ตอนอ่านแกลเลอรี ตัวอ่าน (num_faces=1) เลือก
        หน้าคนขวา — ชื่อที่พิมพ์จึงไปผูกกับหน้าของอีกคนหนึ่ง **โดยไม่มี error ใด ๆ**
        ที่ margin 0.4 กรอบหดจนคนขวาหลุดออกไป แล้วได้ลายเซ็นของคนที่เล็งจริง ๆ

        ห้าม "แค่หดให้พอดีหน้า" แล้วจบ เพราะระยะห่างของคนสองคนต่างกันทุกครั้ง
        การไล่ลงมาทีละขั้นจึงให้ภาพที่กว้างที่สุดเท่าที่สถานการณ์นั้นยอมให้
        """
        for margin in self.MARGINS:
            x1, y1, x2, y2 = roi.crop_rect(box, w, h, margin)
            clash = False
            for other in others:
                ox1, oy1 = other[0] * w, other[1] * h
                ox2, oy2 = other[2] * w, other[3] * h
                # ซ้อนกันแม้แต่นิดเดียวก็ตัดทิ้ง — หน้าที่โผล่มาครึ่งใบยังถูกตัวตรวจ
                # เลือกได้อยู่ดี และเราไม่มีทางรู้ล่วงหน้าว่ามันจะเลือกใบไหน
                if ox1 < x2 and ox2 > x1 and oy1 < y2 and oy2 > y1:
                    clash = True
                    break
            if not clash:
                return (x1, y1, x2, y2)
        return None

    def _plan(self, readings, w: int, h: int):
        """คืน (เป้า, กรอบที่จะบันทึก, ปัญหาที่ขวางอยู่)

        ตัวเดียวกันนี้ถูกเรียกทั้งตอนวาดและตอนกด space — สิ่งที่ผู้ใช้เห็นบนจอจึงเป็น
        สิ่งที่จะได้จริง ไม่ใช่คำสัญญาที่คำนวณคนละรอบกับของจริง
        """
        target = self.target(readings)
        if target is None:
            return None, None, "no face in frame"
        width = target.box[2] - target.box[0]
        if width < self.min_size:
            # บอกเป็นตัวเลขว่าตอนนี้เท่าไรและต้องการเท่าไร ไม่ใช่แค่ "ใกล้อีก" —
            # คนที่ยืนอยู่หน้ากล้องต้องรู้ว่าเหลืออีกแค่ไหน ไม่งั้นได้แต่ขยับสุ่ม ๆ
            return target, None, (f"face {width * 100:.0f}% of frame — "
                                  f"need {self.min_size * 100:.0f}%, step closer")
        others = [r.box for r in readings if r is not target]
        rect = self._isolated_crop(target.box, others, w, h)
        if rect is None:
            return target, None, "another face is too close — capture one person at a time"
        return target, rect, None

    # ── ปุ่ม ─────────────────────────────────────────────
    def handle(self, key, frame, readings, busy: bool = False) -> bool:
        """คืน True ถ้าเมนู "กิน" ปุ่มนี้ไปแล้ว

        ขณะเปิด **ทุกปุ่มเป็นของช่องพิมพ์ชื่อ** รวมทั้ง q v r c ที่ปกติเป็นปุ่มลัด
        ไม่งั้นชื่ออย่าง "Nicha" จะสั่งเปลี่ยนความละเอียดกลางคัน · ทางออกจึงมีทางเดียว
        คือ Esc ซึ่งเป็นปุ่มเดียวที่ไม่ใช่ตัวอักษร

        `busy` = มีเมนูอื่นเปิดค้างอยู่ · ตอนนั้น n เป็นปุ่มของเมนูนั้น ไม่ใช่ปุ่มเปิด
        การลงทะเบียน — สองแผงที่วาดทับกันพร้อมกันไม่มีทางอ่านออกว่าพิมพ์อยู่ที่ไหน
        """
        if not self.enabled:
            return False
        if not self.open:
            if key == KEY_ENROLL and not busy:
                self._start()
                return True
            return False

        if key == 27:                      # Esc — จบการลงทะเบียน
            self._finish()
        elif key in self.BACKSPACE:
            self.name = self.name[:-1]
            self.message = ""
        elif key == KEY_FLUSH:             # space — ถ่าย
            self._capture(frame, readings)
        elif 0 <= key < 128 and chr(key) in self.ALLOWED and len(self.name) < self.NAME_MAX:
            self.name += chr(key)
            self.message = ""
        return True

    def _start(self) -> None:
        self.open = True
        self.name = ""
        self.message = ""
        self.shots = 0
        print("[pi-vision] ลงทะเบียนใบหน้า: พิมพ์ชื่อ แล้วเคาะ space เพื่อถ่าย (Esc = จบ)")

    def _finish(self) -> None:
        self.open = False
        if self.shots:
            print(f"[pi-vision] ถ่ายรูปของ {self.name} ไป {self.shots} ใบ")
        self.name = ""
        self.message = ""

    def take_saved(self) -> bool:
        """คืน True ครั้งเดียวหลังมีรูปใหม่ลงดิสก์ — main ใช้สั่งอ่านแกลเลอรีใหม่

        แยกจาก shots เพราะ shots ถูกล้างทุกครั้งที่เปิดเมนูใหม่ ส่วนคำถามที่ main ถาม
        คือ "มีอะไรเปลี่ยนบนดิสก์ตั้งแต่ครั้งที่แล้วไหม" ซึ่งเป็นคนละคำถาม
        """
        saved, self.saved = self.saved, False
        return saved

    # ── การถ่าย ──────────────────────────────────────────
    def _capture(self, frame, readings) -> None:
        if not self.name:
            self.message = "type a name first"
            return
        if frame is None:
            self.message = "no frame yet — try again"
            return

        h, w = frame.shape[:2]
        _target, rect, problem = self._plan(readings, w, h)
        if problem:
            self.message = problem
            return
        x1, y1, x2, y2 = rect
        patch = frame[y1:y2, x1:x2]
        if patch.size == 0:
            self.message = "crop landed outside the frame — move to the middle"
            return

        folder = self.directory / self.name
        try:
            folder.mkdir(parents=True, exist_ok=True)
            path = _free_path(folder, f"cam_{time.strftime('%Y%m%d_%H%M%S')}")
            ok = cv2.imwrite(str(path), patch)
        except OSError as exc:
            self.message = "cannot write the file"
            print(f"[pi-vision] เขียนรูปไม่ได้: {exc}", file=sys.stderr)
            return
        if not ok:
            self.message = "cannot write the file"
            return

        self.shots += 1
        self.saved = True
        self._counted_name = None          # จำนวนรูปของคนนี้เปลี่ยนแล้ว
        self.message = f"saved {path.name}  ({patch.shape[1]}x{patch.shape[0]})"
        print(f"[pi-vision] บันทึก {path}")

    def _existing(self) -> int:
        """มีรูปของชื่อนี้อยู่แล้วกี่ใบ — บอกให้รู้ว่ากำลังเพิ่มให้คนเดิมหรือสร้างคนใหม่

        สำคัญกว่าที่คิด เพราะ "donut" กับ "Donut" เป็นคนละคนในสายตาแกลเลอรี
        (ชื่อ = ชื่อโฟลเดอร์) การพิมพ์ผิดตัวเดียวจึงสร้างคนใหม่ที่มีรูปใบเดียวเงียบ ๆ
        """
        if self._counted_name != self.name:
            folder = self.directory / self.name
            self._counted = 0
            if self.name and folder.is_dir():
                self._counted = sum(
                    1 for p in folder.iterdir() if p.suffix.lower() in fc.IMAGE_SUFFIXES
                )
            self._counted_name = self.name
        return self._counted

    # ── การวาด ───────────────────────────────────────────
    def draw(self, frame, readings) -> None:
        if not self.open:
            return
        h, w = frame.shape[:2]
        target, rect, problem = self._plan(readings, w, h)
        if target is not None:
            ov.draw_aim(frame, target.box, "eye" if rect else "danger")
        # กรอบที่จะถูกบันทึกจริง — เห็นก่อนกด ว่าใครติดมาในรูปบ้างและตัดตรงไหน
        if rect:
            cv2.rectangle(frame, (rect[0], rect[1]), (rect[2], rect[3]),
                          ov.COLORS["eye"], 1, ov.LINE)

        # เคอร์เซอร์กะพริบ — ช่องพิมพ์ที่ไม่มีเคอร์เซอร์ดูเหมือนป้ายข้อความเฉย ๆ
        cursor = "_" if int(time.monotonic() * 2) % 2 == 0 else " "
        lines = [(f"name: {self.name}{cursor}", "ink" if self.name else "muted")]

        if not self.name:
            lines.append(("type the name first  (a-z 0-9 - _)", "muted"))
        else:
            already = self._existing()
            lines.append(
                (f"adding to {self.name} — {already} photo(s) already" if already
                 else f"new person: {self.name}", "ok" if already else "warn")
            )

        if problem:
            lines.append((problem, "danger"))
        else:
            lines.append((f"ready — the box is what gets saved  ·  {self.shots} shot(s)"
                          + ("" if self.shots >= 2 else "  ·  take 2-3 from slightly different angles"),
                          "ok"))
        # ข้อความจากการกดครั้งล่าสุด — ไม่ซ้ำกับบรรทัดปัญหาข้างบนซึ่งเป็นสถานะ "ตอนนี้"
        if self.message and self.message != problem:
            lines.append((self.message, "muted"))
        ov.draw_prompt(frame, "capture face", lines,
                       "space = capture  ·  backspace = erase  ·  Esc = done")


def _free_path(folder: Path, stem: str, suffix: str = ".jpg") -> Path:
    """path ที่ยังไม่มีไฟล์อยู่ — กันการถ่ายรัว ๆ ในวินาทีเดียวกันทับกันเอง

    ชื่อไฟล์เป็นเวลาระดับวินาที ซึ่งเคาะ space สองครั้งติดกันก็ชนแล้ว
    """
    path = folder / f"{stem}{suffix}"
    n = 2
    while path.exists():
        path = folder / f"{stem}-{n}{suffix}"
        n += 1
    return path


def main() -> int:
    args = parse_args()
    cfg = CONFIG

    try:
        mode = resolve_mode(args.mode, cfg["mode"])
    except ValueError as exc:
        print(f"[pi-vision] {exc}", file=sys.stderr)
        return 2

    cam_cfg = dict(cfg["camera"])
    if args.source:
        cam_cfg["source"] = args.source        # ระบุมาแล้ว = ไม่ต้องถาม
    elif cam_cfg.get("ask", True):
        # ถามก่อนดาวน์โหลดโมเดลและเปิดกล้อง เพื่อไม่ให้ผู้ใช้รอแล้วค่อยมาเจอคำถาม
        cam_cfg = choose_camera(cam_cfg)

    display_cfg = dict(cfg["display"])
    # โหมดห้องรวมต้องไม่โชว์ id บนภาพ ไม่งั้นคนที่ยืนดูจอตามได้ว่ากรอบไหนคือใคร
    display_cfg["show_person_id"] = mode.report_person
    # โหมดเฉพาะคนในรูป: ใช้ชื่อจากรูปเป็นป้ายหลัก (มี `?` เมื่อเป็นการเดา) — ดู _who()
    display_cfg["known_only"] = mode.known_only
    # โหมดที่ไม่วัดตาต้องไม่วาดจุดตาและไม่โชว์คะแนนตา — ไม่งั้นดูเหมือนวัดอยู่
    display_cfg["show_eyes"] = mode.eyes
    if not mode.eyes:
        display_cfg["draw_eyes"] = False
    if args.no_window:
        display_cfg["enabled"] = False
    if args.mesh:
        display_cfg["draw_mesh"] = True

    tracker_cfg = mode.apply_to_tracker(cfg["tracker"])
    landmarker = build_landmarker(cfg["model"])
    # ตัวตรวจ full-range + ตัวอ่านภาพครอป — คู่กันเสมอ ตัวตรวจอย่างเดียวให้แค่กรอบเปล่า
    detector = build_detector(cfg["detect"]) if mode.full_range else None
    zoom_reader = build_zoom_reader(cfg["model"]) if mode.roi_zoom else None
    if detector is not None:
        print(f"[pi-vision] ตรวจใบหน้าระยะไกลอยู่ (full-range) — เห็นได้ราว 5 เมตร"
              f" จากเดิม 2 เมตร")
    if zoom_reader is not None:
        print(f"[pi-vision] ซูมเข้าที่ใบหน้าก่อนอ่าน landmark"
              f" (สูงสุด {cfg['roi']['max_per_frame']} หน้า/เฟรม)"
              " — คนไกลจึงมีชื่อ · วัดตาได้ · อ่านอารมณ์ได้")
    # โมเดลท่าทางร่างกายโหลดเฉพาะโหมดที่ใช้จริง — โหมดอื่นไม่จ่ายทั้งดิสก์และ CPU
    body_landmarker = build_body_landmarker(cfg["body"]) if mode.activity else None
    if body_landmarker is not None:
        every = max(1, cfg["body"]["every_n_frames"])
        print(f"[pi-vision] อ่านท่าทางร่างกายอยู่ (ทุก {every} เฟรม"
              f" · สูงสุด {cfg['body']['max_people']} คน) — ยกมือ · โบกมือ · กอดอก"
              " · เท้าเอว · ชี้ · ยืน/นั่ง/นอน")
    if body_landmarker is not None:
        print("[pi-vision]   ยืน/นั่ง ต้องเห็นขา ไม่เห็นก็ไม่ตอบ · นอนใช้แค่ลำตัว จึงตอบได้เสมอ")
        print("[pi-vision]   ป้ายที่ขึ้นคือ**ท่า** ไม่ใช่เจตนา — 'hand up' รวมการยืดเส้นด้วย")

    # ตัวตรวจโทรศัพท์ต้องมีโมเดลท่าทางอยู่ด้วย — ไม่มีข้อมือก็บอกไม่ได้ว่าใครถือ
    # (ยังมีชั้นเดาจากใบหน้าอยู่ แต่ชั้นนั้นมีไว้เสริมตอนมองไม่เห็นข้อมือ ไม่ใช่แทนทั้งหมด)
    phone_detector = None
    phone_every = 1
    if body_landmarker is not None and cfg["phone"]["enabled"]:
        try:
            phone_detector = build_phone_detector(cfg["phone"])
        except Exception as exc:
            # ของเสริม — โหลดไม่ได้ก็เดินต่อโดยไม่มีป้ายโทรศัพท์ ไม่ใช่ล้มทั้งโปรแกรม
            print(f"[pi-vision] โหลดตัวตรวจโทรศัพท์ไม่ได้ ({exc}) — ข้ามฟีเจอร์นี้", file=sys.stderr)
    if phone_detector is not None:
        every = max(1, cfg["phone"]["every_n_frames"])
        # ปัดขึ้นให้ตรงกับจังหวะของโมเดลท่าทาง: ถ้าไม่ตรง ตัวตรวจจะทำงานในเฟรมที่
        # ไม่มี pose ให้จับคู่ ผลคือจ่าย CPU ไปแล้วทิ้งผลทั้งหมด
        body_n = max(1, cfg["body"]["every_n_frames"])
        phone_every = ((every + body_n - 1) // body_n) * body_n
        if cfg["phone"]["nearest_always"]:
            print(f"[pi-vision] ตรวจการใช้โทรศัพท์อยู่ (ทุก {phone_every} เฟรม)"
                  " — ยกทุกเครื่องที่เห็นให้คนที่อยู่ใกล้ที่สุด")
            print("[pi-vision]   ⚠️ โทรศัพท์ที่วางบนโต๊ะก็ถูกนับด้วย · ป้ายที่มี `?` ="
                  " แค่ใกล้ที่สุด ไม่ได้เห็นอยู่ในมือ (คอลัมน์ phone_confident=false)")
        else:
            print(f"[pi-vision] ตรวจการใช้โทรศัพท์อยู่ (ทุก {phone_every} เฟรม)"
                  " — โหมดเข้ม: นับเฉพาะเครื่องที่มีหลักฐานว่าถืออยู่")
            print("[pi-vision]   โทรศัพท์ที่วางบนโต๊ะไม่ถูกนับ · ป้ายที่มี `?` = เดาจากตำแหน่ง"
                  "เพราะมองไม่เห็นข้อมือ")
    tracker = PersonTracker(tracker_cfg)
    an = az.FaceAnalyzer(cfg, mirror=cam_cfg["mirror"],
                         report_person=mode.report_person, track_eyes=mode.eyes,
                         known_only=mode.known_only)

    # ส่งข้อมูลขึ้น Supabase — ไม่ตั้ง url/key ก็แค่ไม่ส่ง โปรแกรมทำงานครบเหมือนเดิม
    uploader = up_mod.Uploader(cfg["supabase"])
    if uploader.enabled:
        table = cfg["supabase"]["room_table"] if not mode.report_person else cfg["supabase"]["focus_table"]
        if table:
            print(f"[pi-vision] ส่งข้อมูลขึ้นตาราง {table}")
        else:
            print("[pi-vision] โหมดนี้ยังไม่มีตารางรองรับ — ไม่ส่งข้อมูล")
        uploader.start()
    else:
        print("[pi-vision] ไม่ได้ตั้ง SUPABASE_URL/KEY — แสดงผลบนจอเท่านั้น")

    # แกลเลอรีใบหน้าจากรูปในโฟลเดอร์ — ว่างไว้ = ระบบใช้ id ตัวเลขเหมือนเดิมทุกอย่าง
    # โหมดห้องรวมไม่รายงานรายบุคคล จึงไม่โหลดแกลเลอรีเลย ไม่ใช่แค่ไม่แสดงชื่อ
    gallery = None
    photo_reader = None
    # ท่านิ่งจากรูปของแต่ละคน (ว่าง = ไม่มีใครใช้ได้ หรือวิธีวัดไม่รองรับ)
    # อ่านใหม่ทุกครั้งที่แกลเลอรีถูกอ่านใหม่ เพราะรูปที่เปลี่ยนคือจุดอ้างอิงที่เปลี่ยน
    neutrals: dict = {}
    use_photo_neutral = photo_neutral_supported(cfg["pose"], cfg["model"])
    if mode.gallery:
        faces_dir = fc.ensure_directory(cfg["faces"]["dir"])
        try:
            # ส่ง cam_cfg เข้าไปด้วย เพื่อให้รูปลงทะเบียนถูกตัดเป็นอัตราส่วนเดียวกับ
            # ภาพจากกล้องก่อนถอดลายเซ็น — ไม่งั้นรูปแนวตั้งจะเทียบกับภาพสดไม่ได้เลย
            detect_photo, photo_reader = build_photo_reader(cfg["model"], cam_cfg, cfg["roi"])
        except Exception as exc:
            # การจำชื่อเป็นของเสริม — ถ้าตัวอ่านรูปสร้างไม่ได้ ให้เดินต่อด้วยหมายเลข
            # ไม่ใช่ล้มทั้งบริการ เพราะการวัดการจดจ่อยังทำงานได้ครบโดยไม่มีชื่อ
            print(f"[pi-vision] อ่านรูปใบหน้าไม่ได้ ({exc}) — ใช้หมายเลขแทนชื่อ")
        else:
            gallery = fc.FaceGallery(faces_dir, mode.apply_to_faces(cfg["faces"]),
                                     fc.landmark_extractor(detect_photo))
            known = gallery.scan()
            if known:
                print(f"[pi-vision] จำได้ {known} คนจากรูปใน {faces_dir}: {', '.join(gallery.names)}")
                print_calibration(gallery)
                if use_photo_neutral:
                    neutrals = photo_neutrals(gallery, cfg["pose"])
                elif cfg["pose"].get("neutral_from_photos", True):
                    print("[pi-vision] วิธีวัดการหันหน้าแบบ matrix ใช้ท่านิ่งจากรูปไม่ได้ "
                          "(คนละหน่วย) — ทุกคนยัง calibrate ท่านิ่งเองตามเดิม")
            elif mode.known_only:
                # โหมดนี้รู้จักคนจากรูปเท่านั้น ไม่มีรูป = ไม่มีใครถูกบันทึกเลย
                # ไม่ปิดโปรแกรม เพราะแกลเลอรีถูกอ่านซ้ำทุก ๆ ไม่กี่วินาที วางรูปตอนนี้ก็ติด
                print(f"[pi-vision] ! ยังไม่มีรูปใน {faces_dir} — โหมดนี้จะไม่บันทึกใครเลย")
                print("[pi-vision]   วางรูป (ตั้งชื่อไฟล์เป็นชื่อคน) ลงโฟลเดอร์นั้นได้เลยตอนนี้")
            else:
                print(f"[pi-vision] ยังไม่มีรูปใน {faces_dir} — ใช้หมายเลขแทนชื่อ")
            for path in gallery.skipped:
                print(f"[pi-vision] ข้ามรูปนี้ หาใบหน้าไม่เจอ: {path}")

    # นำเข้าตรงนี้เพราะต้องใช้หลัง mediapipe พร้อมแล้วเท่านั้น
    import mediapipe as mp

    camera = Camera(cam_cfg)
    try:
        backend_name = camera.open()
    except CameraError as exc:
        print(f"[pi-vision] {exc}", file=sys.stderr)
        return 1

    print(f"[pi-vision] โหมด: {mode.label} — {mode.summary}")
    # รายงานขนาด**ที่ได้จริง** ไม่ใช่ขนาดที่ขอ — กล้องมีสิทธิ์ให้โหมดอื่นแทน และเฟรม
    # ที่ใหญ่กว่าที่คิดไว้คือสาเหตุที่ไปป์ไลน์ช้าลงแบบหาต้นเหตุไม่เจอ
    got = camera.actual or (cam_cfg["width"], cam_cfg["height"])
    note = f" · {camera.mode_note}" if camera.mode_note else ""
    print(f"[pi-vision] กล้อง: {backend_name} · {camera.label or 'ไม่ทราบรุ่น'} · "
          f"{got[0]}×{got[1]}{note}")
    if neutrals:
        # คนที่มีรูปไม่ต้องรอ ส่วนคนที่ไม่มีรูปยังต้องนั่งนิ่ง — ต้องบอกให้ครบทั้งสองอย่าง
        # ไม่งั้นคนที่ไม่มีรูปจะไม่รู้ว่าทำไมตัวเองต้องรอคนเดียว
        print(
            f"[pi-vision] คนที่มีรูปใช้ท่านิ่งจากรูปทันที · คนอื่น calibrate "
            f"{cfg['pose']['calibration_seconds']:.0f} วินาที — นั่งมองตรงเข้ากล้องไว้ก่อน"
        )
    else:
        print(
            f"[pi-vision] calibrate ท่านิ่ง {cfg['pose']['calibration_seconds']:.0f} วินาที — "
            "นั่งมองตรงเข้ากล้องไว้ก่อน"
        )
    if not mode.signatures:
        print("[pi-vision] โหมดนี้ไม่คำนวณลายเซ็นโครงหน้าเลย — ไม่มีข้อมูลชีวมิติถูกเก็บ")
    if mode.known_only:
        print("[pi-vision] โหมดนี้ไม่เก็บลายเซ็นของคนที่ไม่มีรูปไว้จำ และไม่บันทึกข้อมูลของเขา")
    if cfg["emotion"]["enabled"]:
        # ประกาศให้รู้เหมือนที่ re-ID ประกาศ เพราะไม่งั้นคนที่หน้านิ่งจะไม่เห็นอะไรบนจอ
        # แล้วสรุปว่าฟีเจอร์ไม่ทำงาน ทั้งที่ neutral คือคำตอบที่ถูกต้องของหน้านิ่ง
        print(
            f"[pi-vision] อ่านอารมณ์จากใบหน้าอยู่ (เกณฑ์ {cfg['emotion']['threshold']:.2f}) — "
            "หน้านิ่งขึ้น neutral · กด e เพื่อดูคะแนนดิบ"
        )
    if tracker_cfg["reid_enabled"]:
        print(
            "[pi-vision] re-ID เปิดอยู่ — จำลายเซ็นโครงหน้าไว้ใน RAM "
            f"{cfg['tracker']['reid_memory_seconds']:.0f} วินาที (ไม่เขียนลงดิสก์) · กด f เพื่อลืมทันที"
        )
    if display_cfg["enabled"]:
        print("[pi-vision] ปุ่มลัด: q=ออก · c=calibrate ใหม่ · m=mesh · f=ลืม id · "
              "e=คะแนนอารมณ์ · v=เลือกกล้อง · r=ความละเอียด · space=สรุปทันที"
              + (" · n=ถ่ายรูปลงทะเบียน" if mode.gallery else ""))

    fps = 0.0
    last_t = time.monotonic()
    cam_menu = CameraMenu()
    res_menu = ResolutionMenu()
    # ถ่ายรูปลงทะเบียนได้เฉพาะโหมดที่อ่านรูปใน faces/ — โหมดห้องรวมสัญญาว่าจะไม่แยก
    # รายบุคคลเลย การเก็บรูปหน้าคนลงดิสก์จากในโหมดนั้นจึงขัดกับสิ่งที่โหมดบอกผู้ใช้ไว้
    enroll = EnrollMenu(cfg["faces"]["dir"], cfg["faces"]["min_size"],
                        enabled=mode.gallery and display_cfg["enabled"])
    threshold = cfg["window"]["movement_threshold_per_min"]
    reid_on = tracker_cfg["reid_enabled"]

    # จำกัดความถี่ของลูปเอง — ไม่งั้นในโหมด --no-window (ไม่มี waitKey มาหน่วงให้)
    # โปรแกรมจะวนเร็วสุดกำลังและกิน CPU จนไปแย่งเวลาของงานอื่นบน Pi
    frame_interval = 1.0 / max(cam_cfg["fps"], 1)
    next_frame_at = time.monotonic()
    frame_no = 0
    body_every = max(1, cfg["body"]["every_n_frames"])
    # จำว่าซูมช่องไหนไปเมื่อไร (วนคิวให้ทั่ว) และกรอบครอปล่าสุดของช่องนั้น (กันกระตุก)
    # ผูกกับตำแหน่งบนภาพ ไม่ใช่ id เพราะคนไกลยังไม่มี id — ดู _cell()
    zoom_seen: dict[tuple[int, int], float] = {}
    zoom_rects: dict[tuple[int, int], tuple] = {}
    ZOOM_MEMORY = 10.0                 # ลืมช่องที่ไม่มีใครอยู่แล้ว กันโตไม่จำกัด
    # กรอบโทรศัพท์ล่าสุด — คงไว้ระหว่างเฟรมที่ไม่ได้ตรวจ ไม่งั้นกรอบบนจอกระพริบ
    # ตามจังหวะ phone_every ทั้งที่โทรศัพท์ไม่ได้ไปไหน
    phone_boxes: list = []

    try:
        while True:
            sleep_for = next_frame_at - time.monotonic()
            if sleep_for > 0:
                time.sleep(sleep_for)
            next_frame_at = max(time.monotonic(), next_frame_at + frame_interval)

            try:
                frame = camera.read()
            except CameraError as exc:
                print(f"[pi-vision] {exc}", file=sys.stderr)
                return 1

            # สำเนาเฟรม**ก่อนวาดอะไรลงไป** — ไว้ให้การถ่ายรูปลงทะเบียนใช้
            # การถ่ายเกิดตอนจัดการปุ่ม ซึ่งอยู่ท้ายลูป หลัง HUD กับกรอบถูกวาดทับ frame
            # ไปแล้ว · ถ่ายจากตัวนั้นคือได้รูปที่มีตัวหนังสือ HUD ติดอยู่บนหน้าคน
            # คัดลอกเฉพาะตอนเมนูเปิดอยู่ ไม่งั้นจ่ายค่า copy ทุกเฟรมเพื่อสิ่งที่แทบไม่ใช้
            clean = frame.copy() if enroll.open else None

            now = time.monotonic()
            frame_no += 1
            dt = now - last_t
            last_t = now
            if dt > 0:
                fps = FPS_SMOOTHING * fps + (1 - FPS_SMOOTHING) * (1.0 / dt)

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            # detect_for_video ต้องได้ timestamp เป็น ms และ **ต้องเพิ่มขึ้นเสมอ**
            result = landmarker.detect_for_video(mp_image, int(now * 1000))

            face_landmarks = list(result.face_landmarks or [])
            blendshapes = list(getattr(result, "face_blendshapes", None) or [])
            matrices = list(getattr(result, "facial_transformation_matrixes", None) or [])

            # ── คนที่อยู่ไกลเกินกว่า landmarker จะเห็นจากภาพเต็ม ──────────
            # ตัวตรวจ full-range หากรอบมาให้ แล้วซูมเข้าไปอ่าน landmark จากภาพครอป
            # ผลที่ได้ต่อท้ายเข้าไปในลิสต์ชุดเดียวกัน — โค้ดข้างล่างจึงไม่ต้องรู้เลย
            # ว่าใบหน้าไหนมาจากภาพเต็มและใบหน้าไหนมาจากการซูม
            zoom_boxes = []
            # อัตราขยายของแต่ละใบหน้า เรียงตรงกับ face_landmarks — ใบหน้าที่อ่านจาก
            # ภาพเต็มเป็น 1.0 ส่วนที่ต่อท้ายจากการซูมมีค่าจริง (ดู az.FaceInput.detail_scale)
            zoom_grow = [1.0] * len(face_landmarks)
            if detector is not None and zoom_reader is not None:
                for key in [k for k, t in zoom_seen.items() if now - t > ZOOM_MEMORY]:
                    zoom_seen.pop(key, None)
                    zoom_rects.pop(key, None)
                seen = detector.detect_for_video(mp_image, int(now * 1000))
                far = detect.unmatched(
                    detect.to_boxes(seen.detections, frame.shape[1], frame.shape[0]),
                    [lm.bounding_box(p) for p in face_landmarks],
                    cfg["detect"]["merge_iou"],
                )
                # กรอบที่ซูมไปแล้วเมื่อไรจำไว้ตามตำแหน่ง เพื่อวนคิวให้ทั่วเมื่อคนเยอะ
                # กว่าโควตา · กรอบที่ยังไม่เคยซูมได้คิวก่อนเสมอ (roi.NEVER)
                for found in roi.pick(far, cfg["roi"]["max_per_frame"],
                                      lambda f: zoom_seen.get(_cell(f.box), roi.NEVER)):
                    cell = _cell(found.box)
                    zoom_seen[cell] = now
                    points, shapes, matrix, rect, grow = zoom_read(
                        zoom_reader, frame, found.box, cfg["roi"], zoom_rects.get(cell)
                    )
                    zoom_rects[cell] = rect
                    if points is None:
                        continue          # กรอบผีจากตัวตรวจ — ทิ้งไป ลองใหม่เฟรมหน้า
                    zoom_boxes.append(rect)
                    face_landmarks.append(points)
                    blendshapes.append(shapes)
                    matrices.append(matrix)
                    zoom_grow.append(grow)

            detections = []
            inputs = []
            for i, points in enumerate(face_landmarks):
                cx, cy = lm.centroid(points)
                detections.append(
                    Detection(
                        cx=cx,
                        cy=cy,
                        box=lm.bounding_box(points),
                        signature=lm.face_signature(points) if mode.signatures else None,
                    )
                )
                inputs.append(
                    az.FaceInput(
                        landmarks=points,
                        blendshapes=_nth(blendshapes, i),
                        matrix=_nth(matrices, i),
                        detail_scale=_nth(zoom_grow, i) or 1.0,
                    )
                )

            tracks = tracker.assign(detections, now)

            # ── ท่าทางร่างกาย ────────────────────────────────
            # ไม่ทำทุกเฟรม: ท่าทางเปลี่ยนช้ากว่าเฟรมมาก และโมเดลนี้แพงที่สุดในลูป
            # เฟรมที่ข้ามยังแสดงป้ายเดิมอยู่ เพราะ GestureHold เก็บไว้ใน track.state
            # (frame_no - 1) ไม่ใช่ frame_no — เฟรมแรกต้องได้อ่านท่าทางเลย ไม่ใช่รอถึงเฟรมที่ 4
            if body_landmarker is not None and (frame_no - 1) % body_every == 0:
                body_result = body_landmarker.detect_for_video(mp_image, int(now * 1000))
                poses = body_result.pose_landmarks or []
                # landmark หน่วยเมตรสามแกน เรียงตรงกับ poses — ใช้วัดมุมต้นขา/ลำตัว
                worlds = body_result.pose_world_landmarks or []
                bodies = attach_bodies(tracks, poses)

                # ── โทรศัพท์ ──────────────────────────────────
                # อยู่ในบล็อกเดียวกับท่าทางเพราะการจับคู่ต้องใช้ข้อมือของ**เฟรมนี้**
                # (phone_every ถูกปัดขึ้นเป็นจำนวนเท่าของ body_every ตอนเริ่มแล้ว)
                # เฟรมที่ข้ามยังคงป้ายเดิมไว้ เพราะ PhoneHold อยู่ใน track.state
                held = {}
                if phone_detector is not None and (frame_no - 1) % phone_every == 0:
                    seen_phones = ph.to_boxes(
                        phone_detector.detect_for_video(mp_image, int(now * 1000)).detections,
                        frame.shape[1], frame.shape[0], cfg["phone"]["min_score"],
                    )
                    phone_boxes = [p.box for p in seen_phones]      # ไว้วาดบนจอ
                    held = ph.assign(
                        seen_phones,
                        [
                            ph.Person(
                                key=t.person_id,
                                face_box=t.box,
                                points=_nth(poses, bodies.get(t.person_id)),
                            )
                            for t in tracks
                        ],
                        {**cfg["phone"], "min_visibility": cfg["body"]["min_visibility"]},
                        aspect=frame.shape[1] / max(frame.shape[0], 1),
                    )
                    # ป้อนผลให้ทุก track รวมทั้งคนที่ไม่มีโทรศัพท์ — ตัวถือค้างต้องได้
                    # เห็นเฟรมที่ "ไม่เจอ" ด้วย ไม่งั้นป้ายที่ขึ้นแล้วจะไม่มีวันหายไป
                    for track in tracks:
                        using, sure = read_phone(track, held.get(track.person_id),
                                                 cfg["phone"], now)
                        track.state["phone"] = using
                        track.state["phone_confident"] = sure

                for track in tracks:
                    pi = bodies.get(track.person_id)
                    if pi is None:
                        continue
                    # aspect: MediaPipe หาร x ด้วยความกว้างแต่หาร y ด้วยความสูง
                    # ความสูงศีรษะจึงต้องรู้สัดส่วนเฟรมก่อนถึงเทียบกับความกว้างไหล่ได้
                    gest, post, post_sure = read_gesture(
                        poses[pi], track, cfg["body"], now,
                        world=_nth(worlds, pi),
                        aspect=frame.shape[1] / max(frame.shape[0], 1),
                    )
                    track.state["gesture"] = gest
                    track.state["posture"] = post
                    track.state["posture_confident"] = post_sure

            # เทียบกับแกลเลอรีรูป แล้วเก็บชื่อไว้ใน track.state ให้ analyzer หยิบไปใช้
            # ทำที่นี่เพราะ state อยู่กับ track จึงรอดการ re-ID และไม่ต้องเทียบซ้ำทุกเฟรม
            if gallery is not None:
                if gallery.maybe_rescan(now) and gallery.enabled:
                    print(f"[pi-vision] อ่านรูปใหม่: {', '.join(gallery.names)}")
                    # เกณฑ์ถูกคำนวณใหม่จากชุดรูปชุดใหม่ — ต้องบอกด้วย ไม่งั้นเกณฑ์
                    # เปลี่ยนเงียบ ๆ ตอนวางรูปเพิ่ม แล้วผลที่เปลี่ยนไปจะอธิบายไม่ได้
                    print_calibration(gallery)
                    if use_photo_neutral:
                        neutrals = photo_neutrals(gallery, cfg["pose"])
                if gallery.enabled:
                    for track, det in zip(tracks, detections):
                        # ชื่อที่ยัง**ไม่มั่นใจ**ให้เทียบซ้ำเรื่อย ๆ เพราะลายเซ็นนิ่งขึ้นทุกเฟรม
                        # การล็อกคำเดาแรกไว้ตลอดกาลทำให้คำเดาที่แย่ที่สุด (ตอนข้อมูลน้อยสุด)
                        # กลายเป็นคำตอบสุดท้าย · ชื่อที่มั่นใจแล้วถือว่าจบ ไม่เทียบซ้ำ
                        if track.state.get("name_confident"):
                            continue
                        if not track.signature_ready:
                            continue        # ลายเซ็นยังไม่นิ่งพอ — เทียบตอนนี้ได้คำตอบมั่ว
                        hit = gallery.identify(track.signature, det.size)
                        if not hit:
                            continue
                        name, distance, confident = hit
                        changed = track.state.get("name") != name
                        track.state["name"] = name
                        track.state["name_confident"] = confident
                        # ท่านิ่งจากรูป — **ตามชื่อที่ระบบยกข้อมูลให้** ไม่ว่าจะมั่นใจหรือเดา
                        #
                        # เหตุผล: ปลายทางบันทึกแถวนี้ใต้ชื่อนี้อยู่แล้ว (โหมด known ไม่บันทึก
                        # คนที่ไม่มีชื่อเลยด้วยซ้ำ) การวัดการหันหน้าด้วยจุดศูนย์ของคนอื่น
                        # ทั้งที่ข้อมูลไปอยู่ใต้ชื่อนี้ จึงขัดกันเอง · และถ้าเดาผิด ความผิดพลาด
                        # คือ "ผลต่างของ bias ระหว่างสองคน" ซึ่งเล็กและมีขอบเขต ส่วนการ
                        # calibrate สดพลาดได้ไม่จำกัด (ท่าหันข้างกลายเป็นท่าตรงไปทั้งเซสชัน)
                        #
                        # คนแปลกหน้าจะได้จุดศูนย์นี้ก็ต่อเมื่อ FACES_GUESS=true ซึ่งแปลว่า
                        # ผู้ใช้สั่งไว้แล้วว่า "ยกให้คนที่ใกล้ที่สุดเสมอ" · ตั้ง false เมื่อไร
                        # คนที่ไม่ผ่านเกณฑ์จะไม่มีชื่อ จึงไม่ได้จุดศูนย์และ calibrate เองตามเดิม
                        neutral = neutrals.get(name)
                        if neutral and track.state.get("neutral_pose") != neutral:
                            track.state["neutral_pose"] = neutral
                            sure = "" if confident else " (ตามชื่อที่เดา)"
                            print(f"[pi-vision] #{track.person_id} ใช้ท่านิ่งจากรูปของ {name}"
                                  f"{sure} (yaw {neutral[0]:+.3f} pitch {neutral[1]:+.3f})"
                                  " — ไม่ต้อง calibrate")
                        if changed or confident:
                            mark = "" if confident else " (เดา ยังไม่มั่นใจ)"
                            print(f"[pi-vision] #{track.person_id} คือ {name}"
                                  f" (ห่าง {distance:.3f}){mark}")

            faces = list(zip(tracks, inputs))

            frame_size = (frame.shape[1], frame.shape[0])
            readings = an.update(faces, now, dt, frame_size)

            summary = an.pop_window(tracks, now)
            if summary:
                # payload คนละแบบตามโหมด — to_room_row() ไม่มีคอลัมน์ person เลย
                # จึงไม่มีทางที่ id รายคนจะหลุดออกไปในโหมดห้องรวม
                if mode.report_person:
                    # โหมดเฉพาะคนในรูป: ไม่มีคนที่รู้จักในหน้าต่างนี้ = ไม่มีอะไรให้บันทึก
                    # **ห้ามตกไปเข้าเงื่อนไขห้องรวม** — แถวห้องรวมคือค่าเฉลี่ยของทุกคน
                    # ที่อยู่ในเฟรม ซึ่งรวมคนแปลกหน้าที่โหมดนี้สัญญาว่าจะไม่บันทึก
                    if not (mode.known_only and not summary.name):
                        uploader.send(summary.to_focus_row())
                else:
                    uploader.send(summary.to_room_row(), room=True)
                if display_cfg["log_to_console"]:
                    print_summary(summary, threshold, mode)

            if not display_cfg["enabled"]:
                continue

            for reading, (_track, face) in zip(readings, faces):
                ov.draw_face(frame, reading, display_cfg, cfg["blink"], face.landmarks)
            ov.draw_zoom_rects(frame, zoom_boxes)
            ov.draw_phones(frame, phone_boxes)

            usable = sum(1 for r in readings if r.usable)
            methods = ""
            if readings:
                methods = f"  {readings[0].blink_method}/{readings[0].pose_method}"
            reid_info = ""
            if reid_on:
                reid_info = (f"  remembered {tracker.lost_count}"
                             f"  reid {tracker.reid_hits}  new {tracker.new_ids_issued}")
            hud = [
                (
                    f"{backend_name.upper()}  {fps:4.1f} fps  faces {len(faces)}"
                    f" (usable {usable}){methods}",
                    "ink",
                ),
                (
                    f"window {cfg['window']['seconds']:.0f}s  threshold {threshold:.0f}/min"
                    f"{reid_info}",
                    "muted",
                ),
            ]
            if not mode.per_person_hud:
                # โหมดห้องรวม: ไม่แสดง id รายคนเลย เพื่อไม่ให้ใครอ่านออกว่ากรอบไหนคือใคร
                # ข้อความเป็นอังกฤษเพราะ cv2.putText วาดไทยไม่ได้ (ดูหัวไฟล์ overlay.py)
                ratio = an.attention_ratio()
                attention = f"{ratio * 100:.0f}%" if ratio is not None else "calibrating"
                calibrating = sum(1 for r in readings if r.calibrating)
                measured = sum(1 for r in readings if r.usable and not r.calibrating)
                moves = sum(r.movement_in_window for r in readings)
                hud.append((f"occupancy {an.occupancy()}   (seen now {usable})", "ink"))
                hud.append(
                    (
                        f"facing forward {attention}   ({measured} measured)",
                        "ok" if ratio is not None and ratio >= 0.5 else "warn",
                    )
                )
                hud.append(
                    (
                        f"turns this window {moves}"
                        + (f"   ·   {calibrating} calibrating" if calibrating else ""),
                        "muted",
                    )
                )
                ov.draw_hud(frame, hud)
                cam_menu.draw(frame)
                res_menu.draw(frame, camera)
                enroll.draw(frame, readings)
                cv2.imshow(display_cfg["window_name"], frame)
                key = cv2.waitKey(WAIT_KEY_MS) & 0xFF
                busy = cam_menu.open or res_menu.open
                if not enroll.handle(key, clean, readings, busy):
                    if not cam_menu.handle(key, camera) and not res_menu.handle(key, camera):
                        if not handle_key(key, an, tracker, tracks, display_cfg, cfg, readings,
                                          faces, now, threshold, mode):
                            break
                if enroll.take_saved() and gallery is not None:
                    gallery.refresh_soon()
                continue

            for i, r in enumerate(readings[: display_cfg["hud_max_faces"]]):
                who = _who(r, mode.known_only)
                if not r.usable:
                    hud.append((f"{who} too far — q{r.quality*100:3.0f}%", "muted"))
                elif r.calibrating:
                    hud.append(
                        (f"{who} calibrating {r.calibration_progress*100:3.0f}%", "muted")
                    )
                else:
                    state = "DROWSY" if r.drowsy else (r.direction or "center")
                    tag = "?" if getattr(faces[i][0], "provisional", False) else ""
                    eye_bits = (
                        f"eye {r.blink_score:.2f}  blink {r.blink_rate_per_min:.0f}/min  "
                        if mode.eyes
                        else ""
                    )
                    # ท่าทางกับท่ายืน/นั่งเป็นคนละแกนกับการหันหน้า — คนยกมือขณะมองซ้ายได้
                    # จึงต่อท้ายเป็นช่องของตัวเอง ไม่ใช่ไปทับ state
                    body_bits = ""
                    if r.gesture or r.posture or r.phone:
                        pose = r.posture or ""
                        if pose and not r.posture_confident:
                            pose += "?"          # เดา ไม่ได้วัด — ดู az.FaceReading
                        # ช่องของตัวเองเหมือน gesture/posture — คนเล่นโทรศัพท์ขณะนั่ง
                        # และขณะยกมือได้ทั้งคู่ สามอย่างนี้ไม่ได้แทนที่กัน
                        on_phone = ""
                        if r.phone:
                            on_phone = "PHONE" if r.phone_confident else "PHONE?"
                        body_bits = f"{(r.gesture or ''):<12}{pose:<9}{on_phone:<7}"
                    hud.append(
                        (
                            f"{who}{tag} {state:<7} {body_bits}{_mood(r)}{eye_bits}"
                            f"mv {r.movement_in_window}  q{r.quality*100:3.0f}%",
                            "danger" if r.drowsy else ("warn" if r.direction else "ok"),
                        )
                    )
                    if display_cfg.get("show_emotion_scores"):
                        hud.append((f"    {_mood_scores(r)}", "muted"))
            if len(readings) > display_cfg["hud_max_faces"]:
                hud.append((f"+{len(readings) - display_cfg['hud_max_faces']} more", "muted"))
            ov.draw_hud(frame, hud)
            cam_menu.draw(frame)
            res_menu.draw(frame, camera)
            enroll.draw(frame, readings)
            cv2.imshow(display_cfg["window_name"], frame)

            key = cv2.waitKey(WAIT_KEY_MS) & 0xFF
            # ลงทะเบียนได้สิทธิ์ก่อนเมนูอื่น — ขณะพิมพ์ชื่อ ตัวอักษร v กับ r ต้องเป็น
            # ตัวอักษรในชื่อ ไม่ใช่คำสั่งเปิดเมนูกล้อง/ความละเอียด
            if not enroll.handle(key, clean, readings, cam_menu.open or res_menu.open):
                if not cam_menu.handle(key, camera) and not res_menu.handle(key, camera):
                    if not handle_key(key, an, tracker, tracks, display_cfg, cfg, readings,
                                      faces, now, threshold, mode):
                        break
            # รูปใหม่ลงดิสก์แล้ว — สั่งให้แกลเลอรีตรวจโฟลเดอร์รอบหน้าเลย ไม่ต้องรอครบรอบ
            if enroll.take_saved() and gallery is not None:
                gallery.refresh_soon()

    except KeyboardInterrupt:
        print("\n[pi-vision] หยุดการทำงาน")
    finally:
        camera.close()
        landmarker.close()
        for extra in (detector, zoom_reader, body_landmarker, phone_detector):
            if extra is not None:
                extra.close()
        uploader.close()
        if photo_reader is not None:
            photo_reader.close()
        if display_cfg["enabled"]:
            cv2.destroyAllWindows()

    return 0


if __name__ == "__main__":
    sys.exit(main())
