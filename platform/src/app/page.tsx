/**
 * Root landing — chassis placeholder.
 *
 * Wave 0 ships the reusable chassis only (auth / proxy / UI-kit / layout / theme); the POSM
 * feature portals (field recce/install, ASM review, auditor, vendor-HO, admin) land in later
 * waves. In a deployed environment the edge proxy redirects `/` to `/auth/login`; this page is
 * the neutral fallback so the app tree is valid before those routes exist.
 */
export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6 text-center">
      <div className="w-full max-w-md rounded-2xl bg-white border border-gray-200 shadow-sm px-8 py-10">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand-primary)] text-white font-black text-lg">
          F
        </div>
        <h1 className="text-xl font-bold text-gray-900">Field Execution Platform</h1>
        <p className="mt-2 text-sm text-gray-500">
          The chassis is up. Feature portals arrive in the next waves.
        </p>
      </div>
    </main>
  );
}
