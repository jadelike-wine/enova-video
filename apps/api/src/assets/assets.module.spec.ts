import { describe, expect, it } from 'vitest';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { AssetsController } from './assets.controller.js';
import { AssetsModule } from './assets.module.js';

describe('AssetsModule', () => {
  it('registers AuthGuard for the guarded assets controller', () => {
    const providers = Reflect.getMetadata('providers', AssetsModule) as unknown[];
    const controllers = Reflect.getMetadata('controllers', AssetsModule) as unknown[];

    expect(controllers).toContain(AssetsController);
    expect(providers).toContain(AuthGuard);
  });
});
