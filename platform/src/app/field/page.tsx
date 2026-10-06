import { redirect } from 'next/navigation';

/** `/field` → the mandatory outlet-filter landing (RS code + Beat). */
export default function FieldIndex() {
  redirect('/field/filter');
}
