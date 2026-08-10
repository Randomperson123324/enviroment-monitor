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
    c         calibrate ท่านิ่งใหม่ทุกคน
    m         สลับการวาด mesh
    f         ลืมทุก id และลายเซ็นทันที (ความเป็นส่วนตัว)
    e         สลับการโชว์คะแนนอารมณ์ดิบทั้งสี่ค่า (ใช้ปรับ EMOTION_THRESHOLD)
    v         เปิดเมนูเลือกกล้อง แล้วกดเลข 1–9 เพื่อสลับกล้อง
    space     พิมพ์สรุปหน้าต่างปัจจุบันทันทีโดยไม่ต้องรอครบเวลา

หมายเหตุ: id ที่ขึ้นเป็น `#5?` คือ id ชั่วคราว — ระบบยังตัดสินไม่ได้ว่าเป็นคนใหม่
หรือคนเดิมที่เคยหายไป จึงยังไม่บันทึกลงตาราง focus จนกว่าจะยืนยันได้
"""

from __future__ import annotations

import argparse
import sys
import threading
import time
import urllib.request
from pathlib import Path

import cv2

import analyzer as az
import faces as fc
import landmarks as lm
import modes
import overlay as ov
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
KEY_EMOTION = ord("e")              # โชว์คะแนนอารมณ์ดิบ เพื่อดูว่า threshold เหมาะไหม
WAIT_KEY_MS = 1
FPS_SMOOTHING = 0.9                 # ยิ่งใกล้ 1 ยิ่งนิ่ง
DOWNLOAD_CHUNK = 1 << 16


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="ตรวจจับใบหน้าและวัดสมาธิด้วย MediaPipe")
    p.add_argument("--mode", choices=modes.ORDER, help="ทับค่า VISION_MODE และข้ามคำถามตอนเปิด")
    p.add_argument("--source", choices=("auto", "csi", "usb"), help="ทับค่า CAMERA_SOURCE")
    p.add_argument("--no-window", action="store_true", help="ไม่เปิดหน้าต่าง (สำหรับ SSH)")
    p.add_argument("--mesh", action="store_true", help="วาด landmark ครบ 468 จุด")
    return p.parse_args()


def resolve_mode(cli_mode: str | None, env_mode: str, stream=None) -> modes.Mode:
    """
    ลำดับความสำคัญ: flag > VISION_MODE ใน .env > ถามผู้ใช้
    ไม่มี TTY (cron · systemd · ท่อ) จะไม่ค้างรอ input — ใช้ค่าเริ่มต้นแล้วบอกให้รู้
    """
    if cli_mode:
        return modes.get(cli_mode)
    if env_mode:
        return modes.get(env_mode)          # ชื่อผิดใน .env ให้ระเบิดออกมาเลย ดีกว่าเดา

    stream = stream or sys.stdin
    if not (hasattr(stream, "isatty") and stream.isatty()):
        chosen = modes.get(None)
        print(f"[pi-vision] ไม่มีหน้าจอให้ถาม — ใช้โหมด{chosen.label} · ระบุ --mode เพื่อเลือกเอง")
        return chosen

    for line in modes.menu_lines():
        print(line)
    while True:
        try:
            raw = input(f"  เลือก [{modes.ORDER.index(modes.DEFAULT) + 1}]: ")
        except EOFError:
            return modes.get(None)
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
    """ดาวน์โหลดโมเดล MediaPipe ครั้งแรก ถ้ายังไม่มีในเครื่อง"""
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


def build_photo_reader(model_cfg: dict):
    """
    ตัวอ่านใบหน้าจาก **ไฟล์รูป** — FaceLandmarker อีกตัวในโหมด IMAGE

    ต้องแยกจากตัวหลักเพราะตัวหลักอยู่โหมด VIDEO ซึ่งคาดว่าเฟรมจะเรียงตามเวลา
    ป้อนรูปนิ่งเข้าไปคั่นกลางจะทำให้ตัวติดตามภายในของมันสับสน

    คืนฟังก์ชัน `detect(path) -> landmarks | None` ให้ faces.py เอาไปใช้
    ตัว landmarker ถูกสร้างครั้งเดียวและปิดเมื่อเลิกใช้
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

    def detect(path):
        image = cv2.imread(str(path))
        if image is None:
            return None
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        result = reader.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
        if not result or not result.face_landmarks:
            return None
        return result.face_landmarks[0]

    return detect, reader


def _who(reading, known_only: bool = False) -> str:
    """
    ชื่อคนถ้าเทียบกับรูปได้ ไม่งั้นเป็นหมายเลข track

    `?` ต่อท้าย = เดาจากคนที่ใกล้ที่สุด แต่ยังไม่ผ่านเกณฑ์ความมั่นใจ (ตรงกับที่ `#5?`
    ใช้อยู่แล้วสำหรับ id ที่ยังไม่แน่) — ชื่อที่ไม่มี `?` คือชื่อที่ผ่านเกณฑ์
    """
    if reading.name:
        return reading.name if reading.name_confident else f"{reading.name}?"
    return f"#{reading.person_id}"


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
    print(
        f"[{stamp}] person={summary.person}{who}{mood} faces={summary.face_count} "
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
        print("[pi-vision] calibrate ท่านิ่งใหม่ — มองตรงเข้ากล้อง")
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
    if mode.gallery:
        faces_dir = fc.ensure_directory(cfg["faces"]["dir"])
        try:
            detect_photo, photo_reader = build_photo_reader(cfg["model"])
        except Exception as exc:
            # การจำชื่อเป็นของเสริม — ถ้าตัวอ่านรูปสร้างไม่ได้ ให้เดินต่อด้วยหมายเลข
            # ไม่ใช่ล้มทั้งบริการ เพราะการวัดการจดจ่อยังทำงานได้ครบโดยไม่มีชื่อ
            print(f"[pi-vision] อ่านรูปใบหน้าไม่ได้ ({exc}) — ใช้หมายเลขแทนชื่อ")
        else:
            gallery = fc.FaceGallery(faces_dir, cfg["faces"], fc.landmark_extractor(detect_photo))
            known = gallery.scan()
            if known:
                print(f"[pi-vision] จำได้ {known} คนจากรูปใน {faces_dir}: {', '.join(gallery.names)}")
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
    print(f"[pi-vision] กล้อง: {backend_name} · {cam_cfg['width']}×{cam_cfg['height']}")
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
              "e=คะแนนอารมณ์ · v=เลือกกล้อง · space=สรุปทันที")

    fps = 0.0
    last_t = time.monotonic()
    cam_menu = CameraMenu()
    threshold = cfg["window"]["movement_threshold_per_min"]
    reid_on = tracker_cfg["reid_enabled"]

    # จำกัดความถี่ของลูปเอง — ไม่งั้นในโหมด --no-window (ไม่มี waitKey มาหน่วงให้)
    # โปรแกรมจะวนเร็วสุดกำลังและกิน CPU จนไปแย่งเวลาของงานอื่นบน Pi
    frame_interval = 1.0 / max(cam_cfg["fps"], 1)
    next_frame_at = time.monotonic()

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

            now = time.monotonic()
            dt = now - last_t
            last_t = now
            if dt > 0:
                fps = FPS_SMOOTHING * fps + (1 - FPS_SMOOTHING) * (1.0 / dt)

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            # detect_for_video ต้องได้ timestamp เป็น ms และ **ต้องเพิ่มขึ้นเสมอ**
            result = landmarker.detect_for_video(mp_image, int(now * 1000))

            face_landmarks = result.face_landmarks or []
            blendshapes = getattr(result, "face_blendshapes", None) or []
            matrices = getattr(result, "facial_transformation_matrixes", None) or []

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
                    )
                )

            tracks = tracker.assign(detections, now)

            # เทียบกับแกลเลอรีรูป แล้วเก็บชื่อไว้ใน track.state ให้ analyzer หยิบไปใช้
            # ทำที่นี่เพราะ state อยู่กับ track จึงรอดการ re-ID และไม่ต้องเทียบซ้ำทุกเฟรม
            if gallery is not None:
                if gallery.maybe_rescan(now) and gallery.enabled:
                    print(f"[pi-vision] อ่านรูปใหม่: {', '.join(gallery.names)}")
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
                cv2.imshow(display_cfg["window_name"], frame)
                key = cv2.waitKey(WAIT_KEY_MS) & 0xFF
                if not cam_menu.handle(key, camera):
                    if not handle_key(key, an, tracker, tracks, display_cfg, cfg, readings,
                                      faces, now, threshold, mode):
                        break
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
                    hud.append(
                        (
                            f"{who}{tag} {state:<7} {_mood(r)}{eye_bits}"
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
            cv2.imshow(display_cfg["window_name"], frame)

            key = cv2.waitKey(WAIT_KEY_MS) & 0xFF
            if not cam_menu.handle(key, camera):
                if not handle_key(key, an, tracker, tracks, display_cfg, cfg, readings,
                                  faces, now, threshold, mode):
                    break

    except KeyboardInterrupt:
        print("\n[pi-vision] หยุดการทำงาน")
    finally:
        camera.close()
        landmarker.close()
        uploader.close()
        if photo_reader is not None:
            photo_reader.close()
        if display_cfg["enabled"]:
            cv2.destroyAllWindows()

    return 0


if __name__ == "__main__":
    sys.exit(main())
