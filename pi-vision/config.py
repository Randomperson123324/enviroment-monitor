"""
ค่าตั้งทั้งหมดของ pi-vision อยู่ในไฟล์นี้ไฟล์เดียว

กฎ: โมดูลอื่น **ห้ามมีตัวเลข/สตริง/URL เขียนตรง ๆ** ที่อาจต้องเปลี่ยน
ทุกอย่างต้องอ่านผ่าน `CONFIG` หรือรับเป็นพารามิเตอร์เข้าฟังก์ชัน

ค่าจริงมาจาก .env (ถ้ามี) ถ้าไม่มีจะใช้ค่า default ที่เขียนไว้ตรงนี้
ดู .env.example สำหรับรายการค่าทั้งหมดพร้อมคำอธิบาย
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def _load_dotenv(path: Path) -> None:
    """อ่าน .env แบบง่าย ๆ ลง os.environ (ไม่ทับค่าที่ตั้งไว้แล้วใน environment)."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


_load_dotenv(BASE_DIR / ".env")


def _num(key: str, fallback: float) -> float:
    try:
        return float(os.environ[key])
    except (KeyError, ValueError):
        return fallback


def _int(key: str, fallback: int) -> int:
    try:
        return int(float(os.environ[key]))
    except (KeyError, ValueError):
        return fallback


def _str(key: str, fallback: str = "") -> str:
    return (os.environ.get(key) or "").strip() or fallback


def _bool(key: str, fallback: bool) -> bool:
    raw = (os.environ.get(key) or "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return fallback


CONFIG = {
    # ── โหมดการทำงาน ─────────────────────────────────────────
    # "room"   = วัดภาพรวมของห้อง ไม่แยกรายบุคคล ไม่เก็บลายเซ็นใบหน้า
    # "person" = ติดตามทีละคนพร้อม re-ID
    # ว่างไว้ = ถามผู้ใช้ตอนเปิดโปรแกรม (ถ้าไม่มี TTY จะใช้ modes.DEFAULT)
    "mode": _str("VISION_MODE", ""),

    # ── กล้อง ────────────────────────────────────────────────
    "camera": {
        # "csi"  = Camera Module 3 ผ่าน Picamera2
        # "usb"  = USB webcam ผ่าน OpenCV
        # "auto" = ลอง csi ก่อน ถ้าไม่ได้ค่อยถอยไป usb
        "source": _str("CAMERA_SOURCE", "auto"),
        "width": _int("CAMERA_WIDTH", 640),
        "height": _int("CAMERA_HEIGHT", 480),
        "fps": _int("CAMERA_FPS", 15),
        # index ของอุปกรณ์สำหรับ OpenCV (0 = ตัวแรก) หรือใส่ path เช่น /dev/video0
        "usb_index": _str("CAMERA_USB_INDEX", "0"),
        # พลิกภาพซ้าย-ขวาให้เหมือนส่องกระจก — ดูง่ายกว่าตอนปรับตำแหน่งกล้อง
        "mirror": _bool("CAMERA_MIRROR", True),
        # หมุนภาพ (0 / 90 / 180 / 270) เผื่อติดตั้งกล้องตะแคง
        "rotate": _int("CAMERA_ROTATE", 0),
    },

    # ── โมเดล MediaPipe Face Landmarker ──────────────────────
    "model": {
        "path": _str("MODEL_PATH", str(BASE_DIR / "models" / "face_landmarker.task")),
        "url": _str(
            "MODEL_URL",
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
            "face_landmarker/float16/1/face_landmarker.task",
        ),
        "auto_download": _bool("MODEL_AUTO_DOWNLOAD", True),
        # จำนวนใบหน้าสูงสุดที่วิเคราะห์พร้อมกัน — ดูผลต่อ CPU ใน README
        "max_faces": _int("MODEL_MAX_FACES", 6),
        "min_detection_confidence": _num("MODEL_MIN_DETECTION_CONFIDENCE", 0.5),
        "min_presence_confidence": _num("MODEL_MIN_PRESENCE_CONFIDENCE", 0.5),
        "min_tracking_confidence": _num("MODEL_MIN_TRACKING_CONFIDENCE", 0.5),
        # blendshapes ให้คะแนนการหลับตาที่แม่นกว่า EAR — เปิดไว้ถ้าใช้ BLINK_METHOD=auto
        "blendshapes": _bool("MODEL_BLENDSHAPES", True),
        # transformation matrix ให้มุมหันหน้าเป็นองศาจริง — เปิดเมื่อ POSE_METHOD=matrix
        "transform_matrix": _bool("MODEL_TRANSFORM_MATRIX", False),
    },

    # ── การหันหน้า (head pose) ───────────────────────────────
    "pose": {
        # geometric = ประมาณจากตำแหน่งจมูก (ค่าเริ่มต้น ทดสอบแล้ว)
        # matrix    = จาก facial transformation matrix ได้เป็นองศาจริง แม่นกว่า
        #             แต่ต้องยืนยันทิศบนหน้าจอก่อน (ดู matrix_invert_* ด้านล่าง)
        # auto      = ใช้ matrix ถ้ามี ไม่งั้นถอยไป geometric
        "method": _str("POSE_METHOD", "geometric"),
        # ระหว่าง N วินาทีแรก ให้นั่งมองตรง ระบบจะจำท่านิ่งไว้เป็นจุดอ้างอิง
        "calibration_seconds": _num("POSE_CALIBRATION_SECONDS", 3.0),
        # เกณฑ์สำหรับวิธี geometric (สัดส่วนเทียบขนาดใบหน้า ไม่ใช่องศา)
        "yaw_threshold": _num("POSE_YAW_THRESHOLD", 0.08),
        "pitch_threshold": _num("POSE_PITCH_THRESHOLD", 0.06),
        # เกณฑ์สำหรับวิธี matrix (องศา) — คนละหน่วยกับข้างบน
        "yaw_threshold_deg": _num("POSE_YAW_THRESHOLD_DEG", 18.0),
        "pitch_threshold_deg": _num("POSE_PITCH_THRESHOLD_DEG", 14.0),
        # กลับเครื่องหมายถ้าดูบนจอแล้วทิศสลับข้าง
        "matrix_invert_yaw": _bool("POSE_MATRIX_INVERT_YAW", False),
        "matrix_invert_pitch": _bool("POSE_MATRIX_INVERT_PITCH", False),
        # ต้องกลับมาต่ำกว่า threshold × ค่านี้ ถึงจะนับว่า "กลับมาตรงกลาง" แล้ว
        # (hysteresis — กันการนับซ้ำรัว ๆ ตอนค่าแกว่งรอบเส้นแบ่ง)
        "release_ratio": _num("POSE_RELEASE_RATIO", 0.6),
        # ต้องหันค้างอย่างน้อยกี่วินาทีถึงนับเป็น 1 ครั้ง (กันการกระตุกของ landmark)
        "hold_seconds": _num("POSE_HOLD_SECONDS", 0.25),
        # ใช้ค่ามัธยฐานของกี่เฟรม เพื่อลด noise (มัธยฐานทนค่ากระโดดดีกว่าค่าเฉลี่ย)
        "smooth_frames": _int("POSE_SMOOTH_FRAMES", 5),
    },

    # ── การกะพริบตา / ความง่วง ───────────────────────────────
    "blink": {
        # blendshape = คะแนนจากโมเดล (แม่นที่สุด ไม่ต้อง calibrate รายคน)
        # ear        = คำนวณเรขาคณิต + baseline รายคน
        # auto       = ใช้ blendshape ถ้ามี ไม่งั้นถอยไป ear
        "method": _str("BLINK_METHOD", "auto"),
        # คะแนน 0–1 ที่ถือว่าตาปิด (ใช้กับทั้งสองวิธี)
        "closed_score": _num("BLINK_CLOSED_SCORE", 0.5),
        # ── เฉพาะวิธี ear ──
        # เกณฑ์สำรองเมื่อยังไม่ได้ calibrate — ตรงกับ WEBCAM.drowsyEarBelow ฝั่งเว็บ
        "ear_threshold": _num("BLINK_EAR_THRESHOLD", 0.18),
        # เปอร์เซ็นไทล์ของ EAR ตอน calibrate ที่ถือว่าเป็น "ตาเปิด"
        # ใช้ค่าสูงเพราะระหว่าง calibrate ผู้ใช้ย่อมกะพริบตาบ้าง
        "ear_open_percentile": _num("BLINK_EAR_OPEN_PERCENTILE", 0.75),
        # threshold ของแต่ละคน = EAR ตาเปิด × ค่านี้
        "ear_close_ratio": _num("BLINK_EAR_CLOSE_RATIO", 0.65),
        # ── ร่วมกัน ──
        "consecutive_frames": _int("BLINK_CONSECUTIVE_FRAMES", 2),
        "drowsy_seconds": _num("BLINK_DROWSY_SECONDS", 1.2),
        # ช่วงอัตราการกะพริบปกติ (ครั้ง/นาที) — ใช้แค่แสดงผลบนหน้าจอ
        "normal_rate_min": _num("BLINK_NORMAL_RATE_MIN", 8),
        "normal_rate_max": _num("BLINK_NORMAL_RATE_MAX", 21),
    },

    # ── คุณภาพของการวัด ──────────────────────────────────────
    # EAR วัดจากระยะเปลือกตาซึ่งเล็กมาก (~8% ของระยะระหว่างหางตา)
    # ใบหน้าที่เล็กเกินไปจะให้ค่าที่สัญญาณรบกวนกลบข้อมูลจริง — ต้องคัดออก
    "quality": {
        # ต่ำกว่านี้ = ไม่วิเคราะห์เลย (ยังนับใน face_count อยู่)
        "min_interocular_px": _num("QUALITY_MIN_INTEROCULAR_PX", 40),
        # ถึงค่านี้ = ถือว่าคุณภาพเต็ม 100%
        "good_interocular_px": _num("QUALITY_GOOD_INTEROCULAR_PX", 90),
    },

    # ── อารมณ์จากการแสดงออกบนใบหน้า ──────────────────────────
    # อ่านจาก blendshapes ที่เปิดใช้อยู่แล้วเพื่อตรวจการหลับตา จึงไม่มีโมเดลเพิ่ม
    # และไม่มี inference รอบที่สอง — ดูขอบเขตของสิ่งที่บอกได้ใน emotion.py
    "emotion": {
        "enabled": _bool("EMOTION_ENABLED", True),
        # คะแนนต่ำกว่านี้ทุกตัว = หน้านิ่ง (neutral) ไม่ใช่ "ไม่รู้"
        # 0.35 มาจากพฤติกรรมของ blendshapes: ยิ้มชัดอยู่ราว 0.5–0.9
        # ส่วนกล้ามเนื้อที่ขยับเองระหว่างพูดอยู่ราว 0.1–0.25
        "threshold": _num("EMOTION_THRESHOLD", 0.35),
        # อันดับหนึ่งต้องชนะอันดับสองเท่านี้ ไม่งั้นถือว่าแยกไม่ออก → neutral
        # กันค่าที่แกว่งไปมาระหว่างสองอารมณ์ทั้งที่ใบหน้าไม่ได้เปลี่ยน
        "margin": _num("EMOTION_MARGIN", 0.08),
        # ดูย้อนหลังกี่เฟรมเพื่อหาเสียงข้างมาก — การพูดทำให้ jawOpen กระโดดเป็นเฟรม ๆ
        "window_frames": _int("EMOTION_WINDOW_FRAMES", 12),
        # ต้องได้เสียงข้างมากกี่เฟรมถึงจะเปลี่ยนค่าที่รายงาน
        "hold_frames": _int("EMOTION_HOLD_FRAMES", 6),
    },

    # ── จำคนจากรูปในโฟลเดอร์ ────────────────────────────────
    # ⚠️ เปิดใช้เมื่อมีรูปใน faces/ เท่านั้น และเปลี่ยนจุดยืนความเป็นส่วนตัวของระบบ
    #    (ข้อมูลจะผูกกับชื่อคนจริง และรูปอยู่บนดิสก์) — อ่าน faces.py ก่อนใช้
    "faces": {
        "dir": _str("FACES_DIR", str(BASE_DIR / "faces")),
        # ระยะลายเซ็นสูงสุดที่ยังถือว่าเป็นคนนี้ · เข้มกว่า reid_threshold เพราะ
        # การติดชื่อผิดคนแก้ยากกว่าการแจก id ใหม่ผิด — ไม่มั่นใจให้ใช้ id ตัวเลขต่อ
        "threshold": _num("FACES_THRESHOLD", 0.045),
        # ratio test — ต้องดีกว่าอันดับสองอย่างชัดเจน ไม่งั้นถือว่าแยกไม่ออก
        "ratio": _num("FACES_RATIO", 0.75),
        # ใบหน้าต้องใหญ่กว่านี้ถึงจะเอาไปเทียบ
        "min_size": _num("FACES_MIN_SIZE", 0.12),
        # ตรวจโฟลเดอร์ซ้ำทุกกี่วินาที — วางรูปใหม่แล้วมีผลโดยไม่ต้องรีสตาร์ต
        # 0 = ตรวจครั้งเดียวตอนเริ่ม
        "rescan_seconds": _num("FACES_RESCAN_SECONDS", 20.0),
    },

    # ── การติดตามบุคคล ───────────────────────────────────────
    "tracker": {
        # ระยะห่างศูนย์กลางใบหน้าสูงสุด (สัดส่วนของความกว้างภาพ) ที่ยังถือว่าเป็นคนเดิม
        "max_distance": _num("TRACKER_MAX_DISTANCE", 0.25),
        # ยังตามต่อได้อีกกี่วินาทีหลังตรวจไม่เจอ ก่อนจะถือว่าออกจากเฟรม
        # ตั้งยาวขึ้นช่วยได้มาก เพราะการหลุดสั้น ๆ (หันหน้า · มีคนเดินบัง · แสงวูบ)
        # คือสาเหตุหลักของการแจก id ใหม่ทั้งที่คนไม่ได้ไปไหน
        "forget_seconds": _num("TRACKER_FORGET_SECONDS", 6.0),
        # น้ำหนักของแต่ละสัญญาณในการจับคู่ (รวมกันควรเป็น 1.0)
        "weight_distance": _num("TRACKER_WEIGHT_DISTANCE", 0.5),
        "weight_iou": _num("TRACKER_WEIGHT_IOU", 0.35),
        "weight_size": _num("TRACKER_WEIGHT_SIZE", 0.15),
        # ทำนายตำแหน่งถัดไปจากความเร็ว — ช่วยมากเมื่อคนเดินผ่านกล้อง
        "use_prediction": _bool("TRACKER_USE_PREDICTION", True),
        "velocity_smoothing": _num("TRACKER_VELOCITY_SMOOTHING", 0.6),
        # ตรวจสลับคู่หลังจับคู่เสร็จ — กัน id สลับตอนสองคนเดินไขว้กัน
        "swap_guard": _bool("TRACKER_SWAP_GUARD", True),

        # ── re-identification: จำ id เมื่อคนออกจากเฟรมแล้วกลับมา ──
        # ⚠️ เปิดแล้วระบบจะเก็บ "ลายเซ็นโครงหน้า" ไว้ใน RAM ซึ่งเป็นข้อมูลชีวมิติแบบอ่อน
        #    อ่านหัวข้อความเป็นส่วนตัวใน README ก่อนใช้ในพื้นที่ที่มีผู้อื่น
        "reid_enabled": _bool("TRACKER_REID_ENABLED", True),
        # จำลายเซ็นไว้กี่วินาทีหลังคนหายจากเฟรม (เกินนี้ = ลืมถาวร)
        # ตั้งยาวได้เพราะมี reid_max_pool คุมจำนวนคนอยู่แล้ว — คนที่ออกไปพักเที่ยง
        # แล้วกลับมาตอนบ่ายก็ยังควรได้ id เดิม
        "reid_memory_seconds": _num("TRACKER_REID_MEMORY_SECONDS", 3600),
        # จำได้สูงสุดกี่คน — เกินแล้วลืมคนที่ไม่เห็นนานที่สุดก่อน
        # นี่คือตัวคุมหน่วยความจำจริง (แต่ละคนใช้แค่ตัวเลข 8 ตัว)
        "reid_max_pool": _int("TRACKER_REID_MAX_POOL", 30),
        # ถ้ามีคนอยู่ในกลุ่ม lost คนเดียว ไม่มีใครให้สับสนด้วย จึงผ่อนเกณฑ์ได้
        "reid_threshold_single": _num("TRACKER_REID_THRESHOLD_SINGLE", 0.08),
        # ลองจับคู่ซ้ำได้กี่ครั้งก่อนยอมแพ้ — การลองครั้งเดียวแล้วเลิกทำให้แจก id ใหม่
        # ทั้งที่จริง ๆ จำได้ (เช่นตอนนั้นคนเดิมยังไม่เข้ากลุ่ม lost)
        "reid_max_attempts": _int("TRACKER_REID_MAX_ATTEMPTS", 60),
        # ลายเซ็นขยับน้อยกว่านี้ = ถือว่านิ่ง
        "reid_stable_eps": _num("TRACKER_REID_STABLE_EPS", 0.006),
        # นิ่งติดต่อกันกี่ครั้งถึงเชื่อได้โดยไม่ต้องรอครบ min_samples
        "reid_stable_needed": _int("TRACKER_REID_STABLE_NEEDED", 5),
        # ระยะห่างลายเซ็นสูงสุดที่ยังถือว่าเป็นคนเดิม (0.05 = ต่างกันเฉลี่ย 5%)
        # ค่านี้มาจากการวัดจริง: ที่ 30 ตัวอย่าง คนเดียวกันห่างกัน < 0.04
        # ส่วนคนละคนห่างกัน > 0.07 — 0.05 จึงอยู่ตรงกลางอย่างปลอดภัย
        "reid_threshold": _num("TRACKER_REID_THRESHOLD", 0.05),
        # ใบหน้าต้องใหญ่กว่านี้ (สัดส่วนของเฟรม) ถึงจะเอาไปเรียน/เทียบลายเซ็น
        "reid_min_size": _num("TRACKER_REID_MIN_SIZE", 0.12),
        # เฉลี่ยลายเซ็นจากกี่ตัวอย่างก่อนหยุดปรับ — ยิ่งมากยิ่งนิ่งแต่ปรับตัวช้า
        "reid_max_samples": _int("TRACKER_REID_MAX_SAMPLES", 30),
        # ⚠️ ต้องสะสมกี่เฟรมก่อนถึงจะเชื่อลายเซ็นได้
        # จากการวัด: ลายเซ็นจาก **เฟรมเดียวแยกคนไม่ออกเลย** เพราะ landmark สั่น
        # มากกว่าความต่างระหว่างคนที่หน้าคล้ายกัน — การเฉลี่ยลด noise ตาม √N
        "reid_min_samples": _int("TRACKER_REID_MIN_SAMPLES", 15),
        # ratio test — ตัวที่ใกล้ที่สุดต้องดีกว่าอันดับสองอย่างน้อยเท่านี้
        # ถ้ามีสองคนคล้ายกันพอ ๆ กัน แปลว่าเดาไม่ได้ → ไม่เดา แจก id ใหม่แทน
        "reid_ratio": _num("TRACKER_REID_RATIO", 0.75),
    },

    # ── หน้าต่างสรุปผล ───────────────────────────────────────
    "window": {
        # ความยาวหน้าต่างสรุป — 15 วินาที ตรงกับที่ตาราง focus ของโปรเจกต์ใช้อยู่
        "seconds": _num("WINDOW_SECONDS", 15.0),
        # ขยับเกินกี่ครั้ง/นาที = เสียสมาธิ (ตรงกับ FOCUS_THRESHOLD_DEFAULT ฝั่งเว็บ)
        "movement_threshold_per_min": _num("WINDOW_MOVEMENT_THRESHOLD", 8),
        # เก็บจำนวนคนต่อเฟรมไว้กี่ค่าเพื่อหามัธยฐาน
        # ค่าเริ่มต้นเผื่อไว้ที่ 60 fps × หน้าต่าง 15 วินาที — เกินนี้ทิ้งค่าเก่าสุด
        # (มัธยฐานทนกว่าค่าเฉลี่ย เพราะเฟรมที่ตรวจไม่เจอชั่วครู่ไม่ดึงค่าลง)
        "occupancy_samples": _int("WINDOW_OCCUPANCY_SAMPLES", 900),
    },

    # ── การแสดงผล ────────────────────────────────────────────
    "display": {
        "enabled": _bool("DISPLAY_ENABLED", True),
        "window_name": _str("DISPLAY_WINDOW_NAME", "pi-vision — face detection"),
        # วาดจุด landmark ทั้ง 468 จุด (สวยแต่กิน CPU) — ปกติปิดไว้
        "draw_mesh": _bool("DISPLAY_DRAW_MESH", False),
        "draw_eyes": _bool("DISPLAY_DRAW_EYES", True),
        # แสดงรายละเอียดได้สูงสุดกี่คนบนแผง HUD (ที่เหลือสรุปเป็นบรรทัดเดียว)
        "hud_max_faces": _int("DISPLAY_HUD_MAX_FACES", 6),
        # พิมพ์สรุปลง console ทุกครั้งที่ปิดหน้าต่างสรุป
        "log_to_console": _bool("DISPLAY_LOG_TO_CONSOLE", True),
    },
}


def get(path: str):
    """อ่านค่าแบบ 'camera.width' — ใช้ตอนอยากอ้างถึงค่าเดียวโดยไม่ต้องส่ง dict ทั้งก้อน."""
    node = CONFIG
    for part in path.split("."):
        node = node[part]
    return node
