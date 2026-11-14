import { Account, featureOn } from './api';

export function StorageMeter({ account }: { account: Account }) {
  return <section className="cloud-card cloud-meter-card" aria-label="Local music storage">
    <p className="cloud-eyebrow">YOUR MUSIC</p>
    <h2>On your device, not billed by GB</h2>
    <p>Cloud does not store your recordings. Available music, storage and output readiness
      are checked on the device holding the files, not inferred from your account.</p>
    {account.entitlement.plan_version !== 2 && <p>Historical plan and storage records
      remain for subscription reconciliation; they do not limit local playback.</p>}
  </section>;
}

export function Meters({ account }: { account: Account }) {
  const usage = account.usage;
  return <div className="cloud-meters">
    <StorageMeter account={account} />
    <section className="cloud-card cloud-meter-card" aria-label="Local processing">
      <p className="cloud-eyebrow">LOCAL PROCESSING</p>
      <h2>No Cloud CPU or render quota</h2>
      <p>Local analysis, stems, mixes, renders and file exports run on your device.
        Device memory, battery, rights and supported formats still matter.</p>
    </section>
    {featureOn(account, 'lucy') && <section className="cloud-card cloud-meter-card" aria-label="Hosted Lucy usage">
      <p className="cloud-eyebrow">HOSTED AI</p>
      <h2>{usage ? `${usage.lucy_turns_month.used} turns this month` : 'Usage tracked on Selecta Cloud'}</h2>
      <p>Approved metadata-only AI planning has separate spend and request safeguards.
        No recordings or raw audio are sent to hosted models.</p>
    </section>}
  </div>;
}
