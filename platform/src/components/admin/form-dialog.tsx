'use client';

import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

/**
 * A create/edit form dialog shell. The page owns the field inputs (passed as children);
 * this provides the modal frame, a form-level error banner (for a backend 400/409 that
 * isn't tied to a single field), and a submit/cancel footer that disables while in-flight.
 *
 * Rendered as a real <form> so Enter submits and the browser's required-field semantics
 * still apply; the page's onSubmit runs client validation first.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel = 'Save',
  loading = false,
  error,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel?: string;
  loading?: boolean;
  error?: string | null;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!loading) onSubmit();
        }}
        className="flex flex-col gap-4"
      >
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            {error}
          </div>
        )}
        {children}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={loading}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default FormDialog;
