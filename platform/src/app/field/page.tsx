import { redirect } from 'next/navigation';

/** `/field` → the Sites home. */
export default function FieldIndex() {
  redirect('/field/sites');
}
