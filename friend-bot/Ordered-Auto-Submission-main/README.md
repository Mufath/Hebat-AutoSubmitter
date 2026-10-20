# Bot6: Multi-Slot Sequential Auto-Submit Engine (UNAIR Moodle)

Engine with high-speed submission methods ported from `bot4`, featuring a dynamic slot-queue scanning algorithm supporting `file0` through `file9`.

---

## 🚀 Key Features Ported from Bot4

1. **Opsi 1 Pre-Unlock Draft Upload:**
   - Pre-uploads assignment files to Moodle's server-side draft area (`repository_ajax.php?action=upload`) *before* the countdown ends.
   - Eliminates file transfer upload latency at `T = 0`.
2. **Microsecond Draft Injection:**
   - Injects the pre-uploaded draft item ID directly into `input[name='files_filemanager']`.
   - Triggers `Save changes` in under 100 ms per user.
3. **NTP Server Clock Synchronization:**
   - Measures Moodle server time skew down to millisecond accuracy via HTTP `Date` headers and compensates target trigger timing.
4. **Three-Pages Skip & 303 Redirect Resilience:**
   - Staged directly on `action=editsubmission`, bypassing heavy course pages.
   - Micro-polling loop re-targets direct edit URL if temporarily redirected due to time-lock.
5. **Headless CLI Authentication:**
   - Zero GUI, fully headless Chromium automation.
   - Pre-authenticates and persists session state to `session_user{idx}.json`.
6. **Fault-Tolerant Multi-User Authentication:**
   - If authentication fails for a given user (missing/invalid credentials or expired session that fails refresh), the bot automatically skips that user and proceeds with all remaining authenticated users.
7. **Zero-Bottleneck Race Error Skipping:**
   - During the post-countdown submission race, each user's trigger executes with aggressive millisecond timeouts (`RACE_TIMEOUT_MS = 3000`).
   - If ANY error occurs on a user (timeout, element failure, network disconnect, or page crash), the bot immediately skips that user with zero delay and proceeds to the next user, ensuring an error on an earlier user never bottlenecks the remaining user(s).
   - Post-race verification runs asynchronously after all users in the series have triggered their submissions.
8. **Atomic DOM Trigger & Locked/Unlocked Adaptive Staging:**
   - **Unlocked Staging:** If the assignment is already open, the browser stages directly on the submission form without navigating away, executing at $T=0$ in under $50\text{ ms}$.
   - **Locked Staging:** If time-locked, the bot stages on the overview view, triggers fast pre-flight navigation at $T=0$, and handles server clock skew with micro-polling.
   - **Atomic DOM Click:** Bypasses Playwright's $670\text{ ms}$ CDP actionability check lag by evaluating a native JavaScript `btn.click()` directly in the browser's V8 engine ($10\text{–}25\text{ ms}$).

---

## 📐 Dynamic Slot Queue Algorithm

- **Folders `file1` through `file9` can be empty.**
- **The Algorithm:**
  1. Scans `file1` to `file9` to identify $file_i$, which is the last folder (highest index $\le 9$) containing a PDF file.
  2. Scans `file1` to $file_i$. If an intermediate folder is empty, it is safely skipped.
  3. All populated folders in $[file_1 \dots file_i]$ are queued in ascending order.
  4. **`file0` is appended strictly at the end** of the submission queue.
- **Submission Order:**
  $$\text{Order} = [file_1, \dots, file_i] \longrightarrow file_0$$
  `file0` **is strictly the last to submit**.

---

## 📂 Directory Structure

```text
bot6/
├── auto_submit.py          # Main execution engine
├── submissions.log         # Detailed timestamped submission audit log
├── session_user0.json      # Session state for User 0 (file0)
├── session_user1.json      # Session state for User 1 (file1)
├── .env.example            # Environment variables configuration template
├── file0/                  # Required: Contains PDF for User 0 (Submits LAST)
├── file1/                  # Optional: Contains PDF for User 1 (Submits FIRST)
├── file2/                  # Optional: Contains PDF for User 2
├── ...
└── file9/                  # Optional: Contains PDF for User 9
```

---

## ⚙️ Configuration

Credentials and settings can be adjusted directly in `auto_submit.py` or via an optional `.env` file:

```env
COURSE_PAGE_URL=https://hebat.elearning.unair.ac.id/course/view.php?id=10988
ASSIGNMENT_NAME=Pengumpulan Modul Prak Lab 11 NDG Linux Essential

# Target schedule (Local Time)
TARGET_YEAR=2026
TARGET_MONTH=10
TARGET_DAY=20
TARGET_HOUR=7
TARGET_MINUTE=0
TARGET_SECOND=0

# User credentials
MOODLE_USER0=your_nim_user0
MOODLE_PASS0=your_password_user0

MOODLE_USER1=your_nim_user1
MOODLE_PASS1=your_password_user1
```

---

## 🏃 Running the Bot

### 1. Pre-authenticate / Refresh Sessions
```bash
python auto_submit.py --login
```
*(or `--save-session` / `-s`)*

### 2. Run Auto-Submission
```bash
python auto_submit.py
```
*(or `py auto_submit.py`)*
