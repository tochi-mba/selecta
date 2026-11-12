import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RuntimeApp } from './RuntimeApp';
import './styles/tokens.css';
import './style.css';
import './styles/shell.css';
import './styles/polish.css';
import './styles/foundation.css';
import './styles/listening.css';
import './styles/creation.css';
import './styles/operations.css';
import './styles/music-objects.css';
import './styles/glossary.css';
import './styles/palette.css';
import './styles/icons.css';
import './styles/depth.css';
import './styles/typography.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RuntimeApp />
  </StrictMode>,
);
