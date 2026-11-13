import { CloudError } from './api';
import { BLOCKED_MESSAGES, BlockedCode } from './authConfig';

// Distinct account states (ADR-0420, AV-0420-03). Each way the account can be out of reach has
// its own words and its own way back, instead of one raw "Failed to fetch" over an empty page:
//
// | State            | Seen as                                  | Way back                       |
// | signed out       | the welcome page                         | Sign in / Create your account  |
// | session expired  | `token_expired` refusal                  | Sign in again                  |
// | sign-in invalid  | `token_invalid` refusal                  | Sign in again                  |
// | signed out by us | `session_revoked` refusal                | Sign in again                  |
// | being deleted    | `account_deleting` refusal               | Sign out (support to keep it)  |
// | email unverified | `verified_email_required` refusal        | I've verified / Sign out       |
// | suspended        | `account.user.suspended`                 | Download my data / Sign out    |
// | over quota       | storage state `over_quota_read_only`     | Manage storage / See plans     |
// | unreachable      | the request never reached SelectaDJ      | Try again (and on reconnect)   |
// | server error     | 5xx from SelectaDJ Cloud                 | Try again                      |
// | other refusal    | any other 4xx while reading the account  | Try again / Sign out           |

export type AccountProblem = 'offline' | 'server' | 'unexpected';

export const ACCOUNT_PROBLEMS: Record<AccountProblem, { title: string; detail: string; retry: string }> = {
  offline: {
    title: 'Can’t reach SelectaDJ Cloud',
    detail: 'This device looks offline, or the network is blocking SelectaDJ. Your account and music are safe. SelectaDJ tries again when the connection comes back.',
    retry: 'Try again',
  },
  server: {
    title: 'SelectaDJ Cloud is having trouble',
    detail: 'The problem is on our side, not with your account or your music. Wait a moment, then try again.',
    retry: 'Try again',
  },
  unexpected: {
    title: 'Your account didn’t load',
    detail: 'SelectaDJ couldn’t read your account just now.',
    retry: 'Try again',
  },
};

/** What kind of problem stopped the account loading. A request that never got an answer
 * (fetch's TypeError, or the browser saying it's offline) is "offline"; a 5xx is the server's. */
export function accountProblem(error: unknown, online: boolean = typeof navigator === 'undefined' ? true : navigator.onLine): AccountProblem {
  if (!online) return 'offline';
  if (error instanceof CloudError) return error.status >= 500 ? 'server' : 'unexpected';
  return error instanceof TypeError ? 'offline' : 'unexpected';
}

/** The words for a refusal that replaces the app. With distinct states on, an expired sign-in
 * and an invalid one each say what happened; off, both keep the shared "Sign in again". */
export const DISTINCT_BLOCKED: Partial<Record<BlockedCode, { title: string; detail: string }>> = {
  token_expired: {
    title: 'Your session expired',
    detail: 'Sign-ins end after a while to keep your account safe. Nothing was lost: sign in again to carry on.',
  },
  token_invalid: {
    title: 'We couldn’t confirm your sign-in',
    detail: 'This browser’s sign-in no longer matches your account, for example after signing in somewhere else. Sign in again to continue.',
  },
};

export function blockedMessage(code: BlockedCode, distinct: boolean) {
  return (distinct && DISTINCT_BLOCKED[code]) || BLOCKED_MESSAGES[code];
}

/** The suspended account's own panel: what still works, said once, with the ways out. */
export const SUSPENDED_STATE = {
  title: 'This account is suspended',
  detail: 'You can still look at your library, download a copy of your data, sign out or delete your account. Uploads, mixes and plan changes wait until the suspension ends.',
};
