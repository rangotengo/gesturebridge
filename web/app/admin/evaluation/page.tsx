import { redirect } from 'next/navigation';

export default function AdminEvaluationRedirect() {
  redirect('/ml/evaluation');
}
