import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copy, MUSIC_HOME_START, setCopyPlace, setMusicHome, setUploadsFromDevice, UPLOADING_FROM_DEVICE, UPLOADING_FROM_DEVICE_PRIVACY, words } from '../copy';
import { setAccountFeatures } from '../flags';
import type { MediaStore } from '../media';
import { musicHomeCopy } from './api';
import { footerWords } from './hosted/hostedWords';

// Plan "two places" 6e (cloud.move_to_cloud, ADR-0489): only an account that can upload songs
// from this device to its cloud library is told uploads are copies and the file on this device
// stays as it is. Every other account keeps each word as it was.

vi.mock('../media', async (original) => ({
  ...(await original<typeof import('../media')>()),
  findLapsed: async () => [],
  dirPicker: () => ({ supported: false, reason: 'This browser has no folder picker.' }),
  directoryInput: () => ({ supported: false }),
  recallFolder: async () => null,
}));

const { ConnectMusic } = await import('./ConnectMusic');

afterEach(() => {
  setCopyPlace('desktop');
  setMusicHome('cloud_library');
  setUploadsFromDevice(false);
  setAccountFeatures(null);
});

const BOTH = { local_first: true, hosted: true };

describe('the Cloud copy layer', () => {
  it('keeps every word for an account that cannot upload from this device', () => {
    setCopyPlace('cloud');
    setMusicHome('both');
    expect(words().startAudioStays).toBe('Songs you upload stay private to your workspace, and songs on this device stay on it.');
    expect(words().startFolderHelp).toBe(copy.cloud.both.startFolderHelp);
    expect(words().sourcesHelp).toBe(copy.cloud.both.sourcesHelp);
  });

  it('says uploads are copies, and keeps "never moved or changed", for an account that can', () => {
    setCopyPlace('cloud');
    setMusicHome('both');
    setUploadsFromDevice(true);
    expect(words().startAudioStays).toBe(UPLOADING_FROM_DEVICE.startAudioStays);
    expect(words().startAudioStays).toMatch(/copied there.*the file on this device stays as it is/);
    expect(words().startFolderHelp).toContain('Songs you upload to your cloud library are copied there.');
    expect(words().startFolderHelp).toContain('never moved or changed');
    expect(words().sourcesHelp).toContain('the file on this device stays as it is');
    // the rest of the words are as they were
    expect(words().glossaryRender).toBe(copy.cloud.both.glossaryRender);
  });

  it('changes nothing for an account whose music is only on its devices, or on the Desktop app', () => {
    setCopyPlace('cloud');
    setMusicHome('device');
    setUploadsFromDevice(true);
    expect(words().startAudioStays).toBe('Your audio stays on this device.');
    setCopyPlace('desktop');
    expect(words()).toBe(copy.desktop);
  });
});

describe('the start card', () => {
  it('adds that uploads are copies only when the account names cloud.move_to_cloud as on', () => {
    expect(musicHomeCopy({ experience: BOTH }).privacy).toBe(MUSIC_HOME_START.both.privacy);
    expect(musicHomeCopy({ experience: BOTH, features: { 'cloud.move_to_cloud': false } }).privacy).toBe(MUSIC_HOME_START.both.privacy);
    expect(musicHomeCopy({ experience: BOTH, features: { 'cloud.move_to_cloud': true } }).privacy).toBe(UPLOADING_FROM_DEVICE_PRIVACY);
    expect(UPLOADING_FROM_DEVICE_PRIVACY).toContain('Music you connect from this device stays on this device.');
    // a cloud library alone, or device music alone, never changes
    expect(musicHomeCopy({ experience: { local_first: true, hosted: false }, features: { 'cloud.move_to_cloud': true } }).privacy).toBe(MUSIC_HOME_START.device.privacy);
  });
});

describe('the footer', () => {
  it('says the file on the device stays as it is only for a hosted account that can upload', () => {
    expect(footerWords(true)).toBe('SelectaDJ Cloud. Songs you upload are kept privately in your SelectaDJ storage; music you connect on a device stays there.');
    expect(footerWords(false, true)).toBe('SelectaDJ Cloud. Your music files stay on your devices; your account keeps their details.');
    expect(footerWords(true, true)).toContain('the file on your device stays as it is');
  });
});

describe('the empty Library’s Add your music', () => {
  const store = { degraded: false, get: async () => undefined } as unknown as MediaStore;
  const hero = () => render(<ConnectMusic request={vi.fn()} workspaceId="ws-words" openStore={async () => store} variant="hero" />);

  it('keeps "nothing is uploaded" for an account that cannot upload', () => {
    setAccountFeatures({ 'cloud.move_to_cloud': false });
    hero();
    expect(screen.getByText('Choose the folder your songs are in and SelectaDJ turns them into mixes. Your files stay on this device; nothing is uploaded.')).toBeInTheDocument();
  });

  it('says "Connecting uploads nothing." for an account that can', () => {
    setAccountFeatures({ 'cloud.move_to_cloud': true });
    hero();
    expect(screen.getByText('Choose the folder your songs are in and SelectaDJ turns them into mixes. Your files stay on this device. Connecting uploads nothing.')).toBeInTheDocument();
  });
});
