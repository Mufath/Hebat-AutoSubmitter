/**
 * src/moodle/types.ts
 * Strict TypeScript types for Moodle operations.
 */

export interface DiscoveredAssignment {
  cmid: string;
  name: string;
  url: string;
  isAvailable?: boolean;
  availableFromText?: string;
  availableFromEpochMs?: number;
}

export interface SubmissionFormFields {
  lastmodified: string;
  id: string;
  userid: string;
  action: string;
  sesskey: string;
  _qf__mod_assign_submission_form: string;
  mform_isexpanded_id_submissionheader: string;
  files_filemanager: string;
  extraFields: Record<string, string>;
}

export interface SubmissionStatus {
  isSubmitted: boolean;
  isDraft: boolean;
  hasSubmissionStatement: boolean;
  statusText: string;
  fileName?: string;
}

export interface UploadResult {
  ok: boolean;
  itemid: number;
  fileName: string;
  fileUrl?: string;
  error?: string;
}

export interface LoginResult {
  ok: boolean;
  sesskey: string;
  userId?: string;
  error?: string;
}
