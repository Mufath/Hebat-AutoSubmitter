/**
 * src/moodle/parse.ts
 * Pure parser functions for Moodle HTML responses.
 * Designed to execute well within Cloudflare Workers' 10ms CPU limit.
 */

import type { DiscoveredAssignment, MoodleCourse, SubmissionFormFields, SubmissionStatus } from './types';

/**
 * Extracts the logintoken hidden field value from the Moodle login page.
 */
export function parseLoginToken(html: string): string | null {
  const tagMatch = html.match(/<input[^>]+name=["']logintoken["'][^>]*>/i);
  if (tagMatch) {
    const valMatch = tagMatch[0].match(/value=["']([a-zA-Z0-9]+)["']/i);
    if (valMatch) return valMatch[1];
  }
  return null;
}

/**
 * Extracts the sesskey from Moodle JavaScript config or form inputs.
 */
export function parseSesskey(html: string): string | null {
  const cfgMatch = html.match(/["']?sesskey["']?\s*:\s*["']([a-zA-Z0-9]+)["']/i);
  if (cfgMatch) return cfgMatch[1];

  const tagMatch = html.match(/<input[^>]+name=["']sesskey["'][^>]*>/i);
  if (tagMatch) {
    const valMatch = tagMatch[0].match(/value=["']([a-zA-Z0-9]+)["']/i);
    if (valMatch) return valMatch[1];
  }
  return null;
}

/**
 * Extracts the Course Context ID from M.cfg or DOM data attributes.
 */
export function parseCourseContextId(html: string): string | null {
  const cfgMatch = html.match(/["']?contextid["']?\s*:\s*["']?(\d+)["']?/i) ||
                   html.match(/data-contextid=["'](\d+)["']/i);
  return cfgMatch ? cfgMatch[1] : null;
}

/**
 * Extracts current logged-in user ID from M.cfg or DOM data attributes.
 */
export function parseUserId(html: string): string | null {
  const cfgMatch = html.match(/["']?userId["']?\s*:\s*["']?([1-9]\d*)["']?/i) ||
                   html.match(/data-user-id=["']([1-9]\d*)["']/i);
  return cfgMatch ? cfgMatch[1] : null;
}

const ID_MONTHS_MAP: Record<string, string> = {
  januari: 'January',
  februari: 'February',
  maret: 'March',
  april: 'April',
  mei: 'May',
  juni: 'June',
  juli: 'July',
  agustus: 'August',
  september: 'September',
  oktober: 'October',
  november: 'November',
  desember: 'December',
  agu: 'Aug',
  agt: 'Aug',
  okt: 'Oct',
  des: 'Dec',
};

export function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&ndash;/gi, '–');
}

export function cleanCourseName(rawName: string): string {
  let s = decodeHtmlEntities(rawName).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  // Format UNAIR standard fullname: "2026Ganjil - FST25605020 - Matriks & Transformasi Linier - S1 - Sistem Informasi - 2025 - I2"
  const parts = s.split(' - ').map(p => p.trim());
  if (parts.length >= 4 && /^\d{4}(?:Ganjil|Genap)/i.test(parts[0])) {
    const courseTitle = parts[2];
    const classCode = parts[parts.length - 1];
    if (courseTitle && classCode && classCode.length <= 6) {
      return `${courseTitle} (${classCode})`;
    }
    if (courseTitle) return courseTitle;
  }
  return s;
}

function parseDateStringMs(rawDateStr: string): number | undefined {
  let norm = rawDateStr
    .replace(/(?:pukul|pkl\.?)\s*(\d{1,2})[.:](\d{2})/i, '$1:$2')
    .replace(/(\d{1,2})\.(\d{2})(?:\s*WIB)?$/i, '$1:$2')
    .replace(/\s*WIB\b/i, '')
    .trim();

  for (const [id, en] of Object.entries(ID_MONTHS_MAP)) {
    norm = norm.replace(new RegExp(`\\b${id}\\b`, 'gi'), en);
  }

  const m = norm.match(/(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?(?:[\s,]+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?)?/i);
  if (m) {
    const [, day, month, yearRaw, hh, mm, ampm] = m;
    const year = yearRaw || String(new Date().getFullYear());
    let timePart = '23:59:00';
    if (hh !== undefined && mm !== undefined) {
      let h = parseInt(hh, 10);
      const min = parseInt(mm, 10);
      if (ampm) {
        if (ampm.toUpperCase() === 'PM' && h < 12) h += 12;
        if (ampm.toUpperCase() === 'AM' && h === 12) h = 0;
      }
      timePart = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
    }
    const d2 = Date.parse(`${day} ${month} ${year} ${timePart} GMT+0700`);
    if (!isNaN(d2)) return d2;
  }

  const direct = Date.parse(norm);
  return isNaN(direct) ? undefined : direct;
}

/**
 * Parses the "Available from ..." availability restriction text to epoch ms.
 * Handles inline HTML tags like <strong> inside Moodle 4.x availability blocks.
 */
export function parseAvailableFrom(text: string): { text: string; epochMs?: number } | null {
  const plain = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const match = plain.match(/(?:Available from|Dibuka mulai(?: dari)?|Tersedia dari)\s+([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4}(?:,\s*[0-9]{1,2}:[0-9]{2}(?:\s*(?:AM|PM))?)?)/i);
  if (!match) return null;

  const rawDateStr = match[1].trim();
  const parsedTime = parseDateStringMs(rawDateStr);
  return {
    text: match[0].replace(/\s+/g, ' ').trim(),
    epochMs: parsedTime,
  };
}

/**
 * Parses the "Available until ..." availability restriction text to epoch ms.
 */
export function parseAvailableUntil(text: string): { text: string; epochMs?: number } | null {
  const plain = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const match = plain.match(/(?:Available until(?: end of)?|Tersedia sampai(?: akhir)?)\s+([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4}(?:,\s*[0-9]{1,2}:[0-9]{2}(?:\s*(?:AM|PM))?)?)/i);
  if (!match) return null;

  const rawDateStr = match[1].trim();
  const parsedTime = parseDateStringMs(rawDateStr);
  return {
    text: match[0].replace(/\s+/g, ' ').trim(),
    epochMs: parsedTime,
  };
}

/**
 * Parses the "Due date: ..." or Indonesian deadline text to epoch ms.
 */
export function parseDueDate(text: string): { text: string; epochMs?: number } | null {
  const plain = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const match = plain.match(
    /(?:Due date|Batas waktu|Jatuh tempo|Batas pengumpulan|terakhir dikumpulkan pada(?: hari)?|paling lambat)[:\s]+(?:[A-Za-z]+\s*,\s*)?([0-9]{1,2}\s+[A-Za-z]+(?:\s+[0-9]{4})?(?:(?:,|\s+pukul|\s+pkl\.?)?\s*[0-9]{1,2}[.:][0-9]{2}(?:\s*(?:AM|PM|WIB))?)?)/i
  );
  if (!match) return null;

  const rawDateStr = match[1].trim();
  const parsedTime = parseDateStringMs(rawDateStr);
  return {
    text: rawDateStr,
    epochMs: parsedTime,
  };
}

/**
 * Extracts enrolled course list from /my/courses.php or /my/ dashboard HTML.
 */
export function parseEnrolledCourses(html: string): MoodleCourse[] {
  const courses: MoodleCourse[] = [];
  const seenIds = new Set<string>();

  const courseRegex = /<a[^>]+href=["'][^"']*\/course\/view\.php\?id=(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = courseRegex.exec(html)) !== null) {
    const id = match[1];
    if (seenIds.has(id)) continue;

    let name = match[2]
      .replace(/<span[^>]*class=["'][^"']*accesshide[^"']*["'][\s\S]*?<\/span>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    name = cleanCourseName(name);

    if (!name || name.length < 3 || name.toLowerCase() === 'home' || name.toLowerCase() === 'dashboard' || name.toLowerCase().startsWith('course')) {
      continue;
    }

    seenIds.add(id);
    courses.push({ id, name });
  }

  return courses;
}

/**
 * Extracts all assignment activities from course or section HTML.
 */
export function parseAssignments(html: string): DiscoveredAssignment[] {
  const assignments: DiscoveredAssignment[] = [];
  const lowerHtml = html.toLowerCase();
  if (!lowerHtml.includes('module-') && !lowerHtml.includes('mod/assign/view.php')) {
    return assignments;
  }

  const liRegex = /<li[^>]+id=["']module-(\d+)["'][^>]*>([\s\S]*?)<\/li>/gi;
  let match: RegExpExecArray | null;

  while ((match = liRegex.exec(html)) !== null) {
    const cmid = match[1];
    const inner = match[2];

    const isAssign = inner.includes('modtype_assign') || match[0].includes('modtype_assign') || inner.includes('/mod/assign/view.php');
    if (!isAssign) continue;

    // Extract assignment name from data-activityname or instancename
    const dataNameMatch = inner.match(/data-activityname=["']([^"']+)["']/i);
    const cleanedInner = inner.replace(/<span[^>]*class=["'][^"']*accesshide[^"']*["'][\s\S]*?<\/span>/gi, '');
    const nameMatch =
      cleanedInner.match(/class=["'][^"']*(?:instancename|activityname)[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div|a)>/i) ||
      cleanedInner.match(/<a[^>]+class=["'][^"']*aal_link[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);

    let name = '';
    if (dataNameMatch && dataNameMatch[1].trim()) {
      name = decodeHtmlEntities(dataNameMatch[1].trim());
    } else if (nameMatch) {
      name = decodeHtmlEntities(nameMatch[1].replace(/<[^>]+>/g, '').trim());
    } else {
      name = `Assignment ${cmid}`;
    }

    const availFrom = parseAvailableFrom(inner);
    const availUntil = parseAvailableUntil(inner);
    const due = parseDueDate(inner);

    const hasLockMarker = inner.includes('isrestricted') || inner.includes('fa-lock');
    const isAvailable = !availFrom && !hasLockMarker;

    let status: 'LOCKED' | 'OPEN' | 'OVERDUE' | 'SUBMITTED' | 'CLOSED' = 'OPEN';
    if (inner.includes('Submitted for grading') || inner.includes('Sudah dikumpulkan') || inner.includes('submissionstatussubmitted')) {
      status = 'SUBMITTED';
    } else if (availFrom && (!availFrom.epochMs || availFrom.epochMs > Date.now())) {
      status = 'LOCKED';
    } else if (availUntil && (!availUntil.epochMs || availUntil.epochMs < Date.now())) {
      status = 'CLOSED';
    } else if (hasLockMarker) {
      status = 'LOCKED';
    } else if (inner.includes('Closed') || inner.includes('Ditutup') || inner.includes('submissionstatusclosed')) {
      status = 'CLOSED';
    } else if ((due?.epochMs && Date.now() > due.epochMs) || inner.includes('Overdue') || inner.includes('Terlambat')) {
      status = 'OVERDUE';
    } else {
      status = 'OPEN';
    }

    assignments.push({
      cmid,
      name,
      url: `/mod/assign/view.php?id=${cmid}`,
      isAvailable,
      availableFromText: availFrom?.text,
      availableFromEpochMs: availFrom?.epochMs,
      availableUntilText: availUntil?.text,
      dueDateText: due?.text || (availUntil ? availUntil.text.replace(/^Available until(?: end of)?\s+/i, '') : undefined),
      dueDateEpochMs: due?.epochMs || availUntil?.epochMs,
      status,
    });
  }

  return assignments;
}

export interface OverviewAssignmentRow {
  cmid: string;
  name: string;
  dueDateEpochMs?: number;
  dueDateText?: string;
  submissionStatus?: string;
}

/**
 * Parses Moodle 4.5+ /course/overview.php?id=<id>&expand[]=assign table rows.
 */
export function parseAssignmentsOverview(html: string): OverviewAssignmentRow[] {
  const rows: OverviewAssignmentRow[] = [];
  if (!html.includes('data-mdl-overview-cmid')) return rows;

  const rowRegex = /<(tr|div)[^>]+data-mdl-overview-cmid=["'](\d+)["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;

  while ((m = rowRegex.exec(html)) !== null) {
    const cmid = m[2];
    const inner = m[3];

    const rawName =
      inner.match(/data-mdl-overview-item=["']name["'][^>]*data-mdl-overview-value=["']([^"']*)["']/i)?.[1] ||
      inner.match(/<a[^>]+href=["'][^"']*\/mod\/assign\/view\.php\?id=\d+["'][^>]*>([\s\S]*?)<\/a>/i)?.[1]?.replace(/<[^>]+>/g, '') ||
      '';
    const dueTsStr =
      inner.match(/data-mdl-overview-item=["']duedate["'][^>]*data-mdl-overview-value=["']([^"']*)["']/i)?.[1] || '';
    const dueCellText = inner
      .match(/data-mdl-overview-item=["']duedate["'][^>]*>([\s\S]*?)<\/(?:td|div)>/i)?.[1]
      ?.replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const subStatus =
      inner.match(/data-mdl-overview-item=["']submissionstatus["'][^>]*data-mdl-overview-value=["']([^"']*)["']/i)?.[1] ||
      inner
        .match(/data-mdl-overview-item=["']submissionstatus["'][^>]*>([\s\S]*?)<\/(?:td|div)>/i)?.[1]
        ?.replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() ||
      '';

    const dueEpochSec = parseInt(dueTsStr, 10);
    const dueDateEpochMs = !isNaN(dueEpochSec) && dueEpochSec > 0 ? dueEpochSec * 1000 : undefined;

    rows.push({
      cmid,
      name: decodeHtmlEntities(rawName.trim()) || `Assignment ${cmid}`,
      dueDateEpochMs,
      dueDateText: dueCellText && dueCellText !== '-' ? decodeHtmlEntities(dueCellText) : undefined,
      submissionStatus: subStatus ? decodeHtmlEntities(subStatus.trim()) : undefined,
    });
  }

  return rows;
}

/**
 * Merges assignments parsed from /course/view.php with status & due dates from /course/overview.php.
 */
export function mergeAssignmentsWithOverview(
  courseAssignments: DiscoveredAssignment[],
  overviewRows: OverviewAssignmentRow[]
): DiscoveredAssignment[] {
  const map = new Map<string, DiscoveredAssignment>();
  for (const a of courseAssignments) {
    map.set(a.cmid, { ...a });
  }

  for (const ov of overviewRows) {
    const existing = map.get(ov.cmid);
    const isSubmitted =
      Boolean(ov.submissionStatus) &&
      (ov.submissionStatus!.toLowerCase().includes('submitted') ||
        ov.submissionStatus!.toLowerCase().includes('dikumpulkan'));

    const dueEpoch = ov.dueDateEpochMs || existing?.dueDateEpochMs;
    const dueText = ov.dueDateText || existing?.dueDateText;

    let status: DiscoveredAssignment['status'] = existing?.status || 'OPEN';
    if (isSubmitted) {
      status = 'SUBMITTED';
    } else if (existing?.status === 'LOCKED' || existing?.status === 'CLOSED') {
      status = existing.status;
    } else if (dueEpoch && Date.now() > dueEpoch) {
      status = 'OVERDUE';
    } else {
      status = 'OPEN';
    }

    if (existing) {
      existing.dueDateEpochMs = dueEpoch;
      existing.dueDateText = dueText;
      existing.submissionStatusText = ov.submissionStatus;
      existing.status = status;
    } else {
      map.set(ov.cmid, {
        cmid: ov.cmid,
        name: ov.name,
        url: `/mod/assign/view.php?id=${ov.cmid}`,
        isAvailable: true,
        dueDateEpochMs: dueEpoch,
        dueDateText: dueText,
        submissionStatusText: ov.submissionStatus,
        status,
      });
    }
  }

  return Array.from(map.values());
}

/**
 * Extracts submission form hidden fields from editsubmission HTML.
 */
export function parseEditSubmissionForm(html: string): SubmissionFormFields | null {
  // Find submission form segment mform1_*
  const formStart = html.indexOf('mform1_');
  let formSegment = html;
  if (formStart !== -1) {
    const segmentStart = html.lastIndexOf('<form', formStart);
    const segmentEnd = html.indexOf('</form>', formStart);
    if (segmentStart !== -1 && segmentEnd !== -1) {
      formSegment = html.slice(segmentStart, segmentEnd + 7);
    }
  }

  const hiddenInputs: Record<string, string> = {};
  const inputRegex = /<input[^>]+type=["']hidden["'][^>]*>/gi;
  let m: RegExpExecArray | null;

  while ((m = inputRegex.exec(formSegment)) !== null) {
    const tag = m[0];
    const nameMatch = tag.match(/name=["']([^"']+)["']/i);
    const valMatch = tag.match(/value=["']([^"']*)["']/i);
    if (nameMatch) {
      hiddenInputs[nameMatch[1]] = valMatch ? valMatch[1] : '';
    }
  }

  if (!hiddenInputs.lastmodified || !hiddenInputs.id || !hiddenInputs.sesskey) {
    return null;
  }

  const {
    lastmodified,
    id,
    userid = '',
    action = 'savesubmission',
    sesskey,
    _qf__mod_assign_submission_form = '1',
    mform_isexpanded_id_submissionheader = '1',
    files_filemanager = '',
    ...extraFields
  } = hiddenInputs;

  return {
    lastmodified,
    id,
    userid,
    action,
    sesskey,
    _qf__mod_assign_submission_form,
    mform_isexpanded_id_submissionheader,
    files_filemanager,
    extraFields,
  };
}

/**
 * Parses the submission status from assignment view HTML.
 */
export function parseSubmissionStatus(html: string): SubmissionStatus {
  const isSubmitted =
    html.includes('Submitted for grading') ||
    html.includes('Sudah dikumpulkan untuk dinilai') ||
    html.includes('submissionstatussubmitted');

  const isDraft =
    html.includes('Draft (not submitted)') ||
    html.includes('Draf (belum dikumpulkan)') ||
    html.includes('submissionstatusdraft');

  const hasSubmissionStatement =
    html.includes('submissionstatement') ||
    html.includes('This submission is my own work');

  let statusText = 'Unknown';
  if (isSubmitted) statusText = 'Submitted for grading';
  else if (isDraft) statusText = 'Draft (not submitted)';
  else if (html.includes('No submissions have been made yet') || html.includes('Belum ada tugas yang dikumpulkan')) {
    statusText = 'No submission';
  }

  // Extract submitted file name if present
  const fileMatch = html.match(/class=["'][^"']*(?:fileuploadsubmission|fp-filename)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span|a)>/i) ||
                    html.match(/<a[^>]+href=["'][^"']*\/pluginfile\.php\/[^"']+["'][^>]*>([^<]+\.pdf)<\/a>/i);
  const fileName = fileMatch ? fileMatch[1].replace(/<[^>]+>/g, '').trim() : undefined;

  return {
    isSubmitted,
    isDraft,
    hasSubmissionStatement,
    statusText,
    fileName,
  };
}
