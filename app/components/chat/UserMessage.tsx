import { MODEL_REGEX, PROVIDER_REGEX, STUDIO_MODE_REGEX } from '~/utils/constants';
import { Markdown } from './Markdown';

interface UserMessageProps {
  content: string | Array<{ type: string; text?: string; image?: string }>;
  annotations?: unknown[];
}

export function UserMessage({ content, annotations }: UserMessageProps) {
  const prompt = annotations?.find(
    (annotation): annotation is { type: string; text: string } =>
      typeof annotation === 'object' &&
      annotation !== null &&
      'type' in annotation &&
      annotation.type === 'user-prompt' &&
      'text' in annotation &&
      typeof annotation.text === 'string',
  )?.text;

  if (Array.isArray(content)) {
    const textItem = content.find((item) => item.type === 'text');
    const textContent = prompt ?? sanitizeUserMessage(textItem?.text || '');
    const images = content.filter((item) => item.type === 'image' && item.image);

    return (
      <div className="overflow-hidden pt-[2px] bg-transparent">
        <div className="flex flex-col items-start gap-3">
          <div className="w-full min-w-0">
            <Markdown limitedMarkdown>{textContent}</Markdown>
          </div>
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 w-full">
              {images.map((item, index) => (
                <div key={index} className="relative">
                  <img
                    src={item.image}
                    alt={`Uploaded image ${index + 1}`}
                    className="max-w-full w-[120px] h-[120px] rounded-lg object-cover border border-bolt-elements-borderColor"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const textContent = prompt ?? sanitizeUserMessage(content);

  return (
    <div className="overflow-hidden pt-[2px] bg-transparent">
      <Markdown limitedMarkdown>{textContent}</Markdown>
    </div>
  );
}

function sanitizeUserMessage(content: string) {
  return content.replace(MODEL_REGEX, '').replace(PROVIDER_REGEX, '').replace(STUDIO_MODE_REGEX, '').trim();
}
