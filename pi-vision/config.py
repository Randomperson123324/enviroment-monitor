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
        # ถามกล้องว่ารองรับโหมดอะไรบ้าง แล้วเลือกให้เอง — width/height ข้างล่างกลาย
        # เป็นแค่ค่าสำรองเมื่อถามไม่ได้ (ตอนนี้ถามได้เฉพาะ Windows/DirectShow)
        # เกณฑ์การเลือก: สัดส่วนกว้างที่สุดที่กล้องมี → ทำได้ถึง fps ที่ตั้งไว้ → ใหญ่สุด
        # ⚠️ "ไม่กำหนดขนาดเลย" ไม่ใช่ทางเลือกที่ดี — ค่า default ของเว็บแคมมักเป็น
        # 640x480 (4:3) ซึ่งบนเซนเซอร์ 16:9 คือภาพที่ถูกตัดขอบข้างทิ้ง · ดู camera.best_mode
        "auto_size": _bool("CAMERA_AUTO_SIZE", True),
        # เพดานความกว้างตอนเลือกเอง — กันไม่ให้ไปคว้าโหมดยักษ์ที่ CPU ตามไม่ทัน
        "auto_max_width": _int("CAMERA_AUTO_MAX_WIDTH", 1280),
        "width": _int("CAMERA_WIDTH", 640),
        "height": _int("CAMERA_HEIGHT", 480),
        "fps": _int("CAMERA_FPS", 15),
        # index ของอุปกรณ์สำหรับ OpenCV (0 = ตัวแรก) หรือใส่ path เช่น /dev/video0
        "usb_index": _str("CAMERA_USB_INDEX", "0"),
        # เลือกกล้องด้วย**ชื่อรุ่น**แทน index — ใส่แค่บางส่วนของชื่อก็พอ เช่น "c922"
        # index ของ USB สลับกันเองเวลาถอด-เสียบหรือรีบูต ชื่อรุ่นไม่สลับ · ตั้งค่านี้แล้ว
        # CAMERA_USB_INDEX จะถูกมองข้าม และถ้าหาชื่อไม่เจอจะฟ้อง ไม่ใช่เปิดกล้องอื่นให้
        "usb_name": _str("CAMERA_USB_NAME", ""),
        # backend ของ OpenCV: auto / dshow / msmf / v4l2 / any
        # ⚠️ auto ไม่ได้แปลว่า "ให้ OpenCV เลือก" — บน Windows มันหมายถึง dshow
        # เพราะทางที่ OpenCV เลือกเอง (Media Foundation) มองไม่เห็นเว็บแคม USB
        # หลายรุ่น และเปิดกล้องในตัวเครื่องช้าเป็นนาที · ดู camera._default_api()
        "api": _str("CAMERA_API", "auto"),
        # รหัสภาพที่ขอจากกล้อง เช่น MJPG — ว่าง = ใช้ค่าที่กล้องให้มาเอง
        # ไดรเวอร์มีสิทธิ์ไม่ทำตาม (วัดกับ C922 บน Windows: ที่ 720p ตั้งหรือไม่ตั้ง
        # ก็ได้ 10fps เท่ากัน) และการตั้งกินเวลาเปิดเพิ่มราวหนึ่งวินาที จึงว่างไว้
        "fourcc": _str("CAMERA_FOURCC", ""),
        # ถามว่าจะใช้กล้องตัวไหนตอนเปิดโปรแกรม (ถามเฉพาะเมื่อมีหน้าจอและเจอเกินหนึ่งตัว)
        # false = ใช้ค่าข้างบนเลย · ระบุ --source มาก็ไม่ถามเหมือนกัน
        "ask": _bool("CAMERA_ASK", True),
        # พลิกภาพซ้าย-ขวาให้เหมือนส่องกระจก — ดูง่ายกว่าตอนปรับตำแหน่งกล้อง
        "mirror": _bool("CAMERA_MIRROR", True),
        # หมุนภาพ (0 / 90 / 180 / 270) เผื่อติดตั้งกล้องตะแคง
        "rotate": _int("CAMERA_ROTATE", 0),
        # ── ชัตเตอร์: ตัวคุมภาพเบลอตอนคนขยับ ────────────────
        # ว่าง = ปล่อยให้กล้องปรับเอง · ใส่ตัวเลขติดลบ = 2^N วินาที (-7 = 1/128 วินาที)
        # ⚠️ นี่คือทางแก้อาการ "ขยับแล้วหน้าหลุด" ที่ตรงต้นเหตุที่สุด เพราะการเบลอ
        # เกิดที่เซนเซอร์ ซอฟต์แวร์กู้คืนไม่ได้ · วัดแล้วว่า FaceLandmarker ทนเบลอได้
        # ราว 25–30% ของความกว้างใบหน้า เกินนั้นอ่าน landmark ไม่ออกเลย
        # ต้องใส่คู่กับ gain ไม่งั้นภาพจะมืดลงตามเวลาที่หดสั้น
        "exposure": _str("CAMERA_EXPOSURE", ""),
        # ชดเชยความสว่างที่หายไปจากชัตเตอร์สั้น (0–255) — ยิ่งสูงยิ่งมี noise
        "gain": _str("CAMERA_GAIN", ""),
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

    # ── เห็นคนที่อยู่ไกล (โหมดติดตามกิจกรรมเท่านั้น) ─────────
    # ตัวตรวจใบหน้า full-range วางไว้หน้าไปป์ไลน์ + ซูมเข้าที่ใบหน้าก่อนอ่าน landmark
    # สองอย่างนี้แยกกันไม่ได้: ตัวตรวจให้แค่กรอบ ส่วนการซูมคือสิ่งที่ทำให้กรอบนั้น
    # กลายเป็นชื่อ · ค่าจากดวงตา · อารมณ์ (ดูหัวไฟล์ detect.py)
    "detect": {
        "path": _str("DETECT_MODEL_PATH",
                     str(BASE_DIR / "models" / "blaze_face_full_range.tflite")),
        "url": _str(
            "DETECT_MODEL_URL",
            "https://storage.googleapis.com/mediapipe-models/face_detector/"
            "blaze_face_full_range/float16/1/blaze_face_full_range.tflite",
        ),
        "auto_download": _bool("DETECT_AUTO_DOWNLOAD", True),
        # โมเดล full-range มองพื้นที่กว้างกว่า จึงมีโอกาสเห็นลายบนผนังเป็นหน้าคนมากกว่า
        # ถ้าเจอกรอบผีขึ้นมา ให้เพิ่มค่านี้ก่อนเป็นอย่างแรก
        "min_confidence": _num("DETECT_MIN_CONFIDENCE", 0.5),
        "min_suppression": _num("DETECT_MIN_SUPPRESSION", 0.3),
        # IoU ที่ถือว่ากรอบจากตัวตรวจกับใบหน้าที่ landmarker เห็น เป็นคนเดียวกัน
        # ตั้งไม่สูงเพราะสองตัวให้กรอบขนาดต่างกันพอควร (ตัวตรวจให้กรอบกว้างกว่า)
        "merge_iou": _num("DETECT_MERGE_IOU", 0.3),
    },

    # ── ซูมเข้าที่ใบหน้า (ROI) ───────────────────────────────
    "roi": {
        # ⚠️ ตัวคุมราคาหลัก: ซูมได้กี่ใบหน้าต่อเฟรม · 0 = ปิดการซูมทั้งหมด
        # แต่ละครั้งคือ inference ของ FaceLandmarker หนึ่งรอบ · คนที่เกินโควตาไม่ได้
        # ถูกทิ้ง แค่รอคิวเฟรมถัดไป (roi.pick เรียงตามคนที่รอนานสุด)
        "max_per_frame": _int("ROI_MAX_PER_FRAME", 2),
        # ส่วนเผื่อรอบใบหน้าก่อนครอป — ตัวตรวจใบหน้าใน FaceLandmarker ต้องเห็นบริบท
        # รอบหน้าด้วย ครอปชิดเกินไปแล้วมันจะหาหน้าไม่เจอในภาพครอปเสียเอง
        "margin": _num("ROI_MARGIN", 0.6),
        # ขยายภาพครอปให้ด้านสั้นไม่ต่ำกว่านี้ก่อนป้อนโมเดล — นี่คือหัวใจของฟีเจอร์
        "min_px": _int("ROI_MIN_PX", 256),
        "max_px": _int("ROI_MAX_PX", 512),
        # เกลี่ยกรอบครอปกับเฟรมก่อน — กันภาพซูมกระตุกและกัน landmark สั่น
        "smoothing": _num("ROI_SMOOTHING", 0.6),
    },

    # ── ท่าทางร่างกาย (MediaPipe Pose 33 จุด) ────────────────
    # ⚠️ คนละเรื่องกับหมวด "pose" ข้างล่าง ซึ่งเป็นการ**หันหน้า** ไม่ใช่ท่าทางตัว
    # ใช้เฉพาะโหมดติดตามกิจกรรม (modes.Mode.activity) — โหมดอื่นไม่โหลดโมเดลนี้เลย
    "body": {
        "path": _str("BODY_MODEL_PATH", str(BASE_DIR / "models" / "pose_landmarker_lite.task")),
        "url": _str(
            "BODY_MODEL_URL",
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
            "pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        ),
        # lite = 5.8 MB · full = 9.4 MB และช้ากว่า — บน Pi ใช้ lite
        "auto_download": _bool("BODY_AUTO_DOWNLOAD", True),
        # กี่คนพร้อมกัน — ตัวคุมราคาหลักของโมเดลนี้
        "max_people": _int("BODY_MAX_PEOPLE", 3),
        # ⚠️ ตัวคุมราคาที่สำคัญที่สุด: ตรวจท่าทางทุกกี่เฟรม
        # ท่าทางเปลี่ยนในระดับหลายร้อยมิลลิวินาที ไม่ใช่ระดับเฟรม การตรวจทุกเฟรม
        # จึงเป็นการจ่าย CPU ให้ข้อมูลที่ไม่มีใครใช้ · 4 = ราว 4 ครั้ง/วินาทีที่ 15fps
        "every_n_frames": _int("BODY_EVERY_N_FRAMES", 4),
        "min_detection_confidence": _num("BODY_MIN_DETECTION_CONFIDENCE", 0.5),
        "min_presence_confidence": _num("BODY_MIN_PRESENCE_CONFIDENCE", 0.5),
        "min_tracking_confidence": _num("BODY_MIN_TRACKING_CONFIDENCE", 0.5),
        # จุดที่ visibility ต่ำกว่านี้ถือว่ามองไม่เห็น — MediaPipe เดาตำแหน่งจุดที่ถูกบัง
        # ให้เสมอ ถ้าไม่คัดออก ขาที่อยู่ใต้โต๊ะจะตอบว่า "ยืน" อย่างมั่นใจ (ดู body.visible)
        "min_visibility": _num("BODY_MIN_VISIBILITY", 0.6),

        # ── เกณฑ์ของแต่ละท่า (เป็นสัดส่วนของความกว้างไหล่ ไม่ใช่พิกเซล) ──
        # ข้อมือต้องสูงกว่าไหล่เท่านี้ถึงนับว่ายกมือ — กันมือที่พาดอยู่ระดับไหล่พอดี
        "wrist_above_shoulder": _num("BODY_WRIST_ABOVE_SHOULDER", 0.10),
        # ไหล่→ข้อมือ ต้องยาวอย่างน้อยเท่านี้เท่าของ (ต้นแขน+ปลายแขน) ถึงนับว่าเหยียดตรง
        "straight_ratio": _num("BODY_STRAIGHT_RATIO", 0.90),
        # ข้อมือต้องพ้นขอบลำตัวออกไปเท่านี้ถึงนับว่าชี้ไปด้านข้าง
        "point_reach": _num("BODY_POINT_REACH", 0.25),
        "hand_near_hip": _num("BODY_HAND_NEAR_HIP", 0.35),
        "cross_overlap": _num("BODY_CROSS_OVERLAP", 0.10),
        # ── ยืน / นั่ง / นอน — วัดเป็น**องศาจริง** จาก landmark สามแกน ──
        # ใช้ pose_world_landmarks (หน่วยเมตร) ที่โมเดลคืนมาพร้อมพิกัดบนภาพอยู่แล้ว
        # ไม่มีต้นทุนเพิ่ม · ค่าพวกนี้เป็นมุมที่นึกภาพตามได้ตรง ๆ ต่างจากอัตราส่วน
        # ที่ปรับจนพอใช้ได้ซึ่งใช้อยู่ก่อนหน้านี้
        #
        # ⚠️ เหตุผลที่ต้องใช้สามแกน: ต้นขาที่ชี้เข้าหาเลนส์**หดสั้นบนภาพ** · วัดจริงกับ
        # รูปหนึ่งใบ ต้นขาที่ทำมุม 34° กับแนวดิ่ง เหลือเพียง 7° เมื่อดูจากพิกัดสองแกน
        # คลาดไป 27° และคลาดไปในทางที่ทำให้ท่านั่งหน้าตาเหมือนท่ายืนพอดี
        "stand_angle": _num("BODY_STAND_ANGLE_DEG", 30.0),   # ต้นขาห้อยดิ่ง = ยืน
        "sit_angle": _num("BODY_SIT_ANGLE_DEG", 60.0),       # ต้นขาพับไปหน้า = นั่ง
        # ลำตัวเอียงจากแนวดิ่งเกินเท่านี้ = นอน (ถ้าขานอนตามไปด้วย ไม่งั้นคือก้มตัว)
        "lying_angle": _num("BODY_LYING_ANGLE_DEG", 55.0),
        # สะโพกอยู่ต่ำกว่านี้ในเฟรม (0–1) = ตัวถูกขอบล่างตัด ไม่ใช่ถูกโต๊ะบัง
        # สองอย่างนี้ให้คำตอบคนละแบบเมื่อมองไม่เห็นขา — ดู body.posture
        "frame_edge": _num("BODY_FRAME_EDGE", 0.90),

        # ── ยืน/นั่ง จากความสูงศีรษะ เมื่อมองไม่เห็นขา (body.HeadPosture) ──
        # กล้องบนโต๊ะแทบไม่เคยเห็นขา ท่าที่ได้จึงเป็นการเดาจากหลักฐานอ้อมเสมอ
        # ตัวนี้จดความสูงศีรษะตอนที่**วัดขาได้จริง** ไว้เทียบตอนขาหายไป
        "head_posture": _bool("BODY_HEAD_POSTURE", True),
        # ลุกจากเก้าอี้แล้วศีรษะสูงขึ้นกี่เท่าของความกว้างไหล่
        # 1.0 มาจากสัดส่วนร่างกายจริง: ตานั่ง ~123 ซม. · ตายืน ~163 ซม. (ต่าง 40 ซม.)
        # หารด้วยความกว้างไหล่ผู้ใหญ่ ~36–40 ซม. — ไม่ใช่ค่าที่ปรับจนพอใช้ได้
        "head_rise": _num("BODY_HEAD_RISE", 1.0),
        # สองท่าที่จดไว้ต้องห่างกันเกินนี้ถึงจะเชื่อว่าเป็นคนละท่าจริง ไม่ใช่ค่าที่แกว่ง
        "head_min_gap": _num("BODY_HEAD_MIN_GAP", 0.5),
        # ถ่วงค่าที่จดไว้กับค่าใหม่ — สูง = จำของเดิมแน่น ปรับตัวช้า
        "head_smoothing": _num("BODY_HEAD_SMOOTHING", 0.8),
        # ── กันท่าทางกระพริบ (body.PostureHold) ──
        # ต้องเห็นท่าใหม่ค้างกี่วินาทีถึงจะเปลี่ยน · ท่าทางร่างกายเปลี่ยนช้ากว่าท่าแขนมาก
        # จึงถือค้างนานกว่า — คนไม่ได้สลับยืนกับนั่งวินาทีละครั้ง
        "posture_hold_seconds": _num("BODY_POSTURE_HOLD_SECONDS", 1.0),
        # ท่าที่**เดา** (เช่นเดาว่านั่งเพราะมองไม่เห็นขา) ต้องค้างนานกว่านี้เท่าตัวถึงจะ
        # เปลี่ยนได้ — หลักฐานอ้อม ๆ แกว่งง่ายกว่าการวัดจริงมาก
        "posture_unsure_multiplier": _num("BODY_POSTURE_UNSURE_MULTIPLIER", 2.5),

        # ── การถือค้างและการโบกมือ (body.GestureHold) ──
        "hold_seconds": _num("BODY_HOLD_SECONDS", 0.4),
        # หายไปนานกว่านี้ถึงเลิกแสดงป้าย — สั้นกว่านี้ป้ายจะกระพริบตอน landmark หลุด
        "release_seconds": _num("BODY_RELEASE_SECONDS", 0.7),
        "wave_seconds": _num("BODY_WAVE_SECONDS", 1.5),
        # ข้อมือต้องกลับทิศกี่ครั้งในหน้าต่างนั้นถึงนับว่าโบก
        "wave_reversals": _int("BODY_WAVE_REVERSALS", 2),
        "wave_min_swing": _num("BODY_WAVE_MIN_SWING", 0.15),
    },

    # ── การหันหน้า (head pose) ───────────────────────────────
    "pose": {
        # geometric = ประมาณจากตำแหน่งจมูก (ค่าเริ่มต้น ทดสอบแล้ว)
        # matrix    = จาก facial transformation matrix ได้เป็นองศาจริง แม่นกว่า
        #             แต่ต้องยืนยันทิศบนหน้าจอก่อน (ดู matrix_invert_* ด้านล่าง)
        # auto      = ใช้ matrix ถ้ามี ไม่งั้นถอยไป geometric
        "method": _str("POSE_METHOD", "geometric"),
        # ระหว่าง N วินาทีแรก ให้นั่งมองตรง ระบบจะจำท่านิ่งไว้เป็นจุดอ้างอิง
        # (คนที่มีรูปใน faces/ ไม่ต้องรอรอบนี้ — ดู neutral_from_photos ข้างล่าง)
        "calibration_seconds": _num("POSE_CALIBRATION_SECONDS", 3.0),
        # อ่านท่านิ่งจากรูปลงทะเบียนใน faces/ แทนการให้นั่งนิ่งมองตรงตอนเริ่ม
        # รูปพวกนั้นเป็นภาพหน้าตรงอยู่แล้ว จึงเป็นจุดอ้างอิงที่ตรงกว่า "ท่าที่บังเอิญ
        # ทำอยู่ตอนกล้องเห็นครั้งแรก" ซึ่งอาจเป็นท่าหันข้างก็ได้
        # ⚠️ ใช้ได้กับ POSE_METHOD=geometric เท่านั้น (วิธี matrix คิดเป็นองศา คนละหน่วย)
        "neutral_from_photos": _bool("POSE_NEUTRAL_FROM_PHOTOS", True),
        # รูปที่ให้ค่าท่านิ่งเกินเกณฑ์การหันหน้า × ค่านี้ = คนในรูปหันหน้าอยู่จริง ๆ
        # ไม่ใช่ bias ประจำตัว — ไม่เอามาใช้ และบอกผู้ใช้ให้เปลี่ยนรูป
        "photo_neutral_max_ratio": _num("POSE_PHOTO_NEUTRAL_MAX_RATIO", 1.0),
        # แกน pitch ไม่มี "ศูนย์" ให้เทียบ (จมูกอยู่ต่ำกว่าตาเป็นทุนเดิม) จึงเทียบกับ
        # มัธยฐานของคนอื่นในแกลเลอรีแทน — ต้องมีคนอย่างน้อยเท่านี้ถึงจะเชื่อมัธยฐานได้
        # ไม่ถึงจำนวนนี้ = ข้ามการตรวจแกน pitch ไป (ดู faces.usable_neutrals)
        "photo_neutral_min_people": _int("POSE_PHOTO_NEUTRAL_MIN_PEOPLE", 3),
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
        # ใบหน้าที่ถูกซูมอ่าน (roi.py) ให้ landmark แม่นกว่าที่จำนวนพิกเซลในเฟรมบ่งบอก
        # เพราะโมเดลได้ทำงานที่ความละเอียดที่มันถูกฝึกมา · ค่านี้คือ**เพดานของเครดิต**นั้น
        # 2.0 = ใบหน้าที่ซูมแล้วถูกนับว่าใหญ่ได้มากสุดสองเท่าของขนาดจริงในเฟรม
        #
        # ⚠️ เป็นค่าประมาณ ไม่ใช่ค่าที่วัดมา — การขยายภาพไม่ได้สร้างพิกเซลของเปลือกตา
        # ขึ้นมาจริง ตั้งสูงเกินไปแล้วค่า EAR ของคนไกลจะเป็นสัญญาณรบกวนที่ดูน่าเชื่อ
        # ตั้ง 1.0 เพื่อปิดเครดิตนี้ทั้งหมด (กลับไปนับเฉพาะพิกเซลในเฟรมตามเดิม)
        "zoom_credit": _num("QUALITY_ZOOM_CREDIT", 2.0),
    },

    # ── ส่งข้อมูลขึ้น Supabase ───────────────────────────────
    # ไม่ใส่ url/key = ไม่ส่งอะไรเลย (โปรแกรมยังทำงานและแสดงผลบนจอตามปกติ)
    "supabase": {
        # ใส่แค่โดเมนโปรเจกต์ (https://xxxx.supabase.co) — uploader เติม /rest/v1 ให้เอง
        "url": _str("SUPABASE_URL", ""),
        "key": _str("SUPABASE_ANON_KEY", ""),
        "focus_table": _str("SUPABASE_FOCUS_TABLE", "focus"),
        # โหมดห้องรวมมี payload คนละแบบ ต้องมีตารางของตัวเอง
        # เว้นว่าง = โหมดนั้นไม่ส่งข้อมูล (ยังไม่มีตารางรองรับในโครงงานนี้)
        "room_table": _str("SUPABASE_ROOM_TABLE", ""),
        "timeout_seconds": _num("SUPABASE_TIMEOUT_SECONDS", 10.0),
        # คิวบนดิสก์เผื่อเน็ตหลุด — เก็บเป็น JSON บรรทัดละแถว
        "queue_path": _str("SUPABASE_QUEUE_PATH", str(BASE_DIR / "queue.jsonl")),
        # เกินนี้ทิ้งแถวเก่าสุดก่อน (FIFO) — ข้อมูลใหม่มีค่ากว่าข้อมูลเก่าที่ส่งไม่ผ่าน
        # และการโตไม่จำกัดจะกินการ์ด SD จนเต็ม
        "queue_max": _int("SUPABASE_QUEUE_MAX", 5000),
        # หน่วงก่อนลองใหม่ เพิ่มเป็นเท่าตัวทุกครั้งที่ล้มเหลว จนถึงเพดาน
        "retry_base_seconds": _num("SUPABASE_RETRY_BASE_SECONDS", 1.0),
        "retry_max_seconds": _num("SUPABASE_RETRY_MAX_SECONDS", 60.0),
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
        # ⚠️ เมื่อ auto_threshold เปิดอยู่ ค่านี้เป็นแค่ค่าสำรองตอนที่วัดจากรูปไม่ได้
        "threshold": _num("FACES_THRESHOLD", 0.045),
        # ── ตั้งเกณฑ์เองจากชุดรูป ─────────────────────────────
        # คำนวณ threshold จากรูปในโฟลเดอร์ทุกครั้งที่อ่านรูป แทนการใช้ค่าตายตัว
        # ข้างบน (ซึ่งมาจากใบหน้าสังเคราะห์ตอนพัฒนา ไม่ใช่รูปของคนที่ใช้จริง)
        # false = ใช้ FACES_THRESHOLD ตรง ๆ เหมือนเดิม · ดูวิธีคิดใน faces.calibrate
        "auto_threshold": _bool("FACES_AUTO_THRESHOLD", True),
        # เปอร์เซ็นไทล์ของระยะ "รูปคนเดียวกันห่างกัน" ที่ใช้เป็นพื้น
        # ไม่ใช้ค่าสูงสุดเพราะรูปเบี้ยวใบเดียวจะดันเกณฑ์ขึ้นจนหลวมทั้งระบบ
        "auto_intra_percentile": _num("FACES_AUTO_INTRA_PERCENTILE", 0.9),
        # ส่วนเผื่อเหนือพื้นนั้น — รูปบอกไม่ได้ว่ากล้องจริงสั่นแค่ไหน แสงต่างแค่ไหน
        # ระยะจากกล้องถึงหน้าต่างจากตอนถ่ายรูปแค่ไหน ค่านี้คือส่วนเผื่อสำหรับข้อนั้น
        "auto_spread": _num("FACES_AUTO_SPREAD", 1.5),
        # เพดาน = ระยะของคู่คนที่ใกล้กันที่สุด × ค่านี้ · ต่ำ = กันชนหนาขึ้น ปลอดภัยขึ้น
        "auto_inter_fraction": _num("FACES_AUTO_INTER_FRACTION", 0.5),
        # ขอบเขตที่ค่าคำนวณต้องอยู่ในนั้น — กันชุดรูปผิดปกติ (เช่นรูปคนเดียวกันซ้ำสองชื่อ
        # หรือรูปเบลอทั้งชุด) ไม่ให้ลากเกณฑ์ไปสุดทางจนระบบจำผิดหมดหรือไม่จำใครเลย
        # พื้นตั้งไว้ต่ำกว่าที่ชุดรูปปกติจะไปถึง เพื่อให้แกลเลอรีที่มีคนหน้าคล้ายกันมาก
        # กดเกณฑ์ลงได้จริง (ผลคือคู่นั้นได้ชื่อแบบมี `?` แทนชื่อที่ดูมั่นใจ)
        "auto_min": _num("FACES_AUTO_MIN", 0.01),
        "auto_max": _num("FACES_AUTO_MAX", 0.09),
        # ratio test — ต้องดีกว่าอันดับสองอย่างชัดเจน ไม่งั้นถือว่าแยกไม่ออก
        "ratio": _num("FACES_RATIO", 0.75),
        # true = เดาคนที่ใกล้ที่สุดเสมอ ไม่ตอบว่าไม่รู้ · ชื่อที่ยังไม่ผ่านเกณฑ์ข้างบน
        #        จะมี `?` ต่อท้ายบนหน้าจอ แต่ในฐานข้อมูลเป็นชื่อธรรมดา แยกไม่ออก
        # false = ไม่มั่นใจให้ใช้หมายเลขแทนชื่อ (ปลอดภัยกว่าเวลาเอาข้อมูลไปใช้จริง)
        "guess": _bool("FACES_GUESS", True),
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
        # ── ขยายวงจับคู่ตามเวลาที่คนหายไป ────────────────────
        # ⚠️ ปิดไว้ (0) เพราะ**วัดแล้วว่าอันตราย** ไม่ใช่เพราะยังไม่ได้ลอง
        # ฟังดูสมเหตุสมผลว่าคนที่หายไปนานกว่าย่อมไปได้ไกลกว่า จึงควรผ่อนวงให้ แต่วง
        # ที่กว้างขึ้นไม่ได้แยกว่า "คนเดิมที่เดินไป" กับ "คนใหม่ที่เพิ่งเดินเข้ามา"
        # ต่างกันตรงไหน — เรขาคณิตอย่างเดียวบอกไม่ได้
        # วัดจากชุดสถานการณ์: เปิดที่ 2.0/0.8 รักษา id ได้ดีขึ้น (47%→72%) จริง
        # แต่คนใหม่สวมรอย id ของคนที่เพิ่งออกไป **92% ของกรณี** (จาก 0%)
        # ซึ่งแย่กว่าปัญหาที่แก้มาก · ทางที่ปลอดภัยกว่าคือ predict_horizon ข้างล่าง
        # เปิดได้ถ้ามั่นใจว่ามีคนเดียวในเฟรมเสมอ (ไม่มีใครให้สวมรอย)
        "gate_drift": _num("TRACKER_GATE_DRIFT", 0.0),
        "max_gate": _num("TRACKER_MAX_GATE", 0.25),
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
        # ⚠️ ทำนายล่วงหน้าได้ไกลสุดกี่วินาที — ตัวคุมหลักของ "คนขยับเยอะแล้ว id หลุด"
        # ความเร็วมาจากผลต่างตำแหน่งสองเฟรมซึ่งมี noise ติดมา คูณด้วย dt ยาว ๆ คือการ
        # ขยาย noise นั้น และคนที่**หยุดเดิน**ตอนที่ตรวจไม่เจอจะถูกทำนายว่าไปไกลลิบ
        # วัดกับชุดสถานการณ์การเคลื่อนไหว 144 แบบ: ไม่จำกัด = รักษา id ได้ 37%
        # ที่ 0.10 วินาที = 47% · ต่ำกว่านี้ (0.05) การทำนายอ่อนไปจน id เริ่มสลับคน
        "predict_horizon": _num("TRACKER_PREDICT_HORIZON", 0.10),
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
        # โชว์คะแนนอารมณ์ดิบทั้งสี่ค่าใต้แต่ละคน — สลับได้ด้วยปุ่ม e ขณะรัน
        # ใช้ตอนจะปรับ EMOTION_THRESHOLD ให้เข้ากับกล้องและแสงของห้องจริง
        "show_emotion_scores": _bool("DISPLAY_EMOTION_SCORES", False),
    },
}


def get(path: str):
    """อ่านค่าแบบ 'camera.width' — ใช้ตอนอยากอ้างถึงค่าเดียวโดยไม่ต้องส่ง dict ทั้งก้อน."""
    node = CONFIG
    for part in path.split("."):
        node = node[part]
    return node
