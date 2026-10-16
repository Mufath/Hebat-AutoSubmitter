/**
 * src/schedule.ts
 * Syllabus and weekly schedule mapping for FST25605011 - Sistem Operasi (Praktikum).
 * Allows Level 3 zero-configuration full-semester automation.
 */

export interface PracticalSchedule {
  week: number;
  dateStr: string; // Human-readable date
  unlockEpochMs: number; // UTC timestamp of unlock
  unlockIsoWib: string; // ISO with +07:00
  sectionId: string;
  assignmentName: string;
  deadlineIsoWib: string;
}

export const SO_PRACTICAL_SCHEDULE: PracticalSchedule[] = [
  {
    week: 8,
    dateStr: 'Rabu, 14 Oktober 2026',
    unlockEpochMs: new Date('2026-10-14T07:00:00+07:00').getTime(),
    unlockIsoWib: '2026-10-14T07:00:00+07:00',
    sectionId: '75330',
    assignmentName: 'Pengumpulan Modul Prak Lab 10 NDG Linux Essential',
    deadlineIsoWib: '2026-10-15T23:59:00+07:00',
  },
  {
    week: 9,
    dateStr: 'Rabu, 21 Oktober 2026',
    unlockEpochMs: new Date('2026-10-21T07:00:00+07:00').getTime(),
    unlockIsoWib: '2026-10-21T07:00:00+07:00',
    sectionId: '75331',
    assignmentName: 'Pengumpulan Modul Prak Lab 11 NDG Linux Essential',
    deadlineIsoWib: '2026-10-22T23:59:00+07:00',
  },
  {
    week: 10,
    dateStr: 'Rabu, 28 Oktober 2026',
    unlockEpochMs: new Date('2026-10-28T07:00:00+07:00').getTime(),
    unlockIsoWib: '2026-10-28T07:00:00+07:00',
    sectionId: '75332',
    assignmentName: 'Pengumpulan Modul Prak Lab 12-13 NDG Linux Essential',
    deadlineIsoWib: '2026-10-29T23:59:00+07:00',
  },
  {
    week: 11,
    dateStr: 'Rabu, 4 November 2026',
    unlockEpochMs: new Date('2026-11-04T07:00:00+07:00').getTime(),
    unlockIsoWib: '2026-11-04T07:00:00+07:00',
    sectionId: '75333',
    assignmentName: 'Pengumpulan Modul Prak Lab 14-16 NDG Linux Essential',
    deadlineIsoWib: '2026-11-05T23:59:00+07:00',
  },
  {
    week: 12,
    dateStr: 'Rabu, 11 November 2026',
    unlockEpochMs: new Date('2026-11-11T07:00:00+07:00').getTime(),
    unlockIsoWib: '2026-11-11T07:00:00+07:00',
    sectionId: '75334',
    assignmentName: 'Pengumpulan Modul Prak Lab 17-18 NDG Linux Essential',
    deadlineIsoWib: '2026-11-12T23:59:00+07:00',
  },
  {
    week: 13,
    dateStr: 'Rabu, 18 November 2026',
    unlockEpochMs: new Date('2026-11-18T07:00:00+07:00').getTime(),
    unlockIsoWib: '2026-11-18T07:00:00+07:00',
    sectionId: '75335',
    assignmentName: 'Pengumpulan Challenge Lab. A dan B NDG Linux Essential',
    deadlineIsoWib: '2026-11-19T23:59:00+07:00',
  },
  {
    week: 14,
    dateStr: 'Rabu, 25 November 2026',
    unlockEpochMs: new Date('2026-11-25T07:00:00+07:00').getTime(),
    unlockIsoWib: '2026-11-25T07:00:00+07:00',
    sectionId: '75336',
    assignmentName: 'Pengumpulan Challenge Lab. C dan D NDG Linux Essential',
    deadlineIsoWib: '2026-11-26T23:59:00+07:00',
  },
];

/**
 * Resolves the currently relevant practical session based on current timestamp.
 * If within 36 hours of an unlock or if looking forward to the next unlock.
 */
export function getActivePracticalSchedule(nowEpochMs: number = Date.now()): PracticalSchedule {
  // 1. Check if we are currently in an active submission window (covers up to 6 days after unlock, including Friday classes)
  for (const item of SO_PRACTICAL_SCHEDULE) {
    const timeDiff = nowEpochMs - item.unlockEpochMs;
    if (timeDiff >= -3600000 && timeDiff <= 6 * 24 * 3600000) {
      return item;
    }
  }

  // 2. Otherwise find the upcoming one
  for (const item of SO_PRACTICAL_SCHEDULE) {
    if (item.unlockEpochMs > nowEpochMs) {
      return item;
    }
  }

  // Default to the last one or Week 8
  return SO_PRACTICAL_SCHEDULE[0];
}
