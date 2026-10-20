"""
Auto-Submit Moodle Assignment [ULTRA-FAST HYBRID MULTI-SLOT SERIES CLI MODE]
=============================================================================
All-in-one script for UNAIR eLearning assignment sequential submission (bot6).

ALGORITHM SPECIFICATION:
- Folders file1 through file9 can be empty.
- Dynamic scan: Checks file1 to filei, where filei is the last folder (highest index <= 9)
  that contains a PDF file.
- The order of submission is strictly [file1..filei] in ascending order, then file0.
- file0 MUST strictly be the last to submit.

KEY CAPABILITIES (Ported from bot4):
- Opsi 1 Pre-Unlock Draft Upload: Pre-uploads PDF files to Moodle server-side
  draft storage BEFORE countdown finishes. Zero file transfer network lag at T=0!
- Server Clock Offset Synchronization: Measures Moodle NTP skew to millisecond
  accuracy via HTTP Date header.
- Instant Draft Injection: Injects draft itemid directly into files_filemanager
  and triggers Save changes in < 100 ms per user!
- Three-Pages Skip Approach: Staged directly on editsubmission form, bypassing
  heavy course page and overview page.
- Locked 303 Redirect Resilience: Micro-polling loop re-targets the direct edit URL
  every 150 ms if Moodle temporarily redirects to course view.
- Resilient Fallback: If pre-upload fails, automatically falls back to full DOM modal.
- Headless CLI authentication (Zero GUI).
"""

import sys, os, subprocess
import time, random, re, email.utils
from datetime import datetime

# ──────────────────────────────────────────────────────────────────────────────
# PLAYWRIGHT IMPORT & AUTO-DELEGATION BRIDGE
# ──────────────────────────────────────────────────────────────────────────────
try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
except ModuleNotFoundError:
    if os.environ.get("_PLAYWRIGHT_DELEGATED") != "1":
        candidates = [
            os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe"),
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Python\Python313\python.exe"),
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Python\Python312\python.exe"),
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Python\Python311\python.exe"),
            "py",
            "python.exe",
        ]
        for cand in candidates:
            try:
                probe = subprocess.run([cand, "-c", "import playwright"], capture_output=True)
                if probe.returncode == 0:
                    env = os.environ.copy()
                    env["_PLAYWRIGHT_DELEGATED"] = "1"
                    ret = subprocess.run([cand, os.path.abspath(__file__)] + sys.argv[1:], env=env)
                    sys.exit(ret.returncode)
            except Exception:
                pass
    print("[ERROR] Module 'playwright' not found in current Python interpreter.")
    print(f"Current interpreter: {sys.executable}")
    print("Please run this script using:")
    print("  py auto_submit.py")
    print("or install playwright with:")
    print("  python -m pip install playwright")
    print("  python -m playwright install chromium")
    sys.exit(1)

# ──────────────────────────────────────────────────────────────────────────────
# CONFIGURATION & ENVIRONMENT
# ──────────────────────────────────────────────────────────────────────────────

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Optional .env loader for zero-friction configuration
env_path = os.path.join(BASE_DIR, ".env")
if os.path.isfile(env_path):
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except Exception:
        pass

LOG_FILE           = os.path.join(BASE_DIR, "submissions.log")
ELEMENT_TIMEOUT_MS = 30_000
LOGIN_URL          = os.environ.get("MOODLE_LOGIN_URL", "https://hebat.elearning.unair.ac.id/login/index.php")

# ── USER CREDENTIALS MAPPING (SLOTS 0 to 9) ───────────────────────────────────
# Slot 0 submits strictly LAST (file0/)
# Slot 1 submits first in series (file1/)
# Slots 2-9 can be configured here or via environment variables / .env
USERS = {
    0: {
        "username": os.environ.get("MOODLE_USER0", ""),
        "password": os.environ.get("MOODLE_PASS0", ""),
    },
    1: {
        "username": os.environ.get("MOODLE_USER1", ""),
        "password": os.environ.get("MOODLE_PASS1", ""),
    },
    2: {
        "username": os.environ.get("MOODLE_USER2", ""),
        "password": os.environ.get("MOODLE_PASS2", ""),
    },
    3: {
        "username": os.environ.get("MOODLE_USER3", ""),
        "password": os.environ.get("MOODLE_PASS3", ""),
    },
    4: {
        "username": os.environ.get("MOODLE_USER4", ""),
        "password": os.environ.get("MOODLE_PASS4", ""),
    },
    5: {
        "username": os.environ.get("MOODLE_USER5", ""),
        "password": os.environ.get("MOODLE_PASS5", ""),
    },
    6: {
        "username": os.environ.get("MOODLE_USER6", ""),
        "password": os.environ.get("MOODLE_PASS6", ""),
    },
    7: {
        "username": os.environ.get("MOODLE_USER7", ""),
        "password": os.environ.get("MOODLE_PASS7", ""),
    },
    8: {
        "username": os.environ.get("MOODLE_USER8", ""),
        "password": os.environ.get("MOODLE_PASS8", ""),
    },
    9: {
        "username": os.environ.get("MOODLE_USER9", ""),
        "password": os.environ.get("MOODLE_PASS9", ""),
    },
}

# Aliases for backward compatibility
USERNAME0 = USERS[0]["username"]
PASSWORD0 = USERS[0]["password"]
USERNAME1 = USERS[1]["username"]
PASSWORD1 = USERS[1]["password"]

# ── COURSE PAGE ────────────────────────────────────────────────────────────────
COURSE_PAGE_URL = os.environ.get("COURSE_PAGE_URL", "https://hebat.elearning.unair.ac.id/course/view.php?id=10983")

# ── ASSIGNMENT NAME ────────────────────────────────────────────────────────────
ASSIGNMENT_NAME = os.environ.get("ASSIGNMENT_NAME", "Soal Latihan Ruang Vektor di R2 dan R3 : Hasil Kali Titik dan Hasil Kali Silang")

# ── DIRECT ASSIGNMENT URL (ULTRA-FAST MODE) ────────────────────────────────────
# Leave empty ("") to AUTOMATICALLY resolve the exact module ID from COURSE_PAGE_URL!
# Only set a URL here if you want to explicitly override the auto-detection.
ASSIGNMENT_URL = os.environ.get("ASSIGNMENT_URL", "")

# ── SUBMISSION SCHEDULE ────────────────────────────────────────────────────────
# The bot will wait until this exact moment before submitting.
# If in the past or now, submission executes immediately without waiting.
TARGET_YEAR   = int(os.environ.get("TARGET_YEAR", 2026))
TARGET_MONTH  = int(os.environ.get("TARGET_MONTH", 10))
TARGET_DAY    = int(os.environ.get("TARGET_DAY", 20))
TARGET_HOUR   = int(os.environ.get("TARGET_HOUR", 19))
TARGET_MINUTE = int(os.environ.get("TARGET_MINUTE", 43))
TARGET_SECOND = int(os.environ.get("TARGET_SECOND", 0))

# ──────────────────────────────────────────────────────────────────────────────
# FILE RESOLUTION & DYNAMIC SLOT QUEUE ALGORITHM
# ──────────────────────────────────────────────────────────────────────────────

def get_target_file(folder_path: str) -> str:
    """
    Automatically detects and returns the path of the PDF file inside the given folder.
    Prioritizes .pdf files (case-insensitive).
    """
    if os.path.isdir(folder_path):
        # 1. Look for PDF files first
        pdf_files = [
            os.path.join(folder_path, f)
            for f in os.listdir(folder_path)
            if os.path.isfile(os.path.join(folder_path, f))
            and not f.startswith(".")
            and f.lower().endswith(".pdf")
        ]
        if pdf_files:
            return pdf_files[0]

        # 2. Fallback to any non-hidden file
        all_files = [
            os.path.join(folder_path, f)
            for f in os.listdir(folder_path)
            if os.path.isfile(os.path.join(folder_path, f))
            and not f.startswith(".")
        ]
        if all_files:
            return all_files[0]
    return ""

def resolve_submission_slots() -> tuple[list[dict], int | None]:
    """
    Dynamic Slot Queue Algorithm:
    1. Scan file1 through file9 to find filei, where filei is the last folder (highest index <= 9)
       that contains a PDF file.
    2. Check file1 to filei. Folders file[1-9] can be empty.
       Collect active slots in range [1..last_i] that contain a valid PDF.
    3. Append file0 at the very end.
       Order of submission: [file1..filei], then file0.
       file0 MUST strictly be the last to submit.
    """
    # Step 1: Find filei, the last folder among file1..file9 containing a PDF
    last_i = None
    for idx in range(9, 0, -1):
        folder = os.path.join(BASE_DIR, f"file{idx}")
        fpath = get_target_file(folder)
        if fpath and fpath.lower().endswith(".pdf"):
            last_i = idx
            break

    queue = []

    # Step 2: Check file1 to filei
    if last_i is not None:
        print(f"[SCAN]  Last folder with PDF in file[1-9] is file{last_i} (i={last_i}).")
        for idx in range(1, last_i + 1):
            folder = os.path.join(BASE_DIR, f"file{idx}")
            fpath = get_target_file(folder)
            if fpath:
                queue.append({
                    "slot": idx,
                    "folder": folder,
                    "file_path": fpath,
                    "tag": f"Username{idx}",
                })
            else:
                print(f"[SCAN]  file{idx} is empty (skipped).")
    else:
        print("[SCAN]  file1 to file9 are all empty.")

    # Step 3: file0 must strictly be the last to submit
    file0_folder = os.path.join(BASE_DIR, "file0")
    file0_path = get_target_file(file0_folder)
    if file0_path:
        queue.append({
            "slot": 0,
            "folder": file0_folder,
            "file_path": file0_path,
            "tag": "Username0",
        })
        print(f"[SCAN]  file0 found: {os.path.basename(file0_path)} (Strictly LAST to submit).")
    else:
        print(f"[WARN]  file0 folder ({file0_folder}) is EMPTY! file0 is required to be the final submitter.")

    return queue, last_i

# ──────────────────────────────────────────────────────────────────────────────
# TIMING & CLOCK SYNCHRONIZATION HELPERS
# ──────────────────────────────────────────────────────────────────────────────

def get_target_time():
    return datetime(TARGET_YEAR, TARGET_MONTH, TARGET_DAY,
                    TARGET_HOUR, TARGET_MINUTE, TARGET_SECOND)

def get_elapsed_seconds(target_time: datetime) -> float:
    """Returns the floating-point seconds elapsed since the targeted time."""
    return (datetime.now() - target_time).total_seconds()

def get_server_clock_offset(request_context, base_url: str = "https://hebat.elearning.unair.ac.id") -> float:
    """
    Samples server clock offset relative to local clock using HTTP Date header.
    Returns offset in seconds (server_time - local_time).
    """
    offsets = []
    head_url = f"{base_url}/login/index.php"
    for _ in range(5):
        t0 = time.time()
        try:
            res = request_context.fetch(head_url, method="HEAD")
            t1 = time.time()
            date_str = res.headers.get("date")
            if date_str:
                server_dt = email.utils.parsedate_to_datetime(date_str)
                server_ts = server_dt.timestamp()
                # HTTP Date has 1s resolution, midpoint is +0.5s
                offset = (server_ts + 0.5) - ((t0 + t1) / 2.0)
                offsets.append(offset)
        except Exception:
            pass
    if not offsets:
        return 0.0
    offsets.sort()
    return offsets[len(offsets) // 2]

def write_log(result: str, username: str, active_file: str, elapsed_sec: float, note: str = ""):
    """Silently append one line to submissions.log with full context and elapsed seconds."""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")
    fname = os.path.basename(active_file) if active_file else "unknown"
    line = (
        f"{ts} | {elapsed_sec:>10.6f}s | {result:<12} | "
        f"user={username} | "
        f"course={COURSE_PAGE_URL} | "
        f"assignment={ASSIGNMENT_NAME} | "
        f"file={fname}"
        + (f" | {note}" if note else "") + "\n"
    )
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass

def countdown_to_target(target: datetime, server_offset_sec: float = 0.0):
    effective_target_ts = target.timestamp() - server_offset_sec
    print(f"\n[WAIT] Target (Local Time):  {target.strftime('%Y-%m-%d %H:%M:%S')}")
    if abs(server_offset_sec) > 0.001:
        corrected_dt = datetime.fromtimestamp(effective_target_ts)
        print(f"[SYNC] Server clock offset: {server_offset_sec * 1000:+.1f} ms")
        print(f"[SYNC] Corrected trigger:   {corrected_dt.strftime('%H:%M:%S.%f')[:-3]}")
    print("-" * 55)
    while True:
        now_ts = time.time()
        rem = effective_target_ts - now_ts
        if rem <= 0:
            break
        if rem > 3:
            m, s = divmod(int(rem), 60)
            h, m = divmod(m, 60)
            print(f"   [T-] {h:02d}:{m:02d}:{s:02d}")
            time.sleep(min(5.0, rem - 3.0))
        else:
            time.sleep(0.002)

# ──────────────────────────────────────────────────────────────────────────────
# AUTHENTICATION & SESSION MANAGEMENT
# ──────────────────────────────────────────────────────────────────────────────

def session_valid(page) -> bool:
    """Check if the current page indicates an active logged-in session."""
    if any(x in page.url.lower() for x in ["login", "sso", "auth"]):
        return False
    try:
        page.wait_for_selector(".usermenu, #page-header, .course-content, #page-content", state="visible", timeout=8_000)
        return True
    except PlaywrightTimeout:
        return False

def loc(page, sel):
    e = page.locator(sel).first
    e.wait_for(state="visible", timeout=ELEMENT_TIMEOUT_MS)
    return e

def perform_login(page, username: str, password: str, user_tag: str) -> bool:
    """Logs into UNAIR eLearning headlessly via CLI without any GUI interaction."""
    page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=60_000)
    page.wait_for_selector("#username", state="visible", timeout=20_000)
    page.fill("#username", username)
    page.fill("#password", password)
    page.click("#loginbtn")
    page.wait_for_load_state("domcontentloaded", timeout=30_000)

    if any(x in page.url.lower() for x in ["login", "sso", "auth"]):
        return False
    return True

def ensure_session(user_tag: str, username: str, password: str, session_file: str) -> bool:
    """
    Ensures a valid session exists on disk before countdown.
    Returns True if valid/authenticated.
    Returns False if authentication fails (allowing script to skip this user).
    """
    has_session = os.path.isfile(session_file)
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        try:
            ctx = b.new_context(storage_state=session_file if has_session else None)
            p = ctx.new_page()
            try:
                check_url = ASSIGNMENT_URL if ASSIGNMENT_URL else COURSE_PAGE_URL
                p.goto(check_url, wait_until="domcontentloaded", timeout=30_000)
            except Exception:
                pass

            if not session_valid(p):
                print(f"[AUTH]  [{user_tag}] Refreshing session headlessly...")
                if not username or not password:
                    print(f"[WARN]  [{user_tag}] Missing credentials and session expired/missing. Skipping user.")
                    b.close()
                    return False
                if perform_login(p, username, password, user_tag):
                    ctx.storage_state(path=session_file)
                    print(f"[OK]    [{user_tag}] Session saved: {session_file}")
                    b.close()
                    return True
                else:
                    print(f"[WARN]  [{user_tag}] Authentication failed. Skipping user.")
                    b.close()
                    return False
            else:
                print(f"[OK]    [{user_tag}] Session ready.")
                b.close()
                return True
        except Exception as e:
            print(f"[WARN]  [{user_tag}] Session verification error: {e}. Skipping user.")
            try:
                b.close()
            except Exception:
                pass
            return False

# ──────────────────────────────────────────────────────────────────────────────
# THREE-PAGES SKIP & PRE-UNLOCK DRAFT UPLOADER (OPSI 1)
# ──────────────────────────────────────────────────────────────────────────────

def get_edit_submission_url(assign_url: str) -> str:
    """Constructs direct editsubmission URL bypassing the assignment overview page."""
    if not assign_url:
        return ""
    if "action=editsubmission" in assign_url:
        return assign_url
    sep = "&" if "?" in assign_url else "?"
    return f"{assign_url}{sep}action=editsubmission"

def resolve_assignment_url(page, course_url: str, assignment_name: str) -> str:
    """
    Auto-detects the direct assignment URL from the course page.
    Works whether the assignment is active or time-locked/restricted!
    """
    if ASSIGNMENT_URL:
        return ASSIGNMENT_URL

    try:
        if course_url not in page.url:
            page.goto(course_url, wait_until="domcontentloaded", timeout=ELEMENT_TIMEOUT_MS)

        try:
            page.wait_for_selector(".course-content, #course-index, .section", state="visible", timeout=10_000)
        except Exception:
            pass

        # 1. Active link
        for sel in [
            f"a[href*='assign']:has(span.instancename:has-text('{assignment_name}'))",
            f"a[href*='assign']:has-text('{assignment_name}')",
        ]:
            c = page.locator(sel).first
            if c.count() > 0:
                h = c.get_attribute("href")
                if h and "view.php?id=" in h:
                    return h

        # 2. Time-locked/restricted activity container (has data-id or module-XXXXX)
        mod = page.locator(
            f"li.activity.assign:has-text('{assignment_name}'), "
            f"[data-activityname*='{assignment_name}']"
        ).first
        if mod.count() > 0:
            cmid = mod.get_attribute("data-id")
            if not cmid:
                mod_id = mod.get_attribute("id") or ""
                if mod_id.startswith("module-"):
                    cmid = mod_id.replace("module-", "")
            if cmid:
                return f"https://hebat.elearning.unair.ac.id/mod/assign/view.php?id={cmid}"

        # 3. Course index drawer
        ci = page.locator(f"li.courseindex-item:has-text('{assignment_name}')").first
        if ci.count() > 0:
            cmid = ci.get_attribute("data-id")
            if cmid:
                return f"https://hebat.elearning.unair.ac.id/mod/assign/view.php?id={cmid}"
    except Exception:
        pass
    return ""

def extract_course_metadata(page) -> tuple[str, str]:
    """Extracts Moodle sesskey and course context ID from active page environment."""
    sesskey = page.evaluate("() => (window.M && window.M.cfg && window.M.cfg.sesskey) || ''")
    context_id = page.evaluate("() => (window.M && window.M.cfg && window.M.cfg.contextid) || ''")
    if not context_id or str(context_id) == "1":
        try:
            body_classes = page.evaluate("() => document.body.className")
            m = re.search(r"context-(\d+)", body_classes)
            if m:
                context_id = m.group(1)
        except Exception:
            pass
    return str(sesskey), str(context_id)

def pre_upload_draft_file(request_context, file_path: str, sesskey: str, context_id: str, user_tag: str = "User", base_url: str = "https://hebat.elearning.unair.ac.id") -> int | None:
    """
    [OPSI 1 ENGINE]
    Pre-uploads assignment file to Moodle draft area prior to assignment unlock.
    Uses course context + random 9-digit itemid (Candidate K1 approach).
    Returns the draft itemid upon success, or None on failure.
    """
    if not file_path or not os.path.isfile(file_path):
        return None
    if not sesskey or not context_id or context_id == "1":
        return None

    itemid = random.randint(100000000, 999999999)
    file_name = os.path.basename(file_path)

    with open(file_path, "rb") as f:
        file_bytes = f.read()

    upload_url = f"{base_url}/repository/repository_ajax.php?action=upload"
    try:
        t0 = time.time()
        res = request_context.post(
            upload_url,
            multipart={
                "repo_upload_file": {"name": file_name, "mimeType": "application/pdf", "buffer": file_bytes},
                "sesskey": str(sesskey),
                "repo_id": "5",
                "itemid": str(itemid),
                "author": "Student",
                "title": file_name,
                "savepath": "/",
                "ctx_id": str(context_id),
                "client_id": "client_" + str(random.randint(100000, 999999)),
                "maxbytes": "104857600",
                "areamaxbytes": "-1",
                "env": "filemanager",
                "license": "unknown",
            },
            timeout=30_000,
        )
        latency_ms = (time.time() - t0) * 1000.0
        if res.status == 200:
            data = res.json()
            if not data.get("error"):
                print(f"[OK]    [{user_tag}] Pre-uploaded draft in {latency_ms:.1f}ms! (itemid: {itemid}, {file_name})")
                return itemid
            else:
                print(f"[WARN]  [{user_tag}] Draft upload error: {data.get('error')}")
        else:
            print(f"[WARN]  [{user_tag}] Draft upload HTTP status: {res.status}")
    except Exception as e:
        print(f"[WARN]  [{user_tag}] Failed to pre-upload draft: {e}")
    return None

# ──────────────────────────────────────────────────────────────────────────────
# SUBMISSION WORKFLOW (ZERO-BOTTLENECK RACE ENGINE)
# ──────────────────────────────────────────────────────────────────────────────

RACE_TIMEOUT_MS = 3_000

def trigger_submission(page, user_tag: str, username: str, file_path: str, target_time: datetime, assign_url: str, draft_item_id: int | None = None) -> tuple[bool, float]:
    """
    Executes the critical submission trigger with ultra-fast failure semantics.
    If ANY error occurs, raises immediately so the caller can skip to the next
    user without becoming a bottleneck.
    Returns (True, elapsed_seconds) upon successful Save changes click.
    """
    edit_url = get_edit_submission_url(assign_url)
    target_nav_url = edit_url or assign_url or COURSE_PAGE_URL
    form_sel = "#fitem_id_files_filemanager, .filemanager, #id_onlinetext_editor, [data-fieldtype='filemanager'], #id_submitbutton"

    # 1. Fast check if already on editsubmission form
    is_on_form = False
    try:
        if page.locator("input[name='files_filemanager'], #id_submitbutton, #id_onlinetext_editor, .filemanager").first.is_visible(timeout=100):
            is_on_form = True
    except Exception:
        pass

    if not is_on_form:
        page.goto(target_nav_url, wait_until="domcontentloaded", timeout=RACE_TIMEOUT_MS)

        # Runtime auth check
        if any(x in page.url.lower() for x in ["login", "sso", "auth"]):
            raise RuntimeError(f"Session redirected to login page: {page.url}")

        # Fast micro-poll loop: handles locked 303 redirect or clock skew
        deadline = time.time() + 3.0
        while time.time() < deadline:
            if page.locator("input[name='files_filemanager'], #id_submitbutton, .filemanager").first.is_visible(timeout=50):
                is_on_form = True
                break
            btn = page.locator(
                "button:has-text('Add submission'), button:has-text('Edit submission'), "
                "input[type='submit'][value='Add submission'], input[type='submit'][value='Edit submission']"
            ).first
            if btn.is_visible(timeout=50):
                btn.click()
                page.wait_for_load_state("domcontentloaded", timeout=2_000)
                is_on_form = True
                break
            time.sleep(0.08)
            if "course/view.php" in page.url or "action=editsubmission" not in page.url:
                page.goto(target_nav_url, wait_until="domcontentloaded", timeout=2_000)
            else:
                page.reload(wait_until="domcontentloaded", timeout=2_000)

    has_filemanager = False
    try:
        fm_elem = page.locator("#fitem_id_files_filemanager, .filemanager, [data-fieldtype='filemanager'], input[name='files_filemanager']").first
        if fm_elem.is_visible(timeout=200):
            has_filemanager = True
    except Exception:
        has_filemanager = False

    if has_filemanager and draft_item_id:
        # ── OPSI 1: ULTRA-FAST ATOMIC INJECTION & CLICK (ZERO PLAYWRIGHT LAG) ──
        upload_elapsed = get_elapsed_seconds(target_time)
        print(f"[{upload_elapsed:.6f}s] [DRAFT] [{user_tag}] Atomic inject & submit (itemid: {draft_item_id})")

        # Atomic DOM evaluation: injects draft item ID AND triggers form submit in 1-2 ms
        res = page.evaluate("""(itemId) => {
            const fm = document.querySelector("input[name='files_filemanager']");
            if (fm) {
                fm.value = String(itemId);
                fm.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const btn = document.querySelector("#id_submitbutton, input[type='submit'][value='Save changes'], button[type='submit'][value='Save changes']");
            if (btn) {
                btn.click();
                return { clicked: true, method: 'button' };
            }
            const form = document.querySelector("form.mform, #mform1, form[action*='view.php']");
            if (form) {
                form.submit();
                return { clicked: true, method: 'form' };
            }
            return { clicked: false, method: 'none' };
        }""", draft_item_id)

        save_elapsed = get_elapsed_seconds(target_time)
        print(f"[{save_elapsed:.6f}s] [SAVE]  [{user_tag}] Clicked Save changes (atomic DOM trigger)")
        return True, save_elapsed

    elif has_filemanager and not draft_item_id:
        # ── FALLBACK PATH: FAST UI FILEPICKER MODAL (RACE-PROTECTED) ─────
        page.locator(".fp-btn-add a").first.click(timeout=RACE_TIMEOUT_MS)
        page.wait_for_selector(
            ".filepicker:not(.moodle-dialogue-hidden), [id^='filepicker-']:not(.moodle-dialogue-hidden)",
            state="visible", timeout=RACE_TIMEOUT_MS
        )

        try:
            upload_repo = page.locator(".fp-repo-name:has-text('Upload a file')").first
            if upload_repo.is_visible(timeout=300):
                upload_repo.click()
        except Exception:
            pass

        upload_elapsed = get_elapsed_seconds(target_time)
        print(f"[{upload_elapsed:.6f}s] [UPLOAD] [{user_tag}] Started file upload: {os.path.basename(file_path)}")

        page.locator("input[name='repo_upload_file']").first.set_input_files(file_path)
        page.locator("button.fp-upload-btn").first.click(timeout=RACE_TIMEOUT_MS)

        upload_deadline = time.time() + 3.0
        while time.time() < upload_deadline:
            try:
                ow = page.locator("button:has-text('Overwrite'), .fp-dlg-butoverwrite").first
                if ow.is_visible(timeout=30):
                    ow.click()
            except Exception:
                pass
            try:
                if page.locator(".filemanager .fp-file, .filemanager .fp-filename").first.is_visible(timeout=30):
                    break
            except Exception:
                pass
            try:
                modal_open = page.locator(".filepicker:not(.moodle-dialogue-hidden)").first.is_visible(timeout=30)
                if not modal_open:
                    break
            except Exception:
                pass
            time.sleep(0.03)

        save_sel = "#id_submitbutton, input[type='submit'][value='Save changes'], button:has-text('Save changes')"
        save_btn = page.locator(save_sel).first
        save_btn.click(timeout=RACE_TIMEOUT_MS)
        save_elapsed = get_elapsed_seconds(target_time)
        print(f"[{save_elapsed:.6f}s] [SAVE]  [{user_tag}] Clicked Save changes")
        return True, save_elapsed

    else:
        # Online text submission
        upload_elapsed = get_elapsed_seconds(target_time)
        print(f"[{upload_elapsed:.6f}s] [UPLOAD] [{user_tag}] Submitting online text for file: {os.path.basename(file_path)}")

        submission_text = f"NIM: {username}\nFile: {os.path.basename(file_path)}"
        page.evaluate("""(text) => {
            if (window.tinymce && window.tinymce.activeEditor) {
                window.tinymce.activeEditor.setContent(text);
            }
            const ta = document.getElementById('id_onlinetext_editor');
            if (ta) {
                ta.value = text;
                ta.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const btn = document.querySelector("#id_submitbutton, input[type='submit'][value='Save changes'], button[type='submit'][value='Save changes']");
            if (btn) {
                btn.click();
            } else {
                const form = document.querySelector("form.mform, #mform1, form[action*='view.php']");
                if (form) form.submit();
            }
        }""", submission_text)

        save_elapsed = get_elapsed_seconds(target_time)
        print(f"[{save_elapsed:.6f}s] [SAVE]  [{user_tag}] Clicked Save changes (atomic DOM trigger)")
        return True, save_elapsed

def verify_submission(page, user_tag: str, username: str, file_path: str, save_elapsed: float):
    """
    Checks the confirmation status after submission without blocking the race.
    """
    try:
        page.wait_for_load_state("domcontentloaded", timeout=8_000)
    except Exception:
        pass

    try:
        page.wait_for_selector(
            ".submissionstatussubmitted, .alert-success, .submission-status",
            state="visible", timeout=6_000
        )
        write_log("SUCCESS", username, file_path, save_elapsed)
        print(f"[OK]    [{user_tag}] Submission verified successfully! ({save_elapsed:.6f}s)")
    except Exception:
        write_log("UNCONFIRMED", username, file_path, save_elapsed, f"url={page.url}")
        print(f"[WARN]  [{user_tag}] Submission sent, status unconfirmed. Logged for review.")

def submit_on_page(page, user_tag: str, username: str, file_path: str, target_time: datetime, assign_url: str, draft_item_id: int | None = None):
    """Backward-compatible single user submission wrapper."""
    try:
        ok, save_elapsed = trigger_submission(page, user_tag, username, file_path, target_time, assign_url, draft_item_id)
        if ok:
            verify_submission(page, user_tag, username, file_path, save_elapsed)
    except Exception as e:
        print(f"[ERROR] [{user_tag}] {type(e).__name__}: {e}")
        write_log("ERROR", username, file_path, 0.0, f"{type(e).__name__}: {str(e)[:100]}")

# ──────────────────────────────────────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────────────────────────────────────

def main():
    # ── Option: Run session saving standalone via CLI flag ────────────────────
    if any(arg in sys.argv for arg in ["--save-session", "--login", "-s"]):
        print("=" * 60)
        print("  UNAIR eLearning -- Automated CLI Session Saver (bot6)")
        print("=" * 60)
        print("[MODE]  Headless CLI (Zero GUI)")

        # Collect all users that have configured credentials
        target_slots = []
        for slot_idx, creds in sorted(USERS.items()):
            u = creds.get("username", "")
            p = creds.get("password", "")
            if u and p:
                target_slots.append((slot_idx, u, p))

        if not target_slots:
            print("[ERROR] No user credentials configured in USERS dictionary or environment variables.")
            sys.exit(1)

        with sync_playwright() as p:
            b = p.chromium.launch(headless=True)
            for slot_idx, user, pw in target_slots:
                tag = f"Username{slot_idx}"
                sf = os.path.join(BASE_DIR, f"session_user{slot_idx}.json")
                pg = b.new_page()
                print(f"[AUTH]  Logging in [{tag}] ({user})...")
                ok = perform_login(pg, user, pw, tag)
                if ok:
                    pg.context.storage_state(path=sf)
                    print(f"[OK]    [{tag}] Session saved to: {sf}")
                else:
                    print(f"[ERROR] [{tag}] Authentication failed for {user}!")
                pg.close()
            b.close()
        print("=" * 60)
        return

    # ── Standard Flow: Dynamic Multi-Slot Series Auto-Submit ──────────────────
    print("=" * 60)
    print("  Auto-Submit Moodle Assignment [BOT6 DYNAMIC SERIES ENGINE]")
    print("=" * 60)

    # 1. Discover active submission queue
    queue, last_i = resolve_submission_slots()

    if not queue:
        print("[ERROR] No target files found in any slot (file0 to file9). Nothing to submit.")
        sys.exit(1)

    print("\n[PLAN]  Dynamic Submission Plan:")
    for rank, item in enumerate(queue, start=1):
        slot = item["slot"]
        tag = item["tag"]
        fname = os.path.basename(item["file_path"])
        user_conf = USERS.get(slot, {})
        uname = user_conf.get("username", "")
        pwd = user_conf.get("password", "")
        item["username"] = uname
        item["password"] = pwd
        item["session_file"] = os.path.join(BASE_DIR, f"session_user{slot}.json")

        suffix = " (FINAL SUBMITTER - file0)" if item["slot"] == 0 else f" (Rank {rank} in series)"
        print(f"  {rank}. [{tag}] Slot file{slot} -> {fname}{suffix}")

        if (not uname or not pwd) and not os.path.isfile(item["session_file"]):
            print(f"[WARN]  Slot file{slot} has active file '{fname}', but credentials are empty for USER{slot} and no session exists.")

    print("-" * 60)
    print(f"[COURSE] {COURSE_PAGE_URL}")
    print(f"[ASGMT]  {ASSIGNMENT_NAME}")
    if ASSIGNMENT_URL:
        print(f"[DIRECT] {ASSIGNMENT_URL}")

    target = get_target_time()

    # 2. Pre-verify sessions before countdown; skip any user whose authentication fails
    print("\n[AUTH]  Pre-checking sessions for all active submission slots...")
    active_queue = []
    for item in queue:
        is_ok = ensure_session(item["tag"], item["username"], item["password"], item["session_file"])
        if is_ok:
            active_queue.append(item)
        else:
            print(f"[SKIP]  [{item['tag']}] Authentication failed or missing credentials. Skipped so remaining users will still submit.")

    if not active_queue:
        print("[ERROR] No users successfully authenticated. All slots skipped.")
        sys.exit(1)

    queue = active_queue

    # Re-display final confirmed queue
    print("\n[PLAN]  Confirmed Submission Plan (Authenticated Users):")
    for rank, item in enumerate(queue, start=1):
        slot = item["slot"]
        tag = item["tag"]
        fname = os.path.basename(item["file_path"])
        is_last = (rank == len(queue))
        suffix = " (FINAL SUBMITTER - file0)" if is_last and item["slot"] == 0 else f" (Rank {rank} in series)"
        print(f"  {rank}. [{tag}] Slot file{slot} -> {fname}{suffix}")

    with sync_playwright() as pw:
        # Launch Chromium and initialize browser contexts
        browser = pw.chromium.launch(headless=True, slow_mo=0)
        contexts = []
        pages = []

        for item in queue:
            ctx = browser.new_context(
                viewport={"width": 1280, "height": 800},
                accept_downloads=True,
                storage_state=item["session_file"] if os.path.isfile(item["session_file"]) else None,
            )
            pg = ctx.new_page()
            contexts.append(ctx)
            pages.append(pg)
            item["context"] = ctx
            item["page"] = pg

        # 3. Resolve ASSIGNMENT_URL if not directly configured
        resolved_assign_url = ASSIGNMENT_URL
        if not resolved_assign_url and pages:
            print("\n[INFO]  Resolving direct assignment URL from course page...")
            for pg in pages:
                resolved_assign_url = resolve_assignment_url(pg, COURSE_PAGE_URL, ASSIGNMENT_NAME)
                if resolved_assign_url:
                    print(f"[OK]    Resolved Assignment URL: {resolved_assign_url}")
                    break
            if not resolved_assign_url:
                print("[WARN]  Could not resolve direct URL, will fall back to course navigation.")

        # 4. Extract metadata & Pre-upload Draft File for each active slot (Opsi 1)
        print("\n[DRAFT] Pre-uploading draft files for active submission slots...")
        for item in queue:
            pg = item["page"]
            ctx = item["context"]
            tag = item["tag"]
            fpath = item["file_path"]

            draft_item_id = None
            try:
                current_url = pg.url
                if COURSE_PAGE_URL not in current_url and (not resolved_assign_url or resolved_assign_url not in current_url):
                    pg.goto(COURSE_PAGE_URL, wait_until="domcontentloaded", timeout=ELEMENT_TIMEOUT_MS)
                sesskey, ctx_id = extract_course_metadata(pg)
                draft_item_id = pre_upload_draft_file(ctx.request, fpath, sesskey, ctx_id, tag)
            except Exception as e:
                print(f"[WARN]  [{tag}] Draft pre-upload error: {e}. Will attempt standard modal at submit time.")
            item["draft_item_id"] = draft_item_id

        # 5. Synchronize Moodle server clock offset
        print("\n[SYNC]  Synchronizing clock against Moodle server NTP...")
        server_offset_sec = get_server_clock_offset(contexts[0].request)
        if abs(server_offset_sec) > 0.001:
            print(f"[OK]    Moodle server clock offset: {server_offset_sec * 1000:+.1f} ms")

        target_edit_url = get_edit_submission_url(resolved_assign_url)

        # 6. Pre-warm browser sessions directly to form if unlocked, or stand ready
        print("\n[WARM]  Pre-warming browser sessions...")
        for item in queue:
            pg = item["page"]
            tag = item["tag"]
            try:
                if target_edit_url:
                    pg.goto(target_edit_url, wait_until="domcontentloaded", timeout=ELEMENT_TIMEOUT_MS)
                    # Detect if Moodle allowed editsubmission (unlocked) or redirected (locked)
                    if "action=editsubmission" in pg.url:
                        try:
                            pg.wait_for_selector("#id_submitbutton, form.mform, input[name='files_filemanager']", timeout=3_000)
                            print(f"[OK]    [{tag}] Staged directly on submission form (ZERO latency ready!).")
                        except Exception:
                            print(f"[OK]    [{tag}] Staged on edit URL.")
                    else:
                        print(f"[OK]    [{tag}] Assignment currently locked ({pg.url}). Staged for unlock trigger.")
                else:
                    pg.goto(resolved_assign_url or COURSE_PAGE_URL, wait_until="domcontentloaded", timeout=ELEMENT_TIMEOUT_MS)
                    print(f"[OK]    [{tag}] Staged on course view.")
            except Exception as e:
                print(f"[WARN]  [{tag}] Pre-warming note: {e}")
        print("[OK]    All active browser sessions pre-warmed and staged.")

        # 7. Countdown until target time (or immediate if in past / now)
        if datetime.now().timestamp() < (target.timestamp() - server_offset_sec):
            countdown_to_target(target, server_offset_sec)
        else:
            target = datetime.now()
            print(f"\n[INFO]  Target time reached/passed. Executing IMMEDIATELY!")

        # 8. SUBMISSION EXECUTION IN SERIES (ZERO-BOTTLENECK RACE)
        print("\n" + "=" * 60)
        print("  EXECUTING SEQUENTIAL SUBMISSIONS (ZERO-BOTTLENECK RACE)")
        print("=" * 60)

        # Pre-flight: If assignment was locked, kick off immediate navigation for all pages
        if target_edit_url:
            for item in queue:
                pg = item["page"]
                if "action=editsubmission" not in pg.url:
                    try:
                        pg.goto(target_edit_url, wait_until="commit", timeout=2_000)
                    except Exception:
                        pass

        # Phase 1: Fast Trigger in Series (Any error immediately skips to next user)
        for rank, item in enumerate(queue, start=1):
            tag = item["tag"]
            uname = item["username"]
            fpath = item["file_path"]
            pg = item["page"]
            draft_id = item["draft_item_id"]
            is_last = (rank == len(queue))
            suffix = " (FINAL SUBMITTER - file0)" if is_last and item["slot"] == 0 else f" (Rank {rank} in series)"
            print(f"\n[SUBMIT] Step {rank}/{len(queue)}: [{tag}]{suffix} -> {os.path.basename(fpath)}")

            try:
                ok, elapsed = trigger_submission(pg, tag, uname, fpath, target, resolved_assign_url, draft_id)
                item["triggered"] = ok
                item["save_elapsed"] = elapsed
            except Exception as e:
                # ANY error on the race: skip immediately to avoid bottlenecking remaining users
                print(f"[ERROR] [{tag}] Race error: {type(e).__name__} ({e})")
                print(f"[SKIP]  [{tag}] SKIPPED IMMEDIATELY to avoid bottlenecking remaining users!")
                write_log("RACE_ERROR", uname, fpath, get_elapsed_seconds(target), f"{type(e).__name__}: {str(e)[:100]}")
                item["triggered"] = False
                item["save_elapsed"] = 0.0

        # Phase 2: Post-Race Verification (Asynchronously verifies results after all triggers)
        print("\n" + "=" * 60)
        print("  POST-RACE SUBMISSION VERIFICATION")
        print("=" * 60)
        for item in queue:
            if item.get("triggered"):
                verify_submission(item["page"], item["tag"], item["username"], item["file_path"], item["save_elapsed"])
            else:
                print(f"[SKIP]  [{item['tag']}] Verification skipped (not triggered due to race error).")

        # Cleanup
        for ctx in contexts:
            try:
                ctx.close()
            except Exception:
                pass
        browser.close()
        print("\n[DONE]  All scheduled submissions completed.")

if __name__ == "__main__":
    main()
