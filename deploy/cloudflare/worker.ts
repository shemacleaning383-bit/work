import { Container, getContainer } from '@cloudflare/containers';

interface Env { BLUEPARK: DurableObjectNamespace<BlueParkContainer>; ADMIN_PASSWORD?: string; PUBLIC_BASE_URL?: string }

export class BlueParkContainer extends Container<Env> {
  defaultPort = 3000;
  sleepAfter = '30m';
  constructor(ctx: ConstructorParameters<typeof Container>[0], env: Env) {
    super(ctx, env);
    this.envVars = {
      BLUEPARK_MODE: 'demo',
      SECURE_COOKIES: 'true',
      ...(env.ADMIN_PASSWORD ? { ADMIN_PASSWORD: env.ADMIN_PASSWORD } : {}),
      ...(env.PUBLIC_BASE_URL ? { PUBLIC_BASE_URL: env.PUBLIC_BASE_URL } : {}),
    };
  }
}

export default {
  // A single instance keeps the SQLite demo data in one place.
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.BLUEPARK, 'main').fetch(request);
  },
};
