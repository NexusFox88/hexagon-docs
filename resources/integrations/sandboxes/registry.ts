import { instaboxConnection, InstaboxConnector } from './instabox.js';
import { boatConnection, BoatConnector } from './boat.js';
import type { SandboxConnector } from '../../modules/sandboxes/connector.js';
import type { ConnectionAdapter } from '../../modules/connections/connections.js';
import { e2bConnection, E2BConnector } from './e2b.js';
import { DaytonaConnector } from './daytona.js';
import { modalConnection, ModalConnector } from './modal.js';
import { blaxelConnection, BlaxelConnector } from './blaxel.js';
import { vercelConnection, VercelConnector } from './vercel.js';
import { upstashConnection, UpstashConnector } from './upstash.js';
import { spritesConnection, SpritesConnector } from './sprites.js';
import { agent37Connection, Agent37Connector } from './agent37.js';
import { freestyleConnection, FreestyleConnector } from './freestyle.js';
import { flyMachinesConnection, FlyMachinesConnector } from './fly-machines.js';

/** The same provider registration is used by the API, workers and acceptance journeys. */
const providers: Record<string, { connection: ConnectionAdapter; create: (config: Record<string, unknown>, credential: string) => SandboxConnector }> = {
  instabox: { connection: instaboxConnection, create: (config, credential) => new InstaboxConnector(config, credential) },
  boat: { connection: boatConnection, create: (config, credential) => new BoatConnector(config, credential) },
  'fly-machines': { connection: flyMachinesConnection, create: (config, credential) => new FlyMachinesConnector(config, credential) },
  freestyle: { connection: freestyleConnection, create: (config, credential) => new FreestyleConnector(config, credential) },
  agent37: { connection: agent37Connection, create: (config, credential) => new Agent37Connector(config, credential) },
  e2b: { connection: e2bConnection, create: (config, credential) => new E2BConnector(config, credential) },
  modal: { connection: modalConnection, create: (config, credential) => new ModalConnector(config, credential) },
  blaxel: { connection: blaxelConnection, create: (config, credential) => new BlaxelConnector(config, credential) },
  vercel: { connection: vercelConnection, create: (config, credential) => new VercelConnector(config, credential) },
  upstash: { connection: upstashConnection, create: (config, credential) => new UpstashConnector(config, credential) },
  sprites: { connection: spritesConnection, create: (config, credential) => new SpritesConnector(config, credential) },
};
const setupUrls:Record<string,string>={
 e2b:'https://e2b.dev/dashboard?tab=keys',modal:'https://modal.com/docs/cli/latest/token',
 instabox:'https://instabox.sh/docs/api.md',boat:'https://boat.dev/',
 'fly-machines':'https://docs.fly.io/security/tokens',sprites:'https://fly.io/sprites/',
 freestyle:'https://www.freestyle.sh/docs',agent37:'https://www.agent37.com/',
 blaxel:'https://docs.blaxel.ai/Get-started',vercel:'https://vercel.com/docs/rest-api',
 upstash:'https://upstash.com/docs/box/overall/quickstart',
};
export const sandboxConnections = Object.values(providers).map(entry => ({...entry.connection,setup_url:setupUrls[entry.connection.provider],evidence:{implemented:true,contract_tests:true,live_resource:true,source:'docs/sandbox-providers.md'}}));
export function createSandboxConnector(provider: string, config: Record<string, unknown>, credential: string): SandboxConnector {
  // Candidate only: retain access to historical resources for reconciliation/cleanup.
  // No Connection adapter is registered, so new Connections/Sessions cannot select it.
  if (provider === 'daytona') return new DaytonaConnector(config, credential);
  const entry = Object.hasOwn(providers, provider) ? providers[provider] : undefined;
  if (!entry) throw new Error('unsupported_sandbox_provider');
  return entry.create(config, credential);
}
