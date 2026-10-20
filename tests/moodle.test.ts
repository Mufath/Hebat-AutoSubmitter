/**
 * tests/moodle.test.ts
 * Vitest unit tests for pure parser functions, CookieJar, and Budget.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseLoginToken,
  parseSesskey,
  parseCourseContextId,
  parseUserId,
  parseAvailableFrom,
  parseAvailableUntil,
  parseDueDate,
  cleanCourseName,
  parseEnrolledCourses,
  parseAssignments,
  parseAssignmentsOverview,
  mergeAssignmentsWithOverview,
  parseEditSubmissionForm,
  parseSubmissionStatus,
} from '../src/moodle/parse';
import { CookieJar, Budget } from '../src/moodle/http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

describe('Moodle HTML Parser', () => {
  it('should parse logintoken from login HTML', () => {
    const html = readFixture('login.html');
    const token = parseLoginToken(html);
    expect(token).toBe('testLoginToken123456789');
  });

  it('should parse sesskey from M.cfg and input', () => {
    const courseHtml = readFixture('course.html');
    expect(parseSesskey(courseHtml)).toBe('testSesskey987654321');

    const formHtml = readFixture('editsubmission.html');
    expect(parseSesskey(formHtml)).toBe('testSesskey987654321');
  });

  it('should parse course context ID and user ID', () => {
    const html = readFixture('course.html');
    expect(parseCourseContextId(html)).toBe('288276');
    expect(parseUserId(html)).toBe('12345');
  });

  it('should parse available from date string including Moodle 4.5 strong tags', () => {
    const text = 'Available from <strong>21 October 2026, 7:00 AM</strong>';
    const parsed = parseAvailableFrom(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.text).toBe('Available from 21 October 2026, 7:00 AM');
    expect(parsed?.epochMs).toBeDefined();
  });

  it('should parse available until end of date string', () => {
    const text = 'Available until end of <strong>15 October 2026</strong>';
    const parsed = parseAvailableUntil(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.text).toBe('Available until end of 15 October 2026');
    expect(parsed?.epochMs).toBeDefined();
  });

  it('should parse due date string correctly including Indonesian format', () => {
    const text = 'Due date: 22 October 2026, 23:59';
    const parsed = parseDueDate(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.epochMs).toBeDefined();

    const indoText = 'terakhir dikumpulkan pada hari Minggu, 31 Agustus pukul 23.59';
    const parsedIndo = parseDueDate(indoText);
    expect(parsedIndo).not.toBeNull();
    expect(parsedIndo?.epochMs).toBeDefined();
  });

  it('should clean UNAIR Moodle course names nicely', () => {
    const raw = '2026Ganjil - FST25605020 - Matriks &amp; Transformasi Linier - S1 - Sistem Informasi - 2025 - I2';
    expect(cleanCourseName(raw)).toBe('Matriks & Transformasi Linier (I2)');
  });

  it('should parse enrolled courses from dashboard HTML', () => {
    const html = `
      <div class="courses">
        <a href="https://hebat.elearning.unair.ac.id/course/view.php?id=10978">Sistem Operasi (Praktikum)</a>
        <a href="https://hebat.elearning.unair.ac.id/course/view.php?id=10852">Algoritma & Pemrograman</a>
      </div>
    `;
    const courses = parseEnrolledCourses(html);
    expect(courses).toHaveLength(2);
    expect(courses[0].id).toBe('10978');
    expect(courses[0].name).toBe('Sistem Operasi (Praktikum)');
    expect(courses[1].id).toBe('10852');
  });

  it('should parse Moodle 4.5 overview table and merge accurate assignment statuses', () => {
    const overviewHtml = `
      <tr data-mdl-overview-cmid="108564" data-region="overview-item">
        <td data-mdl-overview-item="name" data-mdl-overview-value="Tugas 1 - Minggu 2">
          <a href="https://hebat.elearning.unair.ac.id/mod/assign/view.php?id=108564">Tugas 1 - Minggu 2</a>
        </td>
        <td data-mdl-overview-item="duedate" data-mdl-overview-value="1700000000">15 Nov 2023</td>
        <td data-mdl-overview-item="submissionstatus" data-mdl-overview-value="Submitted for grading">Submitted for grading</td>
      </tr>
      <tr data-mdl-overview-cmid="169672" data-region="overview-item">
        <td data-mdl-overview-item="name" data-mdl-overview-value="Tugas 6 - Minggu 7">
          <a href="https://hebat.elearning.unair.ac.id/mod/assign/view.php?id=169672">Tugas 6 - Minggu 7</a>
        </td>
        <td data-mdl-overview-item="duedate" data-mdl-overview-value="1700000000">15 Nov 2023</td>
        <td data-mdl-overview-item="submissionstatus" data-mdl-overview-value="No submission">No submission</td>
      </tr>
    `;
    const overviewRows = parseAssignmentsOverview(overviewHtml);
    expect(overviewRows).toHaveLength(2);
    expect(overviewRows[0].cmid).toBe('108564');
    expect(overviewRows[0].submissionStatus).toBe('Submitted for grading');

    const baseAssignments = [
      {
        cmid: '108564',
        name: 'Tugas 1 - Minggu 2',
        url: 'https://hebat.elearning.unair.ac.id/mod/assign/view.php?id=108564',
        isAvailable: true,
        status: 'OPEN' as const,
      },
      {
        cmid: '169672',
        name: 'Tugas 6 - Minggu 7',
        url: 'https://hebat.elearning.unair.ac.id/mod/assign/view.php?id=169672',
        isAvailable: true,
        status: 'OPEN' as const,
      },
    ];

    const merged = mergeAssignmentsWithOverview(baseAssignments, overviewRows);
    expect(merged[0].status).toBe('SUBMITTED');
    expect(merged[1].status).toBe('OVERDUE');
  });

  it('should parse list of assignments from course HTML', () => {
    const html = readFixture('course.html');
    const assignments = parseAssignments(html);
    expect(assignments).toHaveLength(2);

    expect(assignments[0].cmid).toBe('101761');
    expect(assignments[0].name).toContain('Pengumpulan Modul Prak Lab 10');
    expect(assignments[0].isAvailable).toBe(false);
    expect(assignments[0].availableFromText).toBe('Available from 14 October 2026, 7:00 AM');

    expect(assignments[1].cmid).toBe('167430');
    expect(assignments[1].name).toBe('Tugas 2 - BPR - Kelompok');
    expect(assignments[1].isAvailable).toBe(true);
  });

  it('should parse submission form hidden fields accurately', () => {
    const html = readFixture('editsubmission.html');
    const fields = parseEditSubmissionForm(html);
    expect(fields).not.toBeNull();
    expect(fields?.lastmodified).toBe('1791912170');
    expect(fields?.id).toBe('167430');
    expect(fields?.userid).toBe('99999');
    expect(fields?.action).toBe('savesubmission');
    expect(fields?.sesskey).toBe('testSesskey987654321');
    expect(fields?._qf__mod_assign_submission_form).toBe('1');
    expect(fields?.mform_isexpanded_id_submissionheader).toBe('1');
    expect(fields?.files_filemanager).toBe('505205942');
  });

  it('should parse submission status and file name', () => {
    const html = readFixture('assign_view_submitted.html');
    const status = parseSubmissionStatus(html);
    expect(status.isSubmitted).toBe(true);
    expect(status.isDraft).toBe(false);
    expect(status.statusText).toBe('Submitted for grading');
    expect(status.fileName).toBe('modul_test_autosubmit.pdf');
  });

  it('should execute parsing within 5ms CPU budget', () => {
    const html = readFixture('editsubmission.html');
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) {
      parseEditSubmissionForm(html);
    }
    const elapsed = performance.now() - t0;
    // 50 parse iterations must complete in under 50ms (average < 1ms)
    expect(elapsed).toBeLessThan(50);
  });
});

describe('CookieJar', () => {
  it('should store and format cookies', () => {
    const jar = new CookieJar();
    const res = new Response(null, {
      headers: {
        'Set-Cookie': 'MoodleSession=abc123xyz; path=/; HttpOnly',
      },
    });

    jar.ingest(res);
    expect(jar.has('MoodleSession')).toBe(true);
    expect(jar.get('MoodleSession')).toBe('abc123xyz');
    expect(jar.header()).toBe('MoodleSession=abc123xyz');
  });

  it('should remove expired cookies', () => {
    const jar = new CookieJar();
    const res1 = new Response(null, {
      headers: { 'Set-Cookie': 'test=val1; path=/' },
    });
    jar.ingest(res1);
    expect(jar.get('test')).toBe('val1');

    const res2 = new Response(null, {
      headers: { 'Set-Cookie': 'test=deleted; max-age=0' },
    });
    jar.ingest(res2);
    expect(jar.has('test')).toBe(false);
  });

  it('should serialize and restore state', () => {
    const jar = new CookieJar();
    const res = new Response(null, {
      headers: { 'Set-Cookie': 'MoodleSession=secret_sess' },
    });
    jar.ingest(res);

    const dumped = jar.dump();
    const restored = CookieJar.load(dumped);
    expect(restored.get('MoodleSession')).toBe('secret_sess');
  });
});

describe('Budget', () => {
  it('should track subrequest usage and enforce limits', () => {
    const budget = new Budget(10);
    expect(budget.remaining).toBe(10);
    budget.take(3);
    expect(budget.remaining).toBe(7);
    budget.take(7);
    expect(budget.remaining).toBe(0);
    expect(() => budget.take(1)).toThrow('SUBREQUEST_BUDGET_EXCEEDED');
  });
});

import { SO_PRACTICAL_SCHEDULE, getActivePracticalSchedule } from '../src/schedule';

describe('SO Practical Schedule Mapping', () => {
  it('should contain all 7 weeks from Week 8 to Week 14', () => {
    expect(SO_PRACTICAL_SCHEDULE).toHaveLength(7);
    expect(SO_PRACTICAL_SCHEDULE[0].week).toBe(8);
    expect(SO_PRACTICAL_SCHEDULE[0].sectionId).toBe('75330');
    expect(SO_PRACTICAL_SCHEDULE[0].assignmentName).toContain('Modul Prak Lab 10');

    expect(SO_PRACTICAL_SCHEDULE[6].week).toBe(14);
    expect(SO_PRACTICAL_SCHEDULE[6].sectionId).toBe('75336');
    expect(SO_PRACTICAL_SCHEDULE[6].assignmentName).toContain('Challenge Lab. C dan D');
  });

  it('should accurately resolve Week 8 for 14 October 2026 morning', () => {
    const oct14Morning = new Date('2026-10-14T02:00:00+07:00').getTime();
    const active = getActivePracticalSchedule(oct14Morning);
    expect(active.week).toBe(8);
    expect(active.sectionId).toBe('75330');
    expect(active.assignmentName).toBe('Pengumpulan Modul Prak Lab 10 NDG Linux Essential');
  });

  it('should accurately resolve Week 9 for 20 October 2026', () => {
    const oct20 = new Date('2026-10-20T12:00:00+07:00').getTime();
    const active = getActivePracticalSchedule(oct20);
    expect(active.week).toBe(9);
    expect(active.sectionId).toBe('75331');
    expect(active.assignmentName).toBe('Pengumpulan Modul Prak Lab 11 NDG Linux Essential');
  });
});

import { vi } from 'vitest';
import { sampleServerOffset, warmUpConnection } from '../src/time';
import {
  checkAssignmentLock,
  checkAssignmentLockWave,
  submitAssignment,
  buildStaticSubmissionPrefix,
} from '../src/moodle/submit';

describe('Clock Sync & Pure Submit Timing', () => {
  it('should detect HTTP Date second boundary without ±500ms midpoint skew', async () => {
    // True server offset is +180ms, and local clock starts at xx:xx:00.780
    // Probe 0: local=1000780 -> server=1000960 -> Date header=1000000 (1s floored)
    // Probe 1: local=1000890 -> server=1001070 -> Date header=1001000 (ticked over!)
    let call = 0;
    const baseSec = 1792324800000; // exact second boundary
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      // Each probe calls Date.now() 4 times (t0 in sampleServerOffset, t0 in mfetch, elapsedMs in mfetch, t1 in sampleServerOffset)
      const probeIdx = Math.floor(call / 4);
      const stepInProbe = call % 4;
      call++;
      const startMs = baseSec + 780 + probeIdx * 110;
      return stepInProbe === 0 || stepInProbe === 1 ? startMs : startMs + 10;
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const probeIdx = Math.floor((call - 1) / 4);
      const localMid = baseSec + 785 + probeIdx * 110;
      const trueServerTime = localMid + 180; // true offset = +180ms
      const flooredServerSec = Math.floor(trueServerTime / 1000) * 1000;
      return new Response(null, {
        status: 200,
        headers: { date: new Date(flooredServerSec).toUTCString() },
      });
    });

    try {
      const jar = new CookieJar();
      const bud = new Budget(48);
      const offset = await sampleServerOffset(jar, bud, 'https://hebat.elearning.unair.ac.id', 9, 0);

      // Transition occurred between localMid=785 (serverMs=0) and localMid=895 (serverMs=1000)
      // Midpoint estimate = 1000 - (785 + 895)/2 = +160ms (within 20ms of true +180ms, and only used 2 subrequests!)
      expect(Math.abs(offset - 180)).toBeLessThanOrEqual(55);
      expect(48 - bud.remaining).toBe(2);
    } finally {
      nowSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  it('should check assignment lock in 1 subrequest when locked and extract formFields directly when unlocked', async () => {
    const formHtml = readFixture('editsubmission.html');
    let isLocked = true;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      if (isLocked) {
        return new Response(null, {
          status: 303,
          headers: { location: 'https://hebat.elearning.unair.ac.id/course/view.php?id=10978' },
        });
      }
      return new Response(formHtml, { status: 200 });
    });

    try {
      const jar = new CookieJar();
      const bud = new Budget(48);

      // 1. Locked poll uses only 1 subrequest (does not download course/view.php)
      const lockedRes = await checkAssignmentLock(jar, bud, 'https://hebat.elearning.unair.ac.id', '167430');
      expect(lockedRes.isLocked).toBe(true);
      expect(48 - bud.remaining).toBe(1);

      // 2. Unlocked poll extracts formFields immediately in 1 subrequest
      isLocked = false;
      const unlockedRes = await checkAssignmentLock(jar, bud, 'https://hebat.elearning.unair.ac.id', '167430');
      expect(unlockedRes.isLocked).toBe(false);
      expect(unlockedRes.formFields).not.toBeNull();
      expect(unlockedRes.formFields?.sesskey).toBe('testSesskey987654321');
      expect(48 - bud.remaining).toBe(2);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('should measure pure POST submission time (tPostMs) separately from verification GET (tVerifyMs)', async () => {
    const submittedHtml = readFixture('assign_view_submitted.html');
    const formFields = parseEditSubmissionForm(readFixture('editsubmission.html'))!;
    const preBuiltPrefix = buildStaticSubmissionPrefix('167430', 505205942);
    let capturedBody = '';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') {
        capturedBody = String(init.body || '');
        await new Promise(r => setTimeout(r, 35));
        return new Response(null, {
          status: 303,
          headers: { location: 'https://hebat.elearning.unair.ac.id/mod/assign/view.php?id=167430' },
        });
      }
      await new Promise(r => setTimeout(r, 65));
      return new Response(submittedHtml, { status: 200 });
    });

    try {
      const jar = new CookieJar();
      const bud = new Budget(48);
      const res = await submitAssignment(
        jar,
        bud,
        'https://hebat.elearning.unair.ac.id',
        '167430',
        formFields,
        505205942,
        false,
        preBuiltPrefix
      );

      expect(res.ok).toBe(true);
      expect(capturedBody).toContain('id=167430&action=savesubmission');
      expect(capturedBody).toContain('files_filemanager=505205942');
      expect(capturedBody).toContain('sesskey=testSesskey987654321');
      // Only 2 subrequests used (1 POST + 1 GET verification), NOT 3!
      expect(48 - bud.remaining).toBe(2);
      // tPostMs only includes the ~35ms POST, not the ~65ms verification GET
      expect(res.tPostMs).toBeGreaterThanOrEqual(25);
      expect(res.tPostMs).toBeLessThan(80);
      expect(res.tVerifyMs).toBeGreaterThanOrEqual(50);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('should warm up TCP/TLS connection in 1 subrequest and return measured RTT', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 30));
      return new Response(null, { status: 200 });
    });

    try {
      const jar = new CookieJar();
      const bud = new Budget(48);
      const rtt = await warmUpConnection(jar, bud, 'https://hebat.elearning.unair.ac.id');
      expect(48 - bud.remaining).toBe(1);
      expect(rtt).toBeGreaterThanOrEqual(20);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('should resolve checkAssignmentLockWave immediately when Shot #2 catches unlock even if Shot #1 arrived early and is slow', async () => {
    const formHtml = readFixture('editsubmission.html');
    let shotIndex = 0;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const myShot = ++shotIndex;
      if (myShot === 1) {
        // Shot #1 arrived 10ms early (locked) and takes 250ms to return
        await new Promise(r => setTimeout(r, 250));
        return new Response(null, {
          status: 303,
          headers: { location: 'https://hebat.elearning.unair.ac.id/course/view.php?id=10978' },
        });
      }
      // Shot #2 (launched at +35ms) arrives after 07:00:00.000 (unlocked!) and finishes in 40ms
      await new Promise(r => setTimeout(r, 40));
      return new Response(formHtml, { status: 200 });
    });

    try {
      const jar = new CookieJar();
      const bud = new Budget(48);
      const t0 = Date.now();
      const res = await checkAssignmentLockWave(
        jar,
        bud,
        'https://hebat.elearning.unair.ac.id',
        '167430',
        [0, 35, 90]
      );
      const elapsed = Date.now() - t0;

      expect(res.isLocked).toBe(false);
      expect(res.formFields?.sesskey).toBe('testSesskey987654321');
      // Resolved at ~75ms (35ms stagger + 40ms RTT) instead of waiting 250ms for Shot #1 + 40ms for Shot #2 (290ms)!
      expect(elapsed).toBeLessThan(160);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});



