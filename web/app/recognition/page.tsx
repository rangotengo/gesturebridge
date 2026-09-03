import { redirect } from 'next/navigation';

/**
 * The recognition view now lives at '/' (the home page).
 * Redirect any direct visitors to keep the URL clean.
 */
export default function RecognitionPage(): never {
  redirect('/');
}
