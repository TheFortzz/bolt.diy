import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/components/chat/Markdown', () => ({
  Markdown: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock('~/components/chat/Artifact', () => ({
  Artifact: ({ messageId }: { messageId: string }) => <div data-testid="artifact" data-id={messageId} />,
}));

import { AssistantMessage } from '~/components/chat/AssistantMessage';

describe('AssistantMessage', () => {
  it('extracts <think> tags into a collapsible thought process and shows clean text', () => {
    const markup = renderToStaticMarkup(
      <AssistantMessage
        content="<think>Planning the 3D car game with Three.js</think>Here is your new 3D car game!"
      />,
    );

    expect(markup).toContain('Thought process');
    expect(markup).toContain('Here is your new 3D car game!');
    expect(markup).not.toContain('<think>');
    expect(markup).not.toContain('</think>');
  });

  it('shows cooking status indicator while streaming thoughts', () => {
    const markup = renderToStaticMarkup(
      <AssistantMessage content="<think>Analyzing road curvature and vehicle physics" isStreaming={true} />,
    );

    expect(markup).toContain('Preheating the arcade');
    expect(markup).not.toContain('<think>');
  });

  it('extracts /* DESIGN PLAN: ... */ comment blocks into thought process', () => {
    const markup = renderToStaticMarkup(
      <AssistantMessage
        content="/* DESIGN PLAN:\n1. KEEP: render()\n2. NEW: nitroBoost()\n*/\nI added nitro boost to your car!"
      />,
    );

    expect(markup).toContain('Thought process');
    expect(markup).toContain('I added nitro boost to your car!');
    expect(markup).not.toContain('/* DESIGN PLAN:');
  });

  it('strips leaked raw boltAction and boltArtifact tags so code is not dumped into text', () => {
    const markup = renderToStaticMarkup(
      <AssistantMessage
        content="<boltArtifact id='test' title='Game'><boltAction type='file' filePath='game.js'>console.log('leaked code');</boltAction></boltArtifact>Game updated successfully!"
      />,
    );

    expect(markup).toContain('Game updated successfully!');
    expect(markup).not.toContain("console.log('leaked code');");
    expect(markup).not.toContain('<boltAction');
    expect(markup).not.toContain('</boltArtifact>');
  });

  it('strips raw JavaScript statements, diagnostics, and code fences so code never appears in chat', () => {
    const rawCodeLeak = `window.__GAME_DIAGNOSTICS__ = {ready:true, simulationSteps:0, inputsHandled:0, restartCount:0, resizeCount:0, gameState:'menu'};
const canvas = document.getElementById('game-canvas') || document.querySelector('canvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const lerp = (a,b,t) => a+(b-a)*t;
function update() { requestAnimationFrame(update); }
Built Neon Highway with responsive driving and boost!`;

    const markup = renderToStaticMarkup(<AssistantMessage content={rawCodeLeak} />);

    expect(markup).toContain('Built Neon Highway with responsive driving and boost!');
    expect(markup).not.toContain('window.__GAME_DIAGNOSTICS__');
    expect(markup).not.toContain('const canvas');
    expect(markup).not.toContain('const clamp');
    expect(markup).not.toContain('requestAnimationFrame');
  });

  it('renders nothing in chat bubble when the entire assistant turn consists of leaked code', () => {
    const onlyCode = `window.__GAME_DIAGNOSTICS__ = {ready:true, simulationSteps:0};
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');`;

    const markup = renderToStaticMarkup(<AssistantMessage content={onlyCode} />);

    expect(markup).not.toContain('data-testid="markdown"');
    expect(markup).not.toContain('window.__GAME_DIAGNOSTICS__');
  });
});
