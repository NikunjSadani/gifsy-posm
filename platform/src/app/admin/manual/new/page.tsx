'use client';

/** Create a new manual task via the builder. */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ArrowLeft } from 'lucide-react';
import { TaskBuilder, type BuilderPayload } from '@/components/manual/task-builder';
import { type VendorLite, manualApi } from '@/lib/manual/admin-api';

export default function NewManualTaskPage() {
  const router = useRouter();
  const [vendors, setVendors] = useState<VendorLite[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(true);
  const [vendorsError, setVendorsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await manualApi.listVendors();
      if (res.success) setVendors(res.data);
      else setVendorsError(res.error || 'Could not load fleets.');
      setVendorsLoading(false);
    })();
  }, []);

  const onSubmit = async (payload: BuilderPayload) => {
    if (!payload.formSchema) return; // create always carries a schema
    setSubmitting(true);
    setError(null);
    const res = await manualApi.createTask({
      title: payload.title,
      description: payload.description || undefined,
      vendorId: payload.vendorId,
      dueDate: payload.dueDate,
      formSchema: payload.formSchema,
    });
    setSubmitting(false);
    if (!res.success) {
      setError(res.error || 'Could not create the task.');
      return;
    }
    toast.success('Task created');
    router.push(`/admin/manual/${res.data.id}`);
  };

  return (
    <div>
      <Link
        href="/admin/manual"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="h-4 w-4" />
        Manual tasks
      </Link>
      <h1 className="mb-5 text-xl font-bold text-gray-900">New manual task</h1>

      <TaskBuilder
        mode="create"
        initial={{ title: '', description: '', vendorId: '', dueDate: '', fields: [], captureGpsOnSubmit: false }}
        vendors={vendors}
        vendorsLoading={vendorsLoading}
        vendorsError={vendorsError}
        submitting={submitting}
        error={error}
        submitLabel="Create task"
        onSubmit={onSubmit}
        onCancel={() => router.push('/admin/manual')}
      />
    </div>
  );
}
