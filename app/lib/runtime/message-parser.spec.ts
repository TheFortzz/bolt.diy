import { describe, expect, it, vi } from 'vitest';
import { StreamingMessageParser, type ActionCallback, type ArtifactCallback } from './message-parser';

interface ExpectedResult {
  output: string;
  callbacks?: {
    onArtifactOpen?: number;
    onArtifactClose?: number;
    onActionOpen?: number;
    onActionClose?: number;
  };
}

describe('StreamingMessageParser', () => {
  it('should pass through normal text', () => {
    const parser = new StreamingMessageParser();
    expect(parser.parse('test_id', 'Hello, world!')).toBe('Hello, world!');
  });

  it('should allow normal HTML tags', () => {
    const parser = new StreamingMessageParser();
    expect(parser.parse('test_id', 'Hello <strong>world</strong>!')).toBe('Hello <strong>world</strong>!');
  });

  describe('no artifacts', () => {
    it.each<[string | string[], ExpectedResult | string]>([
      ['Foo bar', 'Foo bar'],
      ['Foo bar <', 'Foo bar '],
      ['Foo bar <p', 'Foo bar <p'],
      [['Foo bar <', 's', 'p', 'an>some text</span>'], 'Foo bar <span>some text</span>'],
    ])('should correctly parse chunks and strip out bolt artifacts (%#)', (input, expected) => {
      runTest(input, expected);
    });
  });

  describe('invalid or incomplete artifacts', () => {
    it.each<[string | string[], ExpectedResult | string]>([
      ['Foo bar <b', 'Foo bar '],
      ['Foo bar <ba', 'Foo bar <ba'],
      ['Foo bar <bol', 'Foo bar '],
      ['Foo bar <bolt', 'Foo bar '],
      ['Foo bar <bolta', 'Foo bar <bolta'],
      ['Foo bar <boltA', 'Foo bar '],
      ['Foo bar <boltArtifacs></boltArtifact>', 'Foo bar <boltArtifacs></boltArtifact>'],
      ['Before <oltArtfiact>foo</boltArtifact> After', 'Before <oltArtfiact>foo</boltArtifact> After'],
      ['Before <boltArtifactt>foo</boltArtifact> After', 'Before <boltArtifactt>foo</boltArtifact> After'],
    ])('should correctly parse chunks and strip out bolt artifacts (%#)', (input, expected) => {
      runTest(input, expected);
    });
  });

  describe('valid artifacts without actions', () => {
    it.each<[string | string[], ExpectedResult | string]>([
      [
        'Some text before <boltArtifact title="Some title" id="artifact_1">foo bar</boltArtifact> Some more text',
        {
          output: 'Some text before  Some more text',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 0, onActionClose: 0 },
        },
      ],
      [
        [
          'Some text before <boltArti',
          'fact',
          ' title="Some title" id="artifact_1" type="bundled" >foo</boltArtifact> Some more text',
        ],
        {
          output: 'Some text before  Some more text',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 0, onActionClose: 0 },
        },
      ],
      [
        [
          'Some text before <boltArti',
          'fac',
          't title="Some title" id="artifact_1"',
          ' ',
          '>',
          'foo</boltArtifact> Some more text',
        ],
        {
          output: 'Some text before  Some more text',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 0, onActionClose: 0 },
        },
      ],
      [
        [
          'Some text before <boltArti',
          'fact',
          ' title="Some title" id="artifact_1"',
          ' >fo',
          'o</boltArtifact> Some more text',
        ],
        {
          output: 'Some text before  Some more text',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 0, onActionClose: 0 },
        },
      ],
      [
        [
          'Some text before <boltArti',
          'fact tit',
          'le="Some ',
          'title" id="artifact_1">fo',
          'o',
          '<',
          '/boltArtifact> Some more text',
        ],
        {
          output: 'Some text before  Some more text',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 0, onActionClose: 0 },
        },
      ],
      [
        [
          'Some text before <boltArti',
          'fact title="Some title" id="artif',
          'act_1">fo',
          'o<',
          '/boltArtifact> Some more text',
        ],
        {
          output: 'Some text before  Some more text',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 0, onActionClose: 0 },
        },
      ],
      [
        'Before <boltArtifact title="Some title" id="artifact_1">foo</boltArtifact> After',
        {
          output: 'Before  After',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 0, onActionClose: 0 },
        },
      ],
    ])('should correctly parse chunks and strip out bolt artifacts (%#)', (input, expected) => {
      runTest(input, expected);
    });
  });

  describe('streaming file actions', () => {
    it('should send cumulative content while a file is being written', () => {
      const snapshots: string[] = [];
      const parser = new StreamingMessageParser({
        artifactElement: () => '',
        callbacks: {
          onActionStream: (data) => {
            snapshots.push(data.action.content);
          },
        },
      });

      let message = '';
      for (const chunk of [
        '<boltArtifact id="demo" title="Demo"><boltAction type="file" filePath="src/demo.js">const value',
        ' = 42;',
        '</boltAction></boltArtifact>',
      ]) {
        message += chunk;
        parser.parse('stream-message', message);
      }

      expect(snapshots).toEqual(['const value', 'const value = 42;']);
    });

    it('normalizes project/ and home/ prefixes in file actions', () => {
      let openedFilePath: string | undefined;
      const parser = new StreamingMessageParser({
        callbacks: {
          onActionOpen: (data) => {
            if (data.action.type === 'file') {
              openedFilePath = data.action.filePath;
            }
          },
        },
      });

      parser.parse(
        'msg-1',
        '<boltArtifact id="a1" title="Demo"><boltAction type="file" filePath="projects/game.js">console.log(1);</boltAction></boltArtifact>',
      );

      expect(openedFilePath).toBe('game.js');
    });
  });

  describe('valid artifacts with actions', () => {
    it.each<[string | string[], ExpectedResult | string]>([
      [
        'Before <boltArtifact title="Some title" id="artifact_1"><boltAction type="shell">npm install</boltAction></boltArtifact> After',
        {
          output: 'Before  After',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 1, onActionClose: 1 },
        },
      ],
      [
        'Before <boltArtifact title="Some title" id="artifact_1"><boltAction type="shell">npm install</boltAction><boltAction type="file" filePath="index.js">some content</boltAction></boltArtifact> After',
        {
          output: 'Before  After',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 2, onActionClose: 2 },
        },
      ],
    ])('should correctly parse chunks and strip out bolt artifacts (%#)', (input, expected) => {
      runTest(input, expected);
    });
  });

  describe('finalize', () => {
    it('should close unclosed action and artifact on finalize', () => {
      const onArtifactOpen = vi.fn();
      const onArtifactClose = vi.fn();
      const onActionOpen = vi.fn();
      const onActionClose = vi.fn();

      const parser = new StreamingMessageParser({
        callbacks: {
          onArtifactOpen,
          onArtifactClose,
          onActionOpen,
          onActionClose,
        },
      });

      const message =
        '<boltArtifact id="test" title="Test"><boltAction type="file" filePath="index.js">console.log("hello");';
      parser.parse('msg_1', message);

      expect(onArtifactOpen).toHaveBeenCalledTimes(1);
      expect(onActionOpen).toHaveBeenCalledTimes(1);
      expect(onActionClose).toHaveBeenCalledTimes(0);
      expect(onArtifactClose).toHaveBeenCalledTimes(0);

      parser.finalize('msg_1', message);

      expect(onActionClose).toHaveBeenCalledTimes(1);
      expect(onActionClose).toHaveBeenCalledWith({
        artifactId: 'test',
        messageId: 'msg_1',
        actionId: '0',
        action: {
          type: 'file',
          filePath: 'index.js',
          content: 'console.log("hello");\n',
        },
      });

      expect(onArtifactClose).toHaveBeenCalledTimes(1);
      expect(onArtifactClose).toHaveBeenCalledWith({
        id: 'test',
        title: 'Test',
        type: 'bundled',
        messageId: 'msg_1',
      });
    });

    it('should do nothing if artifact is already closed', () => {
      const onArtifactClose = vi.fn();
      const onActionClose = vi.fn();

      const parser = new StreamingMessageParser({
        callbacks: {
          onArtifactClose,
          onActionClose,
        },
      });

      const message =
        '<boltArtifact id="test" title="Test"><boltAction type="shell">echo 1</boltAction></boltArtifact>';
      parser.parse('msg_1', message);

      expect(onArtifactClose).toHaveBeenCalledTimes(1);
      expect(onActionClose).toHaveBeenCalledTimes(1);

      parser.finalize('msg_1', message);

      expect(onArtifactClose).toHaveBeenCalledTimes(1);
      expect(onActionClose).toHaveBeenCalledTimes(1);
    });

    it('should normalize unquoted tag attributes without corrupting JavaScript equality checks', () => {
      const onActionClose = vi.fn();

      const parser = new StreamingMessageParser({
        callbacks: {
          onActionClose,
        },
      });

      const message =
        '<boltArtifact id=test title=Test><boltAction type=file filePath=game.js>if (p.type === "shield") { title = state === "menu"; o.type = 2; }</boltAction></boltArtifact>';
      parser.parse('msg_1', message);

      expect(onActionClose).toHaveBeenCalledTimes(1);
      expect(onActionClose).toHaveBeenCalledWith({
        actionId: '-1',
        artifactId: 'test',
        messageId: 'msg_1',
        action: {
          type: 'file',
          filePath: 'game.js',
          content: 'if (p.type === "shield") { title = state === "menu"; o.type = 2; }\n',
        },
      });
    });
  });
});

function runTest(input: string | string[], outputOrExpectedResult: string | ExpectedResult) {
  let expected: ExpectedResult;

  if (typeof outputOrExpectedResult === 'string') {
    expected = { output: outputOrExpectedResult };
  } else {
    expected = outputOrExpectedResult;
  }

  const callbacks = {
    onArtifactOpen: vi.fn<ArtifactCallback>((data) => {
      expect(data).toMatchSnapshot('onArtifactOpen');
    }),
    onArtifactClose: vi.fn<ArtifactCallback>((data) => {
      expect(data).toMatchSnapshot('onArtifactClose');
    }),
    onActionOpen: vi.fn<ActionCallback>((data) => {
      expect(data).toMatchSnapshot('onActionOpen');
    }),
    onActionClose: vi.fn<ActionCallback>((data) => {
      expect(data).toMatchSnapshot('onActionClose');
    }),
  };

  const parser = new StreamingMessageParser({
    artifactElement: () => '',
    callbacks,
  });

  let message = '';

  let result = '';

  const chunks = Array.isArray(input) ? input : input.split('');

  for (const chunk of chunks) {
    message += chunk;

    result += parser.parse('message_1', message);
  }

  for (const name in expected.callbacks) {
    const callbackName = name;

    expect(callbacks[callbackName as keyof typeof callbacks]).toHaveBeenCalledTimes(
      expected.callbacks[callbackName as keyof typeof expected.callbacks] ?? 0,
    );
  }

  expect(result).toEqual(expected.output);
}
