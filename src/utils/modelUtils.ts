/**
 * Renderer-side re-export shim.
 *
 * The cloud-model registry used to live here. As of M1 Step 1 it moved to
 * `electron/shared/standardCloudModels.ts` so that both the main process
 * and the renderer can import from a single source of truth without
 * duplication. This file is preserved as a re-export so every existing
 * `import { ... } from '../utils/modelUtils'` call site keeps working —
 * those imports will be migrated to `@shared/standardCloudModels` directly
 * in a later M1 step.
 *
 * See TASKS.md M1 Step 1 and DECISIONS.md D007.
 */

export {
    STANDARD_CLOUD_MODELS,
    prettifyModelId,
} from '@shared/standardCloudModels';

export type {
    ProviderKey,
    PreferredModelKey,
    CloudModelRegistryEntry,
} from '@shared/standardCloudModels';
