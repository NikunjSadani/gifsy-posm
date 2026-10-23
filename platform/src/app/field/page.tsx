import { redirect } from 'next/navigation';

/** `/field` → the recce list, which now hosts the RS + Beat filter inline. */
export default function FieldIndex() {
  redirect('/field/sites');
}
