import { useCallback, useState } from 'react';
import { Action } from '../ui/controls';
import { SettingsCard } from './AccountLayout';
import { CloudError, type Account } from './api';
import { RightsStatement } from './RightsStatement';
import { approveMusicMigration } from './approvedMusicMigration';
import { agreeToRights, refusalCode, rightsAsked, type Request, type UploadRights } from './uploadConsent';

type Mode = 'device' | 'cloud';

export function MusicStorageSettings({ account, request, onChanged }: {
  account: Account;
  request: Request;
  onChanged: () => Promise<void>;
}) {
  const storage = account.experience?.music_storage;
  const [rights, setRights] = useState<UploadRights | null>(null);
  const [changedRights, setChangedRights] = useState(false);
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const [copyConnected, setCopyConnected] = useState(false);
  const rightsRequest: Request = useCallback(<T,>(path: string, init?: RequestInit) => request<T>(path.replace(/^\/api(?=\/)/, ''), init), [request]);
  if (!storage || account.workspace.role !== 'owner' || (account.workspace.kind && account.workspace.kind !== 'personal') || account.user.suspended) return null;
  const allowCloud = account.experience?.hosted === true && account.features['cloud.hosted_media'] !== false;

  const change = async (mode: Mode) => {
    setSaving(true);
    setProblem('');
    try {
      const next = await request<{ mode: Mode; revision: number }>('/account/music-storage', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode, revision: storage.revision }),
      });
      if (next.mode === 'cloud' && copyConnected) approveMusicMigration(account.workspace.id, next.revision);
      setRights(null);
      await onChanged();
    } catch (error) {
      const required = mode === 'cloud' ? rightsAsked(error) : null;
      if (required) setRights(required);
      else {
        setProblem(error instanceof CloudError ? error.message : 'SelectaDJ could not switch music storage. Try again.');
        if (refusalCode(error) === 'storage_mode_changed') await onChanged();
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsCard id="cloud-music-storage" title="Music storage" about={
      storage.mode === 'cloud' ? 'Your workspace uses its cloud library.'
        : storage.mode === 'device' ? 'Your workspace keeps audio on its devices.'
          : 'Choose where this workspace keeps its music.'
    }>
      <p>On this device plays and mixes files locally. Cloud storage uploads selected music to your private cloud library. If this device already has connected music, you can review it for upload in Library.</p>
      {storage.mode === 'cloud' && <p>You can restore copies of your Cloud songs after switching to on-device storage.</p>}
      {storage.mode !== 'cloud' && allowCloud && <label>
        <input type="checkbox" checked={copyConnected} disabled={saving} onChange={(event) => setCopyConnected(event.target.checked)} />
        Upload my connected music on this device after switching
      </label>}
      {rights && <RightsStatement rights={rights} changed={changedRights} onAgree={async () => {
        const answer = await agreeToRights(rightsRequest, rights);
        setChangedRights(answer.changed);
        if (!answer.rights.accepted) {
          setRights(answer.rights);
          return;
        }
        setRights(null);
        return change('cloud');
      }} />}
      <div className="acct-row-actions">
        {storage.mode !== 'device' && <Action type="button" disabled={saving} run={() => change('device')} working="Switching…">Use on-device storage</Action>}
        {storage.mode !== 'cloud' && allowCloud && !rights && <Action type="button" disabled={saving} run={() => change('cloud')} working="Switching…">Use Cloud storage</Action>}
      </div>
      {problem && <p className="cloud-inline-error" role="alert">{problem}</p>}
    </SettingsCard>
  );
}
