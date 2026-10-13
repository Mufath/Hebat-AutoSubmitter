/**
 * src/moodle/discover.ts
 * Discovers assignment details and course context ID from Moodle course pages.
 */

import { CookieJar, Budget, mfetch } from './http';
import { parseAssignments, parseCourseContextId } from './parse';
import type { DiscoveredAssignment } from './types';

export interface DiscoverResult {
  assignment: DiscoveredAssignment | null;
  courseContextId: string | null;
  allAssignments: DiscoveredAssignment[];
}

export async function discoverAssignment(
  jar: CookieJar,
  bud: Budget,
  baseUrl: string,
  courseId: string,
  assignmentNamePattern: string,
  sectionUrl?: string
): Promise<DiscoverResult> {
  // Fetch main course page
  const coursePage = await mfetch(jar, bud, `${baseUrl}/course/view.php?id=${courseId}`);
  let html = await coursePage.res.text();
  const courseContextId = parseCourseContextId(html);

  let allAssignments = parseAssignments(html);

  // If no assignments found, try section page (for 'One section per page' course format)
  if (allAssignments.length === 0) {
    const targetSectionUrl = sectionUrl
      ? (sectionUrl.startsWith('http') ? sectionUrl : `${baseUrl}/${sectionUrl.replace(/^\//, '')}`)
      : `${baseUrl}/course/section.php?id=75330`;

    const sectionPage = await mfetch(jar, bud, targetSectionUrl);
    const sectionHtml = await sectionPage.res.text();
    html = sectionHtml;
    allAssignments = parseAssignments(sectionHtml);
  }

  // Match assignment by pattern
  const normalizedPattern = assignmentNamePattern.toLowerCase().replace(/\s+/g, ' ').trim();
  const matched = allAssignments.find(a =>
    a.name.toLowerCase().replace(/\s+/g, ' ').includes(normalizedPattern)
  ) || null;

  return {
    assignment: matched,
    courseContextId,
    allAssignments,
  };
}
