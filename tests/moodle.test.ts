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
  parseAssignments,
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

  it('should parse available from date string', () => {
    const text = 'Available from 14 October 2026, 7:00 AM';
    const parsed = parseAvailableFrom(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.text).toBe(text);
    expect(parsed?.epochMs).toBeDefined();
    expect(parsed?.epochMs).toBe(Date.parse('14 October 2026, 7:00 AM'));
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

