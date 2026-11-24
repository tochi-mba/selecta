import type { AdminPage } from './route';

// The console's help, tours and playbooks (doc 07b §7B.8), typed and kept next to the pages so it
// changes with them. `help.test.ts` fails when a page has no help or no tour.

export type PageHelp = { purpose: string; numbers: [string, string][]; tasks: [string, string][]; runbook: string };
export type TourStep = { target: string; title: string; text: string; needs?: string };
export type Playbook = { id: string; title: string; steps: { text: string; link?: string }[] };

const RUNBOOK = 'https://github.com/tochi-mba/selecta/blob/main/docs/saas/14-operations.md';
const CONSOLE_DOC = 'https://github.com/tochi-mba/selecta/blob/main/docs/saas/07b-admin-console.md';

export const HELP: Record<AdminPage, PageHelp> = {
  overview: {
    purpose: 'Whether SelectaDJ is well, in five seconds: one sentence first, then the few numbers that matter, each with how fresh it is.',
    numbers: [
      ['Fresh, stale, unknown', 'Fresh: measured in the last two minutes. Stale: older than that, so treat it with care. Unknown: nothing has reported it for ten minutes or ever, so the value is hidden rather than guessed.'],
      ['Paying customers and MRR', 'From our copy of Stripe’s subscriptions, kept current by Stripe’s webhooks and the nightly reconcile. Stripe is the source of truth; open Billing to compare.'],
      ['Service health', 'Each service is measured by whatever talks to it. Database health is checked on every refresh; the others report when their integration is connected.'],
    ],
    tasks: [['Something looks wrong', 'Read the sentence at the top, then open the page it names. During an incident, open Emergency.'], ['A number says Unknown', 'Open System: it says which integration feeds it and what to set.']],
    runbook: RUNBOOK,
  },
  customers: {
    purpose: 'Find a customer by email, user or workspace id, Stripe id or an error reference, and help them. Metadata only: never their audio or Lucy prompts.',
    numbers: [['Mode', 'Browser: their music stays on their devices (the default). Cloud storage: the hosted media grant, so they upload to us and we render.'], ['Storage', 'Shown only for Cloud storage accounts, as used of allowed.']],
    tasks: [['Grant time', 'Open the customer, Overview tab, Grant time: pick a plan and how long. It expires by itself.'], ['Sign them out everywhere', 'Open the customer, press Sign out everywhere. They sign in again on every device.'], ['Suspend', 'Dangerous: it needs the email typed and a sign-in from the last 5 minutes.']],
    runbook: `${CONSOLE_DOC}#7b4-pages`,
  },
  billing: {
    purpose: 'Our copy of Stripe against Stripe: subscriptions that disagree, past-due accounts, Stripe events that are stuck, and the price map.',
    numbers: [['Past due', 'Stripe could not take a payment. The customer keeps their plan during grace; Stripe retries on its own schedule.'], ['Stuck event', 'A Stripe webhook we received but have not processed after 15 minutes.']],
    tasks: [['Refund', 'Refunds happen in Stripe’s dashboard: open the customer, Billing tab, Open in Stripe. Add a note here saying why.'], ['A subscription disagrees', 'Open the customer and press Re-sync from Stripe.']],
    runbook: `${RUNBOOK}`,
  },
  jobs: {
    purpose: 'Background work (analysis, renders, exports) and the workers that do it.',
    numbers: [['Staff hold', 'A job held out of line by staff for inspection. Release puts it back.'], ['Attempts', 'How many times a worker has tried it; it stops at its maximum.']],
    tasks: [['Retry a failed job', 'Find it, open it, Retry. Retrying makes new work; nothing to undo.'], ['Drain a worker', 'It finishes running work and claims nothing new; Resume undoes it.']],
    runbook: RUNBOOK,
  },
  ai: {
    purpose: 'Lucy’s model routing per plan, the deployments behind it, spend against the ceiling, and Lucy’s emergency switches.',
    numbers: [['Routing version', 'Each routing change makes a new version that can be rolled back.']],
    tasks: [['Lucy is misbehaving', 'Emergency, Disable Lucy. Every new turn is refused until released (release waits 15 minutes).']],
    runbook: RUNBOOK,
  },
  flags: {
    purpose: 'Feature switches: what each does, its rules, and why a given person sees what they see.',
    numbers: [['Build default', 'What the deployed build says before any rule. Rules can only narrow a flag that the build turned on.']],
    tasks: [['Turn something off for one account', 'Open the customer, Configuration, switch the feature off with a reason.'], ['Change a flag safely', 'Preview it on yourself first, then a small rollout; broad changes wait 15 minutes.']],
    runbook: `${CONSOLE_DOC}#7b7-safety-hard-to-do-harm-by-accident`,
  },
  content: {
    purpose: 'Copyright notices and their deadlines. Acting on a notice hides the song and starts its deletion.',
    numbers: [['Due by', 'When we must have decided. Overdue notices come first.']],
    tasks: [['A takedown arrived', 'Log it with the workspace, song, complainant and work, then Act or Reject with a reason.']],
    runbook: RUNBOOK,
  },
  emergency: {
    purpose: 'Switches for an incident: pause uploads, pause a worker pool, disable Lucy, billing safe mode, read-only, stop sign-ups. Engaging is instant; releasing waits 15 minutes.',
    numbers: [['Engaged', 'In force now, for everyone or one pool.']],
    tasks: [['An incident is happening', 'Engage the narrowest control that stops the harm, publish a status banner, then fix the cause.']],
    runbook: RUNBOOK,
  },
  security: {
    purpose: 'Who is staff and with which role, their admin sessions, the role matrix, the audit log and security alerts.',
    numbers: [['MFA', 'Staff sign in through the WorkOS staff organization, whose policy decides whether two-factor sign-in is required.']],
    tasks: [['Add a staff member', 'Staff, Add staff member: their SelectaDJ email, a role card, an optional expiry, a reason.'], ['Who can suspend accounts?', 'Roles tab: search the permission.']],
    runbook: `${CONSOLE_DOC}#7b6-roles`,
  },
  communications: {
    purpose: 'The status banner every signed-in customer sees: maintenance, incidents, notices.',
    numbers: [['Dismissable', 'Whether a customer can close it. Incidents usually should not be.']],
    tasks: [['Announce maintenance', 'Write the text, pick Maintenance, set start and end, preview, Publish.']],
    runbook: RUNBOOK,
  },
  system: {
    purpose: 'What is deployed, whether the database schema matches the code, which settings are set (never their values), and emergency state.',
    numbers: [['Migration', 'The database’s schema version against the code’s. They must match after a deploy.']],
    tasks: [['A setting is missing', 'Set it in Render’s environment for the API service, then redeploy.']],
    runbook: RUNBOOK,
  },
  pilots: {
    purpose: 'Free business pilots: their use against their allowance and their end date.',
    numbers: [['Allowance', 'Venues and zones the pilot may use.']],
    tasks: [['Extend a pilot', 'Open it, Extend, with a reason.']],
    runbook: RUNBOOK,
  },
};

export const TOURS: Record<AdminPage, TourStep[]> = {
  overview: [
    { target: 'headline', title: 'The state of the service', text: 'One sentence: all normal, or the worst problem first. Read this before anything else.' },
    { target: 'kpis', title: 'The numbers that matter', text: 'Customers, revenue and failures, each with how fresh it is. Click one to see the detail.' },
    { target: 'checklist', title: 'Setup checklist', text: 'Owners only: what to do once before launch. It disappears when it is done.', needs: 'security.owners.assign' },
    { target: 'mode', title: 'View mode', text: 'The console opens read-only. Press Make changes to act; it ends after 15 minutes without a change.' },
    { target: 'search', title: 'Search anything', text: 'Paste an email, an id, a Stripe id or an error reference. Ctrl+K opens the command palette.' },
  ],
  customers: [
    { target: 'customer-search', title: 'Find a customer', text: 'Search by email, user or workspace id, or a Stripe id. The list never loads everyone.' },
    { target: 'customer-table', title: 'Mode, plan and status', text: 'Browser accounts keep music on their devices; Cloud storage accounts store it with us.' },
    { target: 'customer-actions', title: 'Actions', text: 'Grant time, sign out everywhere, suspend. Dangerous ones ask you to type the email.', needs: 'accounts.read_metadata' },
  ],
  billing: [
    { target: 'billing-tabs', title: 'Billing views', text: 'Reconciliation, past due, events, disputes and prices.' },
    { target: 'billing-table', title: 'Problems first', text: 'Rows that disagree with Stripe come first, each saying why.' },
    { target: 'billing-source', title: 'Stripe is the truth', text: 'Refunds and payments happen in Stripe. This page shows our copy.' },
  ],
  jobs: [
    { target: 'job-filters', title: 'Find jobs', text: 'Filter by state and type; the filters stay in the address.' },
    { target: 'job-table', title: 'Open a job', text: 'Attempts, dependencies and errors, with Retry, Hold and Release.' },
    { target: 'workers', title: 'Workers', text: 'Drain or pause a worker; Resume undoes it.' },
  ],
  ai: [
    { target: 'routing', title: 'Routing', text: 'Which model each plan uses, in order of fallback.' },
    { target: 'deployments', title: 'Deployments', text: 'Every model deployment, with a warning when a route names one that is missing.' },
    { target: 'ai-emergency', title: 'Lucy’s switches', text: 'Disable Lucy, or one deployment, during an incident.' },
  ],
  flags: [
    { target: 'flag-explain', title: 'Why does this person see this?', text: 'Paste a user id to see every flag’s answer for them and the rule that decided it.' },
    { target: 'flag-list', title: 'Flags and rules', text: 'Each flag with its build default and rules. Broad changes wait 15 minutes.' },
    { target: 'flag-history', title: 'History and roll back', text: 'Every change is a version you can roll back.' },
  ],
  content: [
    { target: 'notices', title: 'Notices', text: 'Overdue first. Act hides the song and starts its deletion; Reject keeps it.' },
    { target: 'log-notice', title: 'Log a notice', text: 'Record what arrived, with the workspace and the song.', needs: 'legal.takedowns.manage' },
    { target: 'restrictions', title: 'Repeat infringers', text: 'Accounts with uploads restricted after repeated valid notices.' },
  ],
  emergency: [
    { target: 'emergency-state', title: 'What is engaged', text: 'Every control, and whether it is on now.' },
    { target: 'emergency-controls', title: 'Engage', text: 'Instant, alerts every Owner, and you type the control’s name to confirm.' },
    { target: 'emergency-release', title: 'Release', text: 'Waits 15 minutes and can be cancelled, so a mistaken release is caught.' },
  ],
  security: [
    { target: 'staff-list', title: 'Staff', text: 'Everyone with a role, what it is for, and when they last entered the console.' },
    { target: 'add-staff', title: 'Add staff', text: 'Pick a role card; you can only give roles whose powers you hold.', needs: 'security.roles.assign' },
    { target: 'role-matrix', title: 'Role matrix', text: 'Generated from the code, so it is always true. Search a permission to see who has it.' },
    { target: 'audit', title: 'Audit log', text: 'Every staff action and every refusal, searchable and exportable.' },
  ],
  communications: [
    { target: 'banner-current', title: 'What customers see now', text: 'The live banner, if any.' },
    { target: 'banner-form', title: 'Write a banner', text: 'Text, level, start and end, with a live preview.', needs: 'platform.incidents.manage' },
    { target: 'banner-history', title: 'History', text: 'Earlier banners, for the incident record.' },
  ],
  system: [
    { target: 'deploy', title: 'What is deployed', text: 'The API’s commit and the database schema against the code.' },
    { target: 'settings', title: 'Settings', text: 'Each required setting: set or missing. Values are never shown.' },
    { target: 'integrations', title: 'Integrations', text: 'Each outside service: connected or not, and what connecting it unlocks.' },
  ],
  pilots: [
    { target: 'pilots', title: 'Pilots', text: 'Every free pilot with its use and end date.' },
    { target: 'pilot-actions', title: 'Change a pilot', text: 'Extend, change the allowance, convert or end, each with a reason.' },
    { target: 'pilot-new', title: 'New pilot', text: 'Create a pilot organisation with its venues.' },
  ],
};

export const PLAYBOOKS: Playbook[] = [
  { id: 'refund', title: 'Refund a customer', steps: [
    { text: 'Find the customer and open their Billing tab.', link: '/admin/customers' },
    { text: 'Press Open in Stripe; refund the payment there (we never move money ourselves).' },
    { text: 'Back here, add a note on the customer saying what you refunded and why.' }] },
  { id: 'sign-in', title: 'A customer can’t sign in', steps: [
    { text: 'Search their email. If no account appears, they have never finished signing up.', link: '/admin/customers' },
    { text: 'If the account is suspended, read the Activity tab for why before restoring.' },
    { text: 'If they are stuck on an old session, press Sign out everywhere, then ask them to sign in again.' }] },
  { id: 'payment', title: 'A payment failed', steps: [
    { text: 'Billing, Past due: find them and how long they have been past due.', link: '/admin/billing/past_due' },
    { text: 'Stripe retries by itself; the customer keeps their plan during grace.' },
    { text: 'If they ask for more time, Grant time on their record with an expiry.' }] },
  { id: 'incident', title: 'An incident is happening', steps: [
    { text: 'Overview: read the sentence at the top.', link: '/admin/overview' },
    { text: 'Emergency: engage the narrowest control that stops the harm.', link: '/admin/emergency' },
    { text: 'Communications: publish an incident banner.', link: '/admin/communications' },
    { text: 'When fixed, release the control (waits 15 minutes) and end the banner.' }] },
  { id: 'takedown', title: 'A takedown arrived', steps: [
    { text: 'Content: log the notice with workspace, song, complainant and work.', link: '/admin/content' },
    { text: 'Check it is valid, then Act (hides and deletes) or Reject, with a reason. Mind the due date.' }] },
  { id: 'add-staff', title: 'Add a staff member', steps: [
    { text: 'Ask them to sign in to SelectaDJ once, so their account exists.' },
    { text: 'Staff and security, Add staff member: their email, a role card, an expiry if temporary, a reason.', link: '/admin/security/staff' },
    { text: 'Add them to the WorkOS staff organization (until the WorkOS connection does it for you), then they enter the console.' }] },
  { id: 'flag', title: 'Change a flag safely', steps: [
    { text: 'Flags: turn it on for yourself only (preview) and try it.', link: '/admin/flags' },
    { text: 'Roll out to a small percentage; read the impact preview first.' },
    { text: 'Broad changes wait 15 minutes and can be cancelled; History rolls back.' }] },
  { id: 'undo', title: 'Undo a mistake', steps: [
    { text: 'Most changes show Undo for 10 seconds right after.' },
    { text: 'After that, Staff and security, Audit log: find the change; its record page has the opposite action.', link: '/admin/security/audit' },
    { text: 'A waiting dangerous action can be cancelled from the bell until it runs.' }] },
];

/** Plain names for the Overview's measurements, and what feeds each one. */
export const METRICS: Record<string, { name: string; unit?: string; feeds: string }> = {
  'health.api': { name: 'API', feeds: 'The API reports itself on each Overview refresh once the health reporter runs.' },
  'health.postgres': { name: 'Database', feeds: 'Checked on every Overview refresh.' },
  'health.r2': { name: 'File storage (R2)', feeds: 'Reported by the storage maintenance task when R2 is configured.' },
  'health.modal': { name: 'Workers (Modal)', feeds: 'Reported by the autoscaler when Modal is connected.' },
  'health.anthropic': { name: 'AI provider (Anthropic)', feeds: 'Reported by Lucy’s gateway when ANTHROPIC_API_KEY is set and turns run.' },
  'health.stripe_webhooks': { name: 'Stripe webhooks', feeds: 'Reported by the Stripe event task from the age of the newest processed event.' },
  'spend.compute_today_usd': { name: 'Compute today', unit: 'USD', feeds: 'Reported by the worker autoscaler.' },
  'spend.ai_today_usd': { name: 'AI today', unit: 'USD', feeds: 'Reported by Lucy’s gateway ledger.' },
  'spend.storage_today_usd': { name: 'Storage today', unit: 'USD', feeds: 'Reported by the storage maintenance task.' },
  'incidents.open': { name: 'Open incidents', feeds: 'Reported when an incident tool is connected.' },
  'users.active_today': { name: 'Active today', feeds: 'Reported by the session reporter.' },
  'accounts.total': { name: 'Accounts', feeds: 'Counted on each refresh.' },
  'accounts.suspended': { name: 'Suspended accounts', feeds: 'Counted on each refresh.' },
  'jobs.failed_24h': { name: 'Failed jobs (24 h)', feeds: 'Counted on each refresh.' },
  'jobs.quarantined_24h': { name: 'Quarantined jobs (24 h)', feeds: 'Counted on each refresh.' },
  'jobs.held_by_staff': { name: 'Jobs held by staff', feeds: 'Counted on each refresh.' },
  'jobs.waiting': { name: 'Jobs waiting', feeds: 'Counted on each refresh.' },
  'jobs.oldest_eligible_s': { name: 'Oldest waiting job', unit: 's', feeds: 'Counted on each refresh.' },
  'jobs.wait_p95_s': { name: 'Wait, 95th percentile', unit: 's', feeds: 'From the last hour of job starts.' },
  'workers.live': { name: 'Live workers', feeds: 'Workers seen in the last two minutes.' },
  'workers.held': { name: 'Workers held by staff', feeds: 'Counted on each refresh.' },
};
