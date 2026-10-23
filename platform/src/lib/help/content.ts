/* ─── In-app Help / Guides content ───────────────────────────────────────────
   Role-aware, step-by-step guidance for the POSM field-execution platform. This module is
   PURE DATA (no React, no imports) so it stays trivially testable and reusable.

   The copy is grounded in the REAL flows of each portal — recce → ASM approval → install →
   auditor review, plus the admin masters/config. Keep it accurate: if a flow changes, update
   the matching topic here rather than inventing capabilities the app does not have.
──────────────────────────────────────────────────────────────────────────── */

/** The six backend roles this platform ships. Mirrors the UserRole enum used by the guards. */
export type HelpRole =
  | 'VENDOR_FIELD'
  | 'ASM'
  | 'AUDITOR'
  | 'CLIENT_ADMIN'
  | 'GIFSY_ADMIN'
  | 'VENDOR_HO';

/** One "how do I…" topic: a title plus ordered, plain-language steps. */
export interface HelpTopic {
  /** Short, action-oriented heading, e.g. "Capture a recce". Always non-empty. */
  title: string;
  /** One short instruction per step. Always at least one entry. */
  steps: string[];
}

/** A reusable callout block (used for the shared field rules). */
export interface HelpNote {
  title: string;
  points: string[];
}

/** The complete guide for a single role. */
export interface RoleGuide {
  role: HelpRole;
  /** Human-friendly role name shown in the UI. */
  label: string;
  /** One or two sentences: what this portal is for. */
  intro: string;
  /** The home route for this role (handy "take me there" link on the guide). */
  home: string;
  /** Ordered list of topics. */
  topics: HelpTopic[];
  /** When true the shared geo-fence / photo rules are relevant to this role. */
  showFieldNotes: boolean;
}

/** Human role labels — the single source of truth for how each role is named in the UI. */
export const ROLE_LABELS: Record<HelpRole, string> = {
  CLIENT_ADMIN: 'Client Admin',
  ASM: 'ASM (Area Sales Manager)',
  AUDITOR: 'Auditor',
  VENDOR_HO: 'Vendor — Head Office',
  VENDOR_FIELD: 'Vendor — Field',
  GIFSY_ADMIN: 'Platform Admin',
};

/**
 * Shared "good to know" rules for anyone who captures or reviews field photos. Reused across
 * the field-facing roles so the geo-fence / photo policy is stated once and identically.
 */
export const FIELD_NOTES: HelpNote = {
  title: 'Photo & location rules — good to know',
  points: [
    'You must be physically at the outlet, inside its geo-fence, for the capture to be accepted. If you are too far away the app will block the photo.',
    'Take one distinct, real photo per Element slot — do not reuse the same shot for two Elements or upload from your gallery.',
    'An installation photo must be a fresh, post-install picture. Re-using the recce photo at the install stage is not allowed.',
    'Keep good lighting and frame the whole Element. Clear photos get approved faster and avoid re-capture.',
  ],
};

/** The full guide content, keyed by role. */
export const HELP_CONTENT: Record<HelpRole, RoleGuide> = {
  VENDOR_FIELD: {
    role: 'VENDOR_FIELD',
    label: ROLE_LABELS.VENDOR_FIELD,
    home: '/field/sites',
    showFieldNotes: true,
    intro:
      'This is your field app for putting up Elements at your assigned outlets. You capture a recce at each outlet, and once your ASM approves it you go back to install and photograph the finished Element.',
    topics: [
      {
        title: 'Find and open one of my outlets',
        steps: [
          'Tap “Outlets” in the bottom menu — it lists every outlet assigned to you.',
          'Search by name, or tap the filter icon to filter by code, town or RS code.',
          'Tap an outlet to see its details and directions.',
          'Prefer to work by distance? Open “Nearby” to see the closest outlets to you right now.',
        ],
      },
      {
        title: 'Capture a recce',
        steps: [
          'Open the outlet and tap “Start recce”.',
          'Travel to the outlet — you must be inside its geo-fence for the app to let you capture.',
          'For each Element slot, take one clear, distinct photo of where the Element will go.',
          'Review your photos, then submit. The recce goes to your ASM for approval.',
          'You can track it under “My Work” — it will sit in “Awaiting approval” until the ASM acts.',
        ],
      },
      {
        title: 'Fix a rejected recce',
        steps: [
          'Open “My Work” and look under “Needs re-capture”.',
          'Read the reason the ASM sent it back — it tells you what to fix.',
          'Tap “Re-capture”, return to the outlet, and take fresh photos that address the reason.',
          'Submit again. This updates the same recce rather than creating a new one.',
        ],
      },
      {
        title: 'Do the installation after approval',
        steps: [
          'In “My Work”, find the recce under “Ready to install” (approved by the ASM).',
          'Tap “Start installation” — this is the only way into the install screen.',
          'Put up each Element at the outlet, inside the geo-fence.',
          'Photograph every installed Element with a fresh post-install photo (not the recce photo).',
          'Submit. Your installation now goes to the Auditor for final review.',
        ],
      },
      {
        title: 'Complete a manual task',
        steps: [
          'Open “Tasks” to see any ad-hoc tasks your admin has assigned to you.',
          'Tap a task to see what is required and any form to fill in.',
          'Complete the steps, capture anything requested, and submit.',
        ],
      },
    ],
  },

  ASM: {
    role: 'ASM',
    label: ROLE_LABELS.ASM,
    home: '/review',
    showFieldNotes: true,
    intro:
      'You review the recces captured by field vendors in your territory. Approving a recce unlocks the installation for that outlet; rejecting it sends the vendor back to re-capture.',
    topics: [
      {
        title: 'Work the recce approval queue',
        steps: [
          'Open “Approval Queue” to see the recces waiting for your approval.',
          'You only see outlets in your own territory.',
          'Tap a recce to open it and review every Element photo.',
        ],
      },
      {
        title: 'Approve a recce',
        steps: [
          'Open the recce and check each Element photo against the outlet and the expected Element slots.',
          'Confirm the photos are clear, distinct, and taken at the outlet.',
          'Tap “Approve”. This unlocks the installation step for the vendor at that outlet.',
        ],
      },
      {
        title: 'Reject a recce',
        steps: [
          'If a photo is unclear, reused, or clearly not at the outlet, tap “Reject”.',
          'Pick the reason code that best explains the problem — the vendor sees this.',
          'The recce moves to the vendor’s “Needs re-capture” list so they can fix and resubmit.',
        ],
      },
    ],
  },

  AUDITOR: {
    role: 'AUDITOR',
    label: ROLE_LABELS.AUDITOR,
    home: '/audit',
    showFieldNotes: true,
    intro:
      'You give installations their final check. For each Element you compare the installed photo against the approved recce photo, then approve or reject. Your view spans the whole tenant.',
    topics: [
      {
        title: 'Work the installation review queue',
        steps: [
          'Open “Review queue” to see the installations waiting for audit across all territories.',
          'Tap one to open its per-Element comparison view.',
        ],
      },
      {
        title: 'Compare install vs recce, per Element',
        steps: [
          'For each Element, the install photo is shown next to its recce photo.',
          'Check that the Element was actually installed and matches the approved recce slot.',
          'Confirm the install photo is a fresh post-install shot, not a copy of the recce photo.',
        ],
      },
      {
        title: 'Approve or reject an installation',
        steps: [
          'If every Element checks out, tap “Approve” to close the installation.',
          'If something is wrong, tap “Reject” and give a reason.',
          'A rejection sends the work back so it can be corrected and re-submitted.',
        ],
      },
    ],
  },

  CLIENT_ADMIN: {
    role: 'CLIENT_ADMIN',
    label: ROLE_LABELS.CLIENT_ADMIN,
    home: '/admin',
    showFieldNotes: false,
    intro:
      'You run the program for your organisation: set up the masters (vendors, users, Element types, outlets), configure capture rules, assign ad-hoc tasks, and watch progress through analytics and reports. You can also open the review and audit consoles.',
    topics: [
      {
        title: 'Add outlets (bulk Excel upload)',
        steps: [
          'Open “Outlets”.',
          'Outlets are added by uploading an Excel file — there is no one-by-one add form.',
          'Download the template, fill in each outlet with its location, and upload it.',
          'Review the import summary — any rejected rows come back in an error file to fix and re-upload.',
        ],
      },
      {
        title: 'Manage vendors and users',
        steps: [
          'Open “Vendors” to add or edit the vendor companies working your outlets.',
          'Open “Users” to create field vendors, ASMs, auditors and other logins, and set their role.',
          'Assign field users to a vendor so their outlet list and work are scoped correctly.',
        ],
      },
      {
        title: 'Define Element types',
        steps: [
          'Open “Element Types”.',
          'Add each kind of Element your program uses.',
          'These are the Element slots vendors photograph during a recce and installation.',
        ],
      },
      {
        title: 'Set geo-fence and capture rules',
        steps: [
          'Open “Settings”.',
          'Set the geo-fence radius that decides how close a vendor must be to capture.',
          'Adjust the capture configuration for how photos are taken and validated.',
        ],
      },
      {
        title: 'Create ad-hoc manual tasks',
        steps: [
          'Open “Manual tasks”.',
          'Create a manual task and, if needed, build a form for the field user to fill in.',
          'Assign it to the vendors who should complete it — it appears in their “Tasks”.',
        ],
      },
      {
        title: 'Track progress and schedule reports',
        steps: [
          'Open “Analytics” for live dashboards on recce, install and audit progress.',
          'Open “Email reports” to set up scheduled email reports delivered to your inbox.',
        ],
      },
    ],
  },

  GIFSY_ADMIN: {
    role: 'GIFSY_ADMIN',
    label: ROLE_LABELS.GIFSY_ADMIN,
    home: '/admin',
    showFieldNotes: false,
    intro:
      'As Platform Admin you have the same admin screens as a Client Admin — vendors, users, Element types, outlets, manual tasks, analytics, reports and settings — but your view spans every tenant on the platform rather than a single organisation.',
    topics: [
      {
        title: 'Work across tenants',
        steps: [
          'Every admin screen shows data across all client organisations, not just one.',
          'Use it to support clients, spot-check configuration, and monitor program health platform-wide.',
        ],
      },
      {
        title: 'Manage masters and configuration',
        steps: [
          'Outlets, vendors, users, Element types, settings, manual tasks, analytics and reports all work as they do for a Client Admin.',
          'Remember outlets are always added by bulk Excel upload, never a single-record form.',
        ],
      },
      {
        title: 'Review and audit',
        steps: [
          'You can open the recce review and installation audit consoles as well.',
          'Note: Platform Admin accounts are not created from the admin UI — they are provisioned by the platform team.',
        ],
      },
    ],
  },

  VENDOR_HO: {
    role: 'VENDOR_HO',
    label: ROLE_LABELS.VENDOR_HO,
    home: '/vendor',
    showFieldNotes: false,
    intro:
      'This is your read-only head-office console. It shows analytics over your own vendor fleet’s progress — recces, installations and audit outcomes — so you can see how your field teams are doing at a glance.',
    topics: [
      {
        title: 'Read your fleet dashboard',
        steps: [
          'Open your console home to see the analytics widgets for your vendor fleet.',
          'Track how many recces, installations and audits your field users have completed.',
          'Everything here is view-only — you monitor progress rather than capture or approve work.',
        ],
      },
      {
        title: 'Understand the numbers',
        steps: [
          'Recce counts reflect what your field users have submitted for ASM approval.',
          'Installation and audit figures show how much work has been approved and finalised.',
          'If figures look wrong, check with your field users or your program’s Client Admin.',
        ],
      },
    ],
  },
};

/** Ordered role list — controls the order roles appear in the admin role switcher. */
export const HELP_ROLES: HelpRole[] = [
  'VENDOR_FIELD',
  'ASM',
  'AUDITOR',
  'CLIENT_ADMIN',
  'GIFSY_ADMIN',
  'VENDOR_HO',
];

/** Type guard: is this string one of the six known roles? */
export function isHelpRole(role: string | null | undefined): role is HelpRole {
  return role != null && Object.prototype.hasOwnProperty.call(HELP_CONTENT, role);
}

/**
 * Resolve a backend role string to its guide. Returns null when the role is unknown/absent
 * so the caller can render a loading or fallback state.
 */
export function getGuide(role: string | null | undefined): RoleGuide | null {
  return isHelpRole(role) ? HELP_CONTENT[role] : null;
}
