import type { Message } from 'ai';
import { toast } from 'react-toastify';
import React from 'react';
import { ImportFolderButton } from '~/components/chat/ImportFolderButton';

export function ImportButtons(importChat: ((description: string, messages: Message[]) => Promise<void>) | undefined) {
  return (
    <div className="flex flex-col items-center justify-center w-auto">
      <input
        type="file"
        id="chat-import"
        className="hidden"
        accept=".json"
        onChange={async (e) => {
          const file = e.target.files?.[0];

          if (file && importChat) {
            try {
              const reader = new FileReader();

              reader.onload = async (e) => {
                try {
                  const content = e.target?.result as string;
                  const data = JSON.parse(content);

                  if (!Array.isArray(data.messages)) {
                    toast.error('Invalid chat file format');
                  }

                  await importChat(data.description, data.messages);
                  toast.success('Chat imported successfully');
                } catch (error: unknown) {
                  if (error instanceof Error) {
                    toast.error('Failed to parse chat file: ' + error.message);
                  } else {
                    toast.error('Failed to parse chat file');
                  }
                }
              };
              reader.onerror = () => toast.error('Failed to read chat file');
              reader.readAsText(file);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Failed to import chat');
            }
            e.target.value = ''; // Reset file input
          } else {
            toast.error('Something went wrong');
          }
        }}
      />
      <div className="flex flex-col items-center gap-4 max-w-2xl text-center">
        <div className="flex gap-2">
          <button
            onClick={() => {
              const input = document.getElementById('chat-import');
              input?.click();
            }}
            style={{ borderRadius: 0 }}
            className="px-3 py-1.5 border border-cyan-500/40 bg-[#161f30] hover:bg-[#1f2b42] text-cyan-300 transition-all flex items-center gap-2 cursor-pointer text-xs font-bold shadow-sm active:translate-y-0.5"
          >
            <div className="i-ph:upload-simple text-cyan-400 text-sm" />
            Import Chat
          </button>
          <ImportFolderButton
            importChat={importChat}
            className="px-3 py-1.5 border border-emerald-500/40 bg-[#161f30] hover:bg-[#1f2b42] text-emerald-300 transition-all flex items-center gap-2 cursor-pointer text-xs font-bold shadow-sm active:translate-y-0.5"
          />
        </div>
      </div>
    </div>
  );
}
