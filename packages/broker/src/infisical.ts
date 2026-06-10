import { InfisicalSDK, SecretType } from '@infisical/sdk';
import type { VaultRef } from '@vaultic/shared';
import type { SecretMeta, VaultBackend } from './backend.js';
import { resolveProjectId, type VaulticConfig, type VaulticCredentials } from './config.js';

const SECRET_PATH = '/';

interface InfisicalBackendOptions {
  config: VaulticConfig;
  credentials: VaulticCredentials;
  sdkFactory?: (siteUrl: string) => InfisicalSDK;
}

export class InfisicalBackend implements VaultBackend {
  private readonly options: InfisicalBackendOptions;
  private client?: InfisicalSDK;

  constructor(options: InfisicalBackendOptions) {
    this.options = options;
  }

  private async guard<T>(op: string, ctx: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (cause) {
      console.error(`vaultic: Infisical SDK ${op} failed for ${ctx}:`, cause);
      throw new Error(`Infisical backend error during ${op} for ${ctx} — see broker stderr for details`);
    }
  }

  private async getClient(): Promise<InfisicalSDK> {
    if (this.client) return this.client;
    const factory = this.options.sdkFactory ?? ((siteUrl: string) => new InfisicalSDK({ siteUrl }));
    const client = factory(this.options.config.siteUrl);
    const { clientId, clientSecret } = this.options.credentials;
    await this.guard('login', this.options.config.siteUrl, () =>
      client.auth().universalAuth.login({ clientId, clientSecret }),
    );
    this.client = client;
    return client;
  }

  async listSecrets(ref: Pick<VaultRef, 'workspace' | 'project' | 'environment'>): Promise<SecretMeta[]> {
    const projectId = resolveProjectId(this.options.config, ref.workspace, ref.project);
    const client = await this.getClient();
    const result = await this.guard('list', `${projectId}/${ref.environment}`, () =>
      client.secrets().listSecrets({
        projectId,
        environment: ref.environment,
        secretPath: SECRET_PATH,
        viewSecretValue: false,
        expandSecretReferences: false,
      }),
    );
    return result.secrets.map((s) => ({
      key: s.secretKey,
      environment: ref.environment,
      lastUpdated: s.updatedAt,
    }));
  }

  async getSecretValue(ref: VaultRef): Promise<string> {
    const projectId = resolveProjectId(this.options.config, ref.workspace, ref.project);
    const client = await this.getClient();
    const secret = await this.guard('get', `${projectId}/${ref.environment}`, () =>
      client.secrets().getSecret({
        projectId,
        environment: ref.environment,
        secretPath: SECRET_PATH,
        secretName: ref.key,
      }),
    );
    return secret.secretValue;
  }

  async setSecret(ref: VaultRef, value: string): Promise<void> {
    const projectId = resolveProjectId(this.options.config, ref.workspace, ref.project);
    const client = await this.getClient();
    await this.guard('create', `${projectId}/${ref.environment}`, () =>
      client.secrets().createSecret(ref.key, {
        projectId,
        environment: ref.environment,
        secretPath: SECRET_PATH,
        secretValue: value,
        type: SecretType.Shared,
      }),
    );
  }
}
