/**
 * Going somewhere with a purpose.
 *
 * The drawer only ever said "show me Notes". Search and Home's quick actions
 * need "open this note" and "start a checklist", so a destination can now come
 * with an intent. The screen it is handed to acts on it once and reports back,
 * and the Shell forgets it — returning to the screen later opens nothing.
 */

/** Every screen the shell can show. Money is four of them under one tab. */
export type ViewName =
  | 'home'
  | 'add'
  | 'recurring'
  | 'debts'
  | 'accounts'
  | 'documents'
  | 'notes'
  | 'insights'
  | 'backup';

export type Intent =
  | { readonly kind: 'note'; readonly id: string }
  | { readonly kind: 'newNote'; readonly with: 'text' | 'checklist' | 'image' | 'camera' }
  | { readonly kind: 'person'; readonly id: string }
  | { readonly kind: 'newPerson' }
  | { readonly kind: 'document'; readonly id: string }
  | { readonly kind: 'account'; readonly id: string }
  | { readonly kind: 'newAccount' };

export type Navigate = (view: ViewName, intent?: Intent) => void;

/** What a screen receives: the intent, and how to say it has been used. */
export interface IntentProps {
  readonly intent?: Intent | null;
  readonly onIntentHandled?: () => void;
}
