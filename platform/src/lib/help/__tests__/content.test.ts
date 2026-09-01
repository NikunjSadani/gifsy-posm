import { describe, it, expect } from 'vitest';
import {
  HELP_CONTENT,
  HELP_ROLES,
  ROLE_LABELS,
  FIELD_NOTES,
  getGuide,
  isHelpRole,
  type HelpRole,
} from '@/lib/help/content';

const ALL_ROLES: HelpRole[] = [
  'VENDOR_FIELD',
  'ASM',
  'AUDITOR',
  'CLIENT_ADMIN',
  'GIFSY_ADMIN',
  'VENDOR_HO',
];

describe('help content — coverage', () => {
  it('has a guide for every one of the 6 roles', () => {
    for (const role of ALL_ROLES) {
      expect(HELP_CONTENT[role]).toBeDefined();
    }
    expect(Object.keys(HELP_CONTENT).sort()).toEqual([...ALL_ROLES].sort());
  });

  it('HELP_ROLES lists all 6 roles exactly once', () => {
    expect(HELP_ROLES).toHaveLength(6);
    expect([...HELP_ROLES].sort()).toEqual([...ALL_ROLES].sort());
    expect(new Set(HELP_ROLES).size).toBe(HELP_ROLES.length);
  });
});

describe('help content — every guide is well-formed', () => {
  for (const role of ALL_ROLES) {
    const guide = HELP_CONTENT[role];

    describe(role, () => {
      it('carries the right role key + a non-empty intro', () => {
        expect(guide.role).toBe(role);
        expect(guide.intro.trim().length).toBeGreaterThan(0);
      });

      it('uses the human-friendly role label', () => {
        expect(guide.label).toBe(ROLE_LABELS[role]);
        expect(guide.label.trim().length).toBeGreaterThan(0);
      });

      it('has a home route starting with "/"', () => {
        expect(guide.home.startsWith('/')).toBe(true);
      });

      it('has at least one topic', () => {
        expect(guide.topics.length).toBeGreaterThan(0);
      });

      it('every topic has a non-empty title and at least one non-empty step', () => {
        for (const topic of guide.topics) {
          expect(topic.title.trim().length).toBeGreaterThan(0);
          expect(topic.steps.length).toBeGreaterThan(0);
          for (const step of topic.steps) {
            expect(step.trim().length).toBeGreaterThan(0);
          }
        }
      });
    });
  }
});

describe('role labels', () => {
  it('matches the expected human labels exactly', () => {
    expect(ROLE_LABELS.CLIENT_ADMIN).toBe('Client Admin');
    expect(ROLE_LABELS.ASM).toBe('ASM (Area Sales Manager)');
    expect(ROLE_LABELS.AUDITOR).toBe('Auditor');
    expect(ROLE_LABELS.VENDOR_HO).toBe('Vendor — Head Office');
    expect(ROLE_LABELS.VENDOR_FIELD).toBe('Vendor — Field');
    expect(ROLE_LABELS.GIFSY_ADMIN).toBe('Platform Admin');
  });

  it('has a label for every role', () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });
});

describe('shared field notes', () => {
  it('has a title and at least one rule', () => {
    expect(FIELD_NOTES.title.trim().length).toBeGreaterThan(0);
    expect(FIELD_NOTES.points.length).toBeGreaterThan(0);
    for (const point of FIELD_NOTES.points) {
      expect(point.trim().length).toBeGreaterThan(0);
    }
  });

  it('is shown to the capture/review roles and hidden from office/admin roles', () => {
    expect(HELP_CONTENT.VENDOR_FIELD.showFieldNotes).toBe(true);
    expect(HELP_CONTENT.ASM.showFieldNotes).toBe(true);
    expect(HELP_CONTENT.AUDITOR.showFieldNotes).toBe(true);
    expect(HELP_CONTENT.CLIENT_ADMIN.showFieldNotes).toBe(false);
    expect(HELP_CONTENT.GIFSY_ADMIN.showFieldNotes).toBe(false);
    expect(HELP_CONTENT.VENDOR_HO.showFieldNotes).toBe(false);
  });
});

describe('isHelpRole', () => {
  it('accepts every known role', () => {
    for (const role of ALL_ROLES) {
      expect(isHelpRole(role)).toBe(true);
    }
  });

  it('rejects unknown roles and empty values', () => {
    expect(isHelpRole('SUPER_ADMIN')).toBe(false);
    expect(isHelpRole('')).toBe(false);
    expect(isHelpRole(null)).toBe(false);
    expect(isHelpRole(undefined)).toBe(false);
  });
});

describe('getGuide', () => {
  it('returns the matching guide for a known role', () => {
    expect(getGuide('AUDITOR')).toBe(HELP_CONTENT.AUDITOR);
  });

  it('returns null for unknown role / no session', () => {
    expect(getGuide('NOPE')).toBeNull();
    expect(getGuide(null)).toBeNull();
    expect(getGuide(undefined)).toBeNull();
  });
});
