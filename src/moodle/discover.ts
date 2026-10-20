/**
 * src/moodle/discover.ts
 * Discovers assignment details and course context ID from Moodle course pages.
 */

import { CookieJar, Budget, mfetch } from './http';
import { parseAssignments, parseCourseContextId, parseSesskey, parseUserId } from './parse';
import type { DiscoveredAssignment } from './types';

export interface DiscoverResult {
  assignment: DiscoveredAssignment | null;
  courseContextId: string | null;
  userId?: string | null;
  sesskey?: string | null;
  allAssignments: DiscoveredAssignment[];
}

export async function discoverAssignment(
  jar: CookieJar,
  bud: Budget,
  baseUrl: string,
  courseId: string,
  assignmentNamePattern: string,
  sectionUrl?: string,
  targetCmid?: string
): Promise<DiscoverResult> {
  // Fetch main course page
  const coursePage = await mfetch(jar, bud, `${baseUrl}/course/view.php?id=${courseId}`);
  const html = await coursePage.res.text();
  const courseContextId = parseCourseContextId(html);
  const userId = parseUserId(html);
  const sesskey = parseSesskey(html);

  const allAssignments = parseAssignments(html);

  // If a specific sectionUrl is provided, or if course 10978 has no assignments on main page, fetch section page
  if (sectionUrl || (allAssignments.length === 0 && courseId === '10978')) {
    const targetSectionUrl = sectionUrl
      ? (sectionUrl.startsWith('http') ? sectionUrl : `${baseUrl}/${sectionUrl.replace(/^\//, '')}`)
      : `${baseUrl}/course/section.php?id=75330`;

    const sectionPage = await mfetch(jar, bud, targetSectionUrl);
    const sectionHtml = await sectionPage.res.text();
    const sectionAssignments = parseAssignments(sectionHtml);
    // Prioritize section assignments by prepending them
    for (let i = sectionAssignments.length - 1; i >= 0; i--) {
      const sa = sectionAssignments[i];
      if (!allAssignments.some(a => a.cmid === sa.cmid)) {
        allAssignments.unshift(sa);
      }
    }
  }

  let matched: DiscoveredAssignment | null = null;

  // 1. Match by explicit cmid if provided
  if (targetCmid) {
    matched = allAssignments.find(a => a.cmid === String(targetCmid)) || null;
  }

  // 2. Match assignment by name pattern
  if (!matched && assignmentNamePattern) {
    const normalizedPattern = assignmentNamePattern.toLowerCase().replace(/\s+/g, ' ').trim();
    matched =
      allAssignments.find(a => a.name.toLowerCase().replace(/\s+/g, ' ') === normalizedPattern) ||
      allAssignments.find(a => a.name.toLowerCase().replace(/\s+/g, ' ').includes(normalizedPattern)) ||
      null;
  }

  return {
    assignment: matched,
    courseContextId,
    userId,
    sesskey,
    allAssignments,
  };
}
