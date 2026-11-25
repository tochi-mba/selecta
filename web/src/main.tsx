import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RuntimeApp } from './RuntimeApp';
import { captureInstallPrompt } from './cloud/install';
import { Section } from './ui/controls';
import { listenForStaleBuilds, UpdateLine } from './ui/staleBuild';
import './styles/tokens.css';
import './styles/boot.css';
import './style.css';
import './styles/shell.css';
import './styles/polish.css';
import './styles/foundation.css';
import './styles/cloud-ui.css';
import './styles/cloud-shell.css';
import './styles/listening.css';
import './styles/creation.css';
import './styles/operations.css';
import './styles/music-objects.css';
import './styles/glossary.css';
import './styles/palette.css';
import './styles/icons.css';
import './styles/depth.css';
import './styles/feel.css';
import './styles/feel-scene.css';
import './styles/feel-music.css';
import './styles/typography.css';

// The browser's install offer can arrive before any page has loaded, so it is kept from the start.
captureInstallPrompt();
// A page file a deploy removed is caught and said calmly, never a blank page (ui/staleBuild.tsx).
listenForStaleBuilds();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* the outermost frame: a crash with nothing above it still shows a page with a way out */}
    <Section name="SelectaDJ" whole>
      <RuntimeApp />
    </Section>
    <UpdateLine />
  </StrictMode>,
);
