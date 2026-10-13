/**
 * src/moodle/parse.ts
 * Pure parser functions for Moodle HTML responses.
 * Designed to execute well within Cloudflare Workers' 10ms CPU limit.
 */

import type { DiscoveredAssignment, SubmissionFormFields, SubmissionStatus } from './types';

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

/**
 * Parses the "Available from ..." availability restriction text to epoch ms.
 * Example: "Available from 14 October 2026, 7:00 AM" or "Dibuka mulai ..."
 */
export function parseAvailableFrom(text: string): { text: string; epochMs?: number } | null {
  const match = text.match(/(?:Available from|Dibuka mulai dari?)\s+([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4},\s+[0-9]{1,2}:[0-9]{2}(?:\s*(?:AM|PM))?)/i);
  if (!match) return null;

  const rawDateStr = match[1].trim();
  // Attempt to parse standard date string
  const parsedTime = Date.parse(rawDateStr);
  return {
    text: match[0].trim(),
    epochMs: isNaN(parsedTime) ? undefined : parsedTime,
  };
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

  // Regex to extract activity module list items
  const liRegex = /<li[^>]+id=["']module-(\d+)["'][^>]*>([\s\S]*?)<\/li>/gi;
  let match: RegExpExecArray | null;

  while ((match = liRegex.exec(html)) !== null) {
    const cmid = match[1];
    const inner = match[2];

    const isAssign = inner.includes('modtype_assign') || match[0].includes('modtype_assign') || inner.includes('/mod/assign/view.php');
    if (!isAssign) continue;

    // Remove accesshide spans first to avoid nested span truncation issues
    const cleanedInner = inner.replace(/<span[^>]*class=["'][^"']*accesshide[^"']*["'][\s\S]*?<\/span>/gi, '');

    // Extract assignment name
    const nameMatch = cleanedInner.match(/class=["'][^"']*(?:instancename|activityname)[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div|a)>/i) ||
                      cleanedInner.match(/<a[^>]+class=["'][^"']*aal_link[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    let name = '';
    if (nameMatch) {
      name = nameMatch[1].replace(/<[^>]+>/g, '').trim();
    } else {
      name = `Assignment ${cmid}`;
    }

    const avail = parseAvailableFrom(inner);

    assignments.push({
      cmid,
      name,
      url: `/mod/assign/view.php?id=${cmid}`,
      isAvailable: !inner.includes('Available from') && !inner.includes('Dibuka mulai'),
      availableFromText: avail?.text,
      availableFromEpochMs: avail?.epochMs,
    });
  }

  return assignments;
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
