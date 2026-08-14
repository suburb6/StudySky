import { json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { browserOcrProfiles } from '$lib/domain/browser-ocr-profiles';
import { isOcrCapability, type AvailableOcrProvider } from '$lib/domain/ocr-providers';
import { formulaRecognitionStatus } from '$lib/server/formula-recognition';
import { parseOcrCapabilities, parseOcrLanguages } from '$lib/server/custom-ocr-provider';
import { getDatabase } from '$lib/server/db';
import { ocrProviders } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.user) return json({ error: 'Authentication required.' }, { status: 401 });
  const requestedCapability = url.searchParams.get('capability');
  if (requestedCapability && !isOcrCapability(requestedCapability)) {
    return json({ error: 'Unknown OCR capability.' }, { status: 400 });
  }
  const capabilityFilter =
    requestedCapability && isOcrCapability(requestedCapability) ? requestedCapability : null;

  const [customRows, formula] = await Promise.all([
    getDatabase()
      .select({
        id: ocrProviders.id,
        name: ocrProviders.name,
        capabilities: ocrProviders.capabilities,
        languages: ocrProviders.languages
      })
      .from(ocrProviders)
      .where(eq(ocrProviders.enabled, true))
      .orderBy(asc(ocrProviders.name)),
    formulaRecognitionStatus()
  ]);

  const providers: AvailableOcrProvider[] = [
    ...browserOcrProfiles.map((profile) => ({
      id: `browser:${profile.id}`,
      name: profile.label,
      description: profile.description,
      capabilities: ['text' as const],
      languages: profile.id === 'latin' ? ['English', 'French'] : ['English'],
      location: 'browser' as const,
      model: profile.recognitionModelName
    })),
    ...(formula.enabled && formula.ready
      ? [
          {
            id: 'builtin:formula',
            name: 'StudySky formula model',
            description: 'Self-hosted formula recognition configured by the administrator.',
            capabilities: ['formula_latex' as const],
            languages: [],
            location: 'server' as const,
            model: formula.model
          }
        ]
      : []),
    ...customRows.map((provider) => ({
      id: provider.id,
      name: provider.name,
      description: 'Administrator-approved model connected to this StudySky installation.',
      capabilities: parseOcrCapabilities(provider.capabilities),
      languages: parseOcrLanguages(provider.languages),
      location: 'server' as const,
      model: null
    }))
  ];

  return json(
    {
      providers: capabilityFilter
        ? providers.filter((provider) => provider.capabilities.includes(capabilityFilter))
        : providers
    },
    { headers: { 'cache-control': 'private, no-store' } }
  );
};
