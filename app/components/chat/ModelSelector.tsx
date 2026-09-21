import type { ProviderInfo } from '~/types/model';
import type { ModelInfo } from '~/utils/types';
import { useEffect, useState } from 'react';
import Cookies from 'js-cookie';

interface ModelSelectorProps {
  model?: string;
  setModel?: (model: string) => void;
  provider?: ProviderInfo;
  setProvider?: (provider: ProviderInfo) => void;
  modelList: ModelInfo[];
  providerList: ProviderInfo[];
  apiKeys: Record<string, string>;
}

export const ModelSelector = ({
  model,
  setModel,
  provider,
  setProvider,
  modelList,
  providerList,
}: ModelSelectorProps) => {
  // Load enabled providers from cookies
  const [enabledProviders, setEnabledProviders] = useState(() => {
    const savedProviders = Cookies.get('providers');

    if (savedProviders) {
      try {
        const parsedProviders = JSON.parse(savedProviders);
        if (parsedProviders.OpenAILike === undefined) parsedProviders.OpenAILike = true;
        return providerList.filter((p) => parsedProviders[p.name]);
      } catch (error) {
        console.error('Failed to parse providers from cookies:', error);
        return providerList;
      }
    }

    return providerList;
  });

  // Update enabled providers when cookies change
  useEffect(() => {
    // Function to update providers from cookies
    const updateProvidersFromCookies = () => {
      const savedProviders = Cookies.get('providers');

      if (savedProviders) {
        try {
          const parsedProviders = JSON.parse(savedProviders);
          if (parsedProviders.OpenAILike === undefined) parsedProviders.OpenAILike = true;
          const newEnabledProviders = providerList.filter((p) => parsedProviders[p.name]);
          setEnabledProviders(newEnabledProviders);

          // If current provider is disabled, switch to first enabled provider
          if (provider && !parsedProviders[provider.name] && newEnabledProviders.length > 0) {
            const firstEnabledProvider = newEnabledProviders[0];
            setProvider?.(firstEnabledProvider);

            // Also update the model to the first available one for the new provider
            const firstModel = modelList.find((m) => m.provider === firstEnabledProvider.name);

            if (firstModel) {
              setModel?.(firstModel.name);
            }
          }
        } catch (error) {
          console.error('Failed to parse providers from cookies:', error);
        }
      }
    };

    // Initial update
    updateProvidersFromCookies();

    // Set up an interval to check for cookie changes
    const interval = setInterval(updateProvidersFromCookies, 1000);

    return () => clearInterval(interval);
  }, [providerList, provider, setProvider, modelList, setModel]);

  if (enabledProviders.length === 0) {
    return (
      <div
        style={{ borderRadius: 0 }}
        className="mb-1.5 p-2 border border-purple-500/40 bg-[#130b22] text-purple-200 text-xs"
      >
        <p className="text-center">
          No AI providers enabled. Click the gear icon to configure providers or API keys.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{ borderRadius: 0 }}
      className="mb-1.5 flex gap-2 flex-col sm:flex-row p-1.5 bg-[#140b24]/95 border border-purple-500/40 shadow-sm items-center"
    >
      <div className="flex items-center gap-1.5 flex-1 min-w-0 w-full">
        <span className="text-[10.5px] font-bold text-purple-300 uppercase tracking-wider flex-shrink-0">
          Provider:
        </span>
        <select
          value={provider?.name ?? ''}
          onChange={(e) => {
            const newProvider = enabledProviders.find((p: ProviderInfo) => p.name === e.target.value);

            if (newProvider && setProvider) {
              setProvider(newProvider);
            }

            const firstModel = [...modelList].find((m) => m.provider === e.target.value);

            if (firstModel && setModel) {
              setModel(firstModel.name);
            }
          }}
          style={{ borderRadius: 0 }}
          className="flex-1 py-1 px-2 border border-purple-400/30 bg-[#1a0e2e] text-purple-100 text-xs focus:outline-none focus:border-[#c084fc] transition-colors"
        >
          {enabledProviders.map((provider: ProviderInfo) => (
            <option key={provider.name} value={provider.name} className="bg-[#1a0e2e] text-white">
              {provider.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1.5 flex-1 min-w-0 w-full">
        <span className="text-[10.5px] font-bold text-purple-300 uppercase tracking-wider flex-shrink-0">
          Model:
        </span>
        <select
          key={provider?.name}
          value={model}
          onChange={(e) => setModel?.(e.target.value)}
          style={{ borderRadius: 0 }}
          className="flex-1 py-1 px-2 border border-purple-400/30 bg-[#1a0e2e] text-purple-100 text-xs focus:outline-none focus:border-[#c084fc] transition-colors"
        >
          {[...modelList]
            .filter((e) => e.provider == provider?.name && e.name)
            .map((modelOption, index) => (
              <option key={index} value={modelOption.name} className="bg-[#1a0e2e] text-white">
                {modelOption.label}
              </option>
            ))}
        </select>
      </div>
    </div>
  );
};
