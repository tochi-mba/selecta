import { FormEvent, useId, useState } from 'react';
import { lucy } from '../lucy/client';
import type { Budgets, LucyStatus, PhaseName, Phases, ProviderKind, SettingsChange } from '../lucy/types';
import { LucyMemory } from './LucyMemory';

/** Lucy's settings. The built-in planner runs on this computer and sends nothing anywhere. An AI
 * service can only be chosen after agreeing to exactly what would be sent to it. An API key can be
 * typed in but is never shown back: the page only knows whether one is saved. */

const PROVIDERS: { kind: ProviderKind; label: string; about: string }[] = [
  { kind: 'builtin', label: 'Built-in (on this computer, no AI service)', about: 'Plans with Selecta’s own rules. Nothing leaves this computer.' },
  { kind: 'anthropic', label: 'Anthropic', about: 'Uses Anthropic’s AI service with your own API key.' },
  { kind: 'openai', label: 'OpenAI-compatible (OpenAI, Ollama, LM Studio…)', about: 'Any service that speaks the OpenAI format, including ones running on your own machine.' },
];

const PHASES: { name: PhaseName; label: string; about: string }[] = [
  { name: 'chat', label: 'Chat', about: 'Talk to Lucy about mixes.' },
  { name: 'proposals', label: 'Proposals', about: 'Lucy plans a mix you can look over.' },
  { name: 'commit', label: 'Saving drafts', about: 'Approved proposals can be saved, and played if you confirm.' },
  { name: 'memory', label: 'Memory and history', about: 'Lucy remembers what you tell it and what you listen to.' },
  { name: 'voice', label: 'Voice input', about: 'Speak instead of typing, where this browser can.' },
];

const BUDGETS: { name: Exclude<keyof Budgets, 'spend_cap_usd' | 'max_output_tokens'>; label: string; help: string }[] = [
  { name: 'max_cycles', label: 'Most rounds of thinking per request', help: 'How many times Lucy may go back to the AI for one request.' },
  { name: 'max_steps', label: 'Most steps per request', help: 'Searches, checks and plans Lucy may run for one request.' },
  { name: 'max_seconds', label: 'Most seconds per request', help: 'Lucy stops and tells you if it runs longer.' },
];

const whole = (text: string) => {
  const value = Number(text);
  return Number.isInteger(value) && value > 0 ? value : null;
};

export function LucySettings({ status, onSaved }: { status: LucyStatus; onSaved: (status: LucyStatus) => void }) {
  const ids = useId();
  const [enabled, setEnabled] = useState(status.enabled);
  const [phases, setPhases] = useState<Phases>(status.phases);
  const [kind, setKind] = useState<ProviderKind>(status.provider.kind);
  const [model, setModel] = useState(status.provider.model ?? '');
  const [baseUrl, setBaseUrl] = useState(status.provider.base_url ?? '');
  const [apiKey, setApiKey] = useState('');
  const [consent, setConsent] = useState(status.provider.consented);
  const [budgets, setBudgets] = useState<Record<string, string>>({
    max_cycles: String(status.budgets.max_cycles),
    max_steps: String(status.budgets.max_steps),
    max_seconds: String(status.budgets.max_seconds),
    spend_cap_usd: status.budgets.spend_cap_usd === null ? '' : String(status.budgets.spend_cap_usd),
  });
  const [privacy, setPrivacy] = useState({ share_lyrics: status.privacy.share_lyrics, share_history: status.privacy.share_history });
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');

  const remote = kind !== 'builtin';
  const sameProvider = kind === status.provider.kind;
  const invalid = BUDGETS.filter((budget) => whole(budgets[budget.name]) === null).map((budget) => budget.label);
  const cap = budgets.spend_cap_usd.trim();
  const capValue = cap ? Number(cap) : null;
  const capInvalid = cap !== '' && (!Number.isFinite(capValue) || (capValue ?? 0) < 0);
  const needsConsent = remote && !consent;
  const sent = status.privacy.data_classes.filter((item) => item.sent);
  const kept = status.privacy.data_classes.filter((item) => !item.sent);

  const chooseProvider = (next: ProviderKind) => {
    setKind(next);
    // agreeing to send things to one service isn't agreeing for another
    setConsent(next === status.provider.kind ? status.provider.consented : false);
    setSaved('');
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || invalid.length || capInvalid || needsConsent) return;
    setSaving(true);
    setProblem('');
    setSaved('');
    const change: SettingsChange = {
      enabled,
      phases,
      budgets: {
        max_cycles: whole(budgets.max_cycles) ?? undefined,
        max_steps: whole(budgets.max_steps) ?? undefined,
        max_seconds: whole(budgets.max_seconds) ?? undefined,
        spend_cap_usd: capValue,
      },
      privacy,
      provider: { kind, ...(remote ? { model: model.trim(), base_url: baseUrl.trim(), consent } : {}), ...(apiKey ? { api_key: apiKey } : {}) },
    };
    try {
      const next = await lucy.saveSettings(change);
      setApiKey('');
      setSaved('Saved.');
      onSaved(next);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lucy-settings">
      <form onSubmit={(event) => void save(event)}>
        <fieldset>
          <legend>Lucy</legend>
          <label className="choice">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            Use Lucy
          </label>
          <p className="hint">Turning Lucy off never changes Make a Mix, your mixes or your music.</p>
          {PHASES.map((phase) => (
            <label key={phase.name} className="choice lucy-setting-line">
              <input type="checkbox" checked={phases[phase.name]} disabled={!enabled} onChange={(event) => setPhases({ ...phases, [phase.name]: event.target.checked })} />
              <span><b>{phase.label}</b> <span className="soft">{phase.about}</span></span>
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>Who does the planning</legend>
          {PROVIDERS.map((provider) => (
            <label key={provider.kind} className="choice lucy-setting-line">
              <input type="radio" name={`${ids}-provider`} checked={kind === provider.kind} onChange={() => chooseProvider(provider.kind)} />
              <span><b>{provider.label}</b> <span className="soft">{provider.about}</span></span>
            </label>
          ))}
          {remote && (
            <div className="lucy-provider-fields">
              <div className="field">
                <label htmlFor={`${ids}-model`}>Model</label>
                <input id={`${ids}-model`} value={model} onChange={(event) => setModel(event.target.value)} autoComplete="off" spellCheck={false} />
              </div>
              <div className="field">
                <label htmlFor={`${ids}-url`}>Address {kind === 'anthropic' ? '(optional)' : ''}</label>
                <input id={`${ids}-url`} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={kind === 'openai' ? 'For example http://localhost:11434/v1' : ''} autoComplete="off" spellCheck={false} inputMode="url" />
              </div>
              <div className="field">
                <label htmlFor={`${ids}-key`}>API key</label>
                <input id={`${ids}-key`} type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" spellCheck={false}
                  placeholder={sameProvider && status.provider.key_set ? 'Key saved. Type a new one to replace it.' : ''} aria-describedby={`${ids}-key-help`} />
                <p id={`${ids}-key-help`} className="field-help">{sameProvider && status.provider.key_set ? 'Key saved. It’s never shown here again.' : 'Saved on this computer and never shown here again.'}</p>
              </div>
              <div className="lucy-consent">
                <p><b>What would be sent to this service</b></p>
                {sent.length ? <ul>{sent.map((item) => <li key={item.id}>{item.label}</li>)}</ul> : <p className="hint">Selecta hasn’t said yet. Save to see the list.</p>}
                {kept.length > 0 && <p className="hint">Never sent: {kept.map((item) => item.label).join(', ')}.</p>}
                <label className="choice">
                  <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                  I agree to send exactly this to {PROVIDERS.find((provider) => provider.kind === kind)?.label ?? 'this service'}
                </label>
              </div>
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend>Limits for each request</legend>
          {BUDGETS.map((budget) => (
            <div className="field" key={budget.name}>
              <label htmlFor={`${ids}-${budget.name}`}>{budget.label}</label>
              <input id={`${ids}-${budget.name}`} type="number" min={1} step={1} inputMode="numeric" value={budgets[budget.name]}
                onChange={(event) => setBudgets({ ...budgets, [budget.name]: event.target.value })} aria-invalid={whole(budgets[budget.name]) === null || undefined} />
              <p className="field-help">{budget.help}</p>
            </div>
          ))}
          <div className="field">
            <label htmlFor={`${ids}-cap`}>Spending limit in US dollars (optional)</label>
            <input id={`${ids}-cap`} type="number" min={0} step="0.01" inputMode="decimal" value={budgets.spend_cap_usd}
              onChange={(event) => setBudgets({ ...budgets, spend_cap_usd: event.target.value })} aria-invalid={capInvalid || undefined} />
            <p className="field-help">Only applies to a paid AI service. Leave it empty for no limit.</p>
          </div>
        </fieldset>

        <fieldset>
          <legend>Privacy</legend>
          <label className="choice lucy-setting-line">
            <input type="checkbox" checked={privacy.share_lyrics} onChange={(event) => setPrivacy({ ...privacy, share_lyrics: event.target.checked })} />
            <span><b>Share short lyric snippets</b> <span className="soft">with an AI service, when it helps match words between songs.</span></span>
          </label>
          <label className="choice lucy-setting-line">
            <input type="checkbox" checked={privacy.share_history} onChange={(event) => setPrivacy({ ...privacy, share_history: event.target.checked })} />
            <span><b>Share a summary of your listening</b> <span className="soft">with an AI service: most played and most skipped, never a full log.</span></span>
          </label>
        </fieldset>

        {invalid.length > 0 && <p className="warn">Use a whole number above zero for: {invalid.join(', ')}.</p>}
        {capInvalid && <p className="warn">The spending limit has to be a number of dollars, or empty.</p>}
        {needsConsent && <p className="warn">Tick the box to agree to what’s sent, or choose the built-in planner.</p>}
        {problem && <p className="warn" role="alert">{problem}</p>}
        <div className="row wrap">
          <button type="submit" className="primary" disabled={saving || !!invalid.length || capInvalid || needsConsent} aria-busy={saving || undefined}>{saving ? 'Saving…' : 'Save settings'}</button>
          {saved && <span className="hint" role="status">{saved}</span>}
        </div>
      </form>
      {status.enabled && (
        <LucyMemory onStatus={(next) => {
          setPhases((was) => ({ ...was, memory: next.phases.memory }));
          onSaved(next);
        }} />
      )}
    </div>
  );
}
